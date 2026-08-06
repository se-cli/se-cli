import * as net from 'net';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import { Registry, SessionConfig } from '../registry';
import { baseDaemonDir } from '../config';
import { runCleanup } from '../cleanup';
import { buildDriverSpec, parseBrowserArgs, parseCapabilities } from '../driver-options';
import type { ClientMessage, ServerMessage } from '../protocol';
import { resetAll as resetNetworkDebugState } from './tools/network-state';
import { parseViewport, parseGeolocation, applyEmulation, setEmulationState, resetEmulationState } from './tools/emulation-state';

// ── Hide driver console windows on Windows ────────────────────────────
// selenium-webdriver launches two kinds of console processes on Windows,
// neither of which sets windowsHide:true:
//   1. The browser driver (chromedriver / edgedriver / geckodriver) via
//      child_process.spawn → persistent console window
//      ("DevTools listening on …").
//   2. selenium-manager.exe via child_process.spawnSync → console window
//      that flashes briefly on EVERY driver build (it resolves the driver
//      path, even when the driver is already cached).
// Patch both so the windows are suppressed without affecting the daemon's
// own child processes.
const cp = require('child_process') as typeof import('child_process');
const _origSpawn = cp.spawn;
const _origSpawnSync = cp.spawnSync;
const _driverRe = /chromedriver|edgedriver|geckodriver|selenium/i;

function _shouldHideDriverWindow(cmd: unknown): boolean {
  return typeof cmd === 'string' && _driverRe.test(cmd);
}

cp.spawn = function patchedSpawn(this: any, cmd: any, args?: readonly string[] | null, options?: any): any {
  const opts = options as Record<string, any> | undefined;
  if (_shouldHideDriverWindow(cmd) && opts && typeof opts === 'object') {
    opts.windowsHide = true;
  }
  return _origSpawn.call(this, cmd, args ?? [], options);
} as any;

// spawnSync signature: spawnSync(cmd[, args][, options]) or spawnSync(cmd[, options]).
// seleniumManager.js calls spawnSync(smBinary, args) with NO options, so the
// options object must be created here when missing.
cp.spawnSync = function patchedSpawnSync(this: any, cmd: any, arg2?: any, arg3?: any): any {
  if (_shouldHideDriverWindow(cmd)) {
    if (Array.isArray(arg2)) {
      if (arg3 === undefined) arg3 = {};
      if (arg3 && typeof arg3 === 'object') arg3.windowsHide = true;
    } else if (arg2 === undefined || (arg2 && typeof arg2 === 'object')) {
      if (arg2 === undefined) arg2 = {};
      arg2.windowsHide = true;
    }
  }
  return _origSpawnSync.call(this, cmd, arg2, arg3);
} as any;

const args = process.argv.slice(2);
const sessionName = args[0];
const socketPath = args[1];
const workspaceDir = args[2];
const browserName = (args[3] as 'chrome' | 'edge' | 'firefox') || 'chrome';
const headed = args.includes('--headed');
const cdpEndpoint = args.find(a => a.startsWith('--cdp='))?.slice('--cdp='.length);
const profilePath = args.find(a => a.startsWith('--profile='))?.slice('--profile='.length);
const persistent = args.includes('--persistent');
// Idle timeout in minutes: CLI flag > env var > default 30. 0 disables the
// idle shutdown entirely (daemon stays alive until `se-cli close`).
const idleTimeoutArg = Number(args.find(a => a.startsWith('--idle-timeout='))?.slice('--idle-timeout='.length));
const idleTimeoutMin = Number.isFinite(idleTimeoutArg)
  ? idleTimeoutArg
  : Number(process.env.SE_CLI_IDLE_TIMEOUT) || 30;
// v0.8: open-time environment emulation flags. Parsed here (not in the tool
// layer) because they configure the driver at build time, and they are
// persisted in the SessionConfig so a driver rebuild replays them.
const emulation: Record<string, any> = {};
const emuViewport = args.find(a => a.startsWith('--viewport='))?.slice('--viewport='.length);
if (emuViewport) emulation.viewport = parseViewport(emuViewport);
const emuUserAgent = args.find(a => a.startsWith('--user-agent='))?.slice('--user-agent='.length);
if (emuUserAgent) emulation.userAgent = emuUserAgent;
const emuLocale = args.find(a => a.startsWith('--locale='))?.slice('--locale='.length);
if (emuLocale) emulation.locale = emuLocale;
const emuColorScheme = args.find(a => a.startsWith('--color-scheme='))?.slice('--color-scheme='.length);
if (emuColorScheme) {
  if (emuColorScheme !== 'light' && emuColorScheme !== 'dark') {
    throw new Error(`Invalid --color-scheme: "${emuColorScheme}". Expected light or dark`);
  }
  emulation.colorScheme = emuColorScheme;
}
const emuTimezone = args.find(a => a.startsWith('--timezone='))?.slice('--timezone='.length);
if (emuTimezone) emulation.timezone = emuTimezone;
const emuGeolocation = args.find(a => a.startsWith('--geolocation='))?.slice('--geolocation='.length);
if (emuGeolocation) emulation.geolocation = parseGeolocation(emuGeolocation);
const emuPermissions = args.find(a => a.startsWith('--permissions='))?.slice('--permissions='.length);
if (emuPermissions) emulation.permissions = emuPermissions.split(',').map(p => p.trim()).filter(Boolean);
// v0.10: remote/grid/custom-browser flags.
const endpoint = args.find(a => a.startsWith('--endpoint='))?.slice('--endpoint='.length);
const browserArgs = args.find(a => a.startsWith('--browser-args='))?.slice('--browser-args='.length);
const capabilitiesJson = args.find(a => a.startsWith('--capabilities='))?.slice('--capabilities='.length);
const browserBinary = args.find(a => a.startsWith('--browser-binary='))?.slice('--browser-binary='.length);
const driverBinary = args.find(a => a.startsWith('--driver-binary='))?.slice('--driver-binary='.length);
const browserArgsList = browserArgs ? parseBrowserArgs(browserArgs) : [];
const capabilities = capabilitiesJson ? parseCapabilities(capabilitiesJson) : {};
// --endpoint attaches to a remote WebDriver/Grid; --cdp attaches to a
// local Chrome debugger port — they cannot both define the transport.
if (endpoint && cdpEndpoint) {
  throw new Error('--endpoint and --cdp are mutually exclusive (remote WebDriver vs local CDP attach)');
}
const version = require('../../package.json').version;

const ALLOWED_BROWSERS = new Set(['chrome', 'edge', 'firefox']);
if (!ALLOWED_BROWSERS.has(browserName)) {
  throw new Error(`Unsupported browser: ${browserName}. Supported: chrome, edge, firefox`);
}

let driver: any = null;
let driverInitError: string | null = null;
let driverBuildPromise: Promise<void> | null = null;

/**
 * Build the driver exactly once even when multiple messages arrive
 * concurrently (e.g. MCP client bursts). Without this, concurrent
 * messages would each see driver === null and create duplicate
 * WebDriver sessions — the loser's browser process leaks forever.
 */
async function ensureDriver(): Promise<void> {
  if (driver) return;
  if (!driverBuildPromise) {
    driverBuildPromise = buildDriver().finally(() => {
      driverBuildPromise = null;
    });
  }
  await driverBuildPromise;
}
let lastActivity = Date.now();
const crypto = require('crypto');
const wsHash = crypto.createHash('sha1').update(workspaceDir).digest('hex').slice(0, 16);
const registry = new Registry(baseDaemonDir());

// ── File logging ────────────────────────────────────────────────────────
// The daemon runs detached (its stdio pipes are unref'd by the CLI), so
// every diagnostic write to stderr would be silently dropped. Redirect
// stderr into the session log file — this also captures uncaught exception
// handlers, heartbeat failures, and anything third-party modules write.
const { FileLogger } = require('../logger') as typeof import('../logger');
const path = require('path') as typeof import('path');
const logger = new FileLogger(
  path.join(baseDaemonDir(), 'logs'),
  `${wsHash}-${sessionName}.daemon.log`,
);
logger.installStderrRedirect();
logger.info('daemon', `start args=${args.join(' ')} pid=${process.pid}`);

// Track the current socket so we can send an error response if the
// process crashes unexpectedly (e.g. native browser driver crash).
let activeSocket: net.Socket | null = null;

const server = net.createServer((socket) => {
  activeSocket = socket;
  // Use StringDecoder to handle multi-byte UTF-8 characters (e.g. Chinese)
  // that may be split across TCP socket chunks. Without this, data.toString()
  // on a partial multi-byte sequence produces replacement chars (U+FFFD),
  // causing garbled text for non-ASCII content (e.g. Baidu snapshots).
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  socket.on('data', async (data) => {
    buffer += decoder.write(data);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg: ClientMessage = JSON.parse(line);
        lastActivity = Date.now();
        // Handle 'stop' specially: send response before shutting down,
        // otherwise process.exit() kills the socket before the client
        // receives the acknowledgement.
        if (msg.method === 'stop') {
          socket.write(JSON.stringify({ ok: true, text: 'stopping' } as ServerMessage) + '\n');
          socket.end();
          shutdown();
          return;
        }
        const response = await handleMessage(msg);
        socket.write(JSON.stringify(response) + '\n');
      } catch (e: any) {
        const errResp: ServerMessage = { ok: false, error: e.message, code: 'DRIVER_ERROR' };
        try { socket.write(JSON.stringify(errResp) + '\n'); } catch {}
      }
    }
  });
  socket.on('error', () => {
    // Silently ignore socket errors (client disconnect, EPIPE, etc.)
  });
});

async function buildDriver(): Promise<void> {
  const start = Date.now();
  const { Builder } = require('selenium-webdriver');
  const spec = buildDriverSpec({
    browserName,
    headed,
    cdpEndpoint,
    profilePath,
    endpoint,
    browserArgs: browserArgsList,
    capabilities,
    browserBinary,
    driverBinary,
    envBinaries: {
      chrome: process.env.SE_CHROME_BINARY,
      edge: process.env.SE_EDGE_BINARY,
      firefox: process.env.SE_FIREFOX_BINARY,
    },
  });
  const builder = new Builder().forBrowser(spec.seleniumBrowserName);
  if (spec.usingServer) builder.usingServer(spec.usingServer);

  // v0.10: --driver-binary bypasses selenium-manager and uses a custom
  // driver executable (useful for pinned versions / air-gapped setups).
  if (spec.driverBinary) {
    if (browserName === 'chrome') {
      const { ServiceBuilder } = require('selenium-webdriver/chrome');
      builder.setChromeService(new ServiceBuilder(spec.driverBinary).build());
    } else if (browserName === 'edge') {
      const { ServiceBuilder } = require('selenium-webdriver/edge');
      builder.setEdgeService(new ServiceBuilder(spec.driverBinary).build());
    } else if (browserName === 'firefox') {
      const { ServiceBuilder } = require('selenium-webdriver/firefox');
      builder.setFirefoxService(new ServiceBuilder(spec.driverBinary).build());
    }
  }

  // Set unhandledPromptBehavior to 'ignore' so that alerts/confirm/prompt dialogs
  // are NOT auto-dismissed when subsequent WebDriver commands (e.g. applyTimeouts)
  // are sent to the driver. This allows dialog-accept/dialog-dismiss to work
  // correctly when a dialog is triggered via setTimeout in eval.
  builder.getCapabilities().set('unhandledPromptBehavior', 'ignore');

  // Enable BiDi (WebSocket) so v0.7 Network & Debugging commands work.
  // Without this, selenium-webdriver's BiDi modules fail with
  // "Cannot read properties of undefined (reading 'replace')" when trying
  // to get the WebSocket URL from session capabilities.
  builder.getCapabilities().set('webSocketUrl', true);

  // v0.10: user-supplied W3C capabilities (--capabilities), applied last so
  // they override our defaults.
  for (const [key, value] of Object.entries(spec.extraCapabilities)) {
    builder.getCapabilities().set(key, value);
  }

  if (spec.chromeOptions) builder.getCapabilities().set('goog:chromeOptions', spec.chromeOptions);
  if (spec.edgeOptions) builder.getCapabilities().set('ms:edgeOptions', spec.edgeOptions);
  if (spec.firefoxOptions) builder.getCapabilities().set('moz:firefoxOptions', spec.firefoxOptions);

  // Add a timeout so builder.build() doesn't hang indefinitely if
  // the browser driver process stalls.
  const buildPromise = builder.build();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out building ${browserName} driver after 60s`)), 60000);
  });
  driver = await Promise.race([buildPromise, timeoutPromise]);
  driverInitError = null;
  logger.info('driver', `built ${browserName} driver in ${Date.now() - start}ms${headed ? ' (headed)' : ' (headless)'}${endpoint ? ` (remote: ${endpoint})` : ''}`);
  // v0.8: replay the open-time emulation flags on the fresh driver. Failures
  // (e.g. unsupported capabilities on Firefox) are logged, not fatal — the
  // driver itself is healthy and the rest of the session keeps working.
  if (Object.keys(emulation).length > 0) {
    setEmulationState(emulation);
    try {
      const warnings = await applyEmulation(driver);
      for (const w of warnings) logger.warn('emulation', w);
    } catch (e: any) {
      logger.warn('emulation', `failed to apply emulation: ${e.message}`);
    }
  }
}

async function handleMessage(msg: ClientMessage): Promise<ServerMessage> {
  if (msg.method === 'ping') {
    // If the driver previously crashed, report it so the client can
    // restart the daemon rather than sending commands to a dead session.
    if (driverInitError) {
      return { ok: false, error: driverInitError, code: 'DRIVER_ERROR' };
    }
    return { ok: true, text: 'pong' };
  }
  // method === 'run' — dispatch to backend
  const { callTool, parseCommand } = require('./backend');
  const start = Date.now();
  let toolName = '?';
  try {
    // Parse the command first so we can skip driver initialization for
    // config commands that don't need a browser.
    const parsed = parseCommand(msg.params.args);
    toolName = parsed.toolName;
    const { toolParams, flags } = parsed;
    const isConfigCmd = toolName === 'config_get' || toolName === 'config_set' ||
      toolName === 'config_list' || toolName === 'config_init';
    if (!isConfigCmd && !driver) {
      // Clear any previous init error and attempt a fresh build.
      // The initial build might have failed due to a transient issue
      // (e.g. chromedriver DLL init failure 0xC0000142 on Windows CI),
      // but subsequent commands deserve a retry rather than being
      // permanently blocked by the cached error.
      driverInitError = null;
      try {
        await ensureDriver();
      } catch (e: any) {
        driverInitError = `Failed to build ${browserName} driver: ${e.message}. Hint: run \`se-cli install-browser ${browserName}\` to install/verify the driver.`;
        logger.error('driver', driverInitError + '\n' + (e.stack || ''));
        return { ok: false, error: driverInitError, code: 'DRIVER_ERROR' };
      }
    }
    const response = await callTool(driver, toolName, toolParams, { raw: !!msg.params.raw, json: !!msg.params.json }, flags, msg.params.cwd);
    logger.info('cmd', `${toolName} ${Date.now() - start}ms ok`);
    return { ok: true, text: response.serialize() };
  } catch (e: any) {
    const name = e.name || '';
    const errMsg = e.message || '';

    // Session-fatal: the WebDriver session itself is gone (browser crashed,
    // connection dropped). Only these errors warrant destroying the session.
    const isSessionFatal =
      name === 'NoSuchSessionError' ||
      name === 'SessionNotCreatedError' ||
      /(ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|invalid session id|session not created)/i.test(errMsg);

    let code: ServerMessage['code'];
    if (name === 'NoSuchElementError' || name === 'StaleElementReferenceError') code = 'ELEMENT_NOT_FOUND';
    else if (name === 'TimeoutError' || name === 'ScriptTimeoutError') code = 'TIMEOUT';
    else if (name === 'AssertionError') code = 'ASSERTION_FAILED';
    else if (isSessionFatal) code = 'DRIVER_ERROR';
    else code = 'COMMAND_ERROR';

    // Only reset the driver on session-fatal errors so the next command can
    // rebuild a fresh driver instead of reusing a crashed/stale session.
    // Application-level failures — element wait timeouts, script timeouts,
    // assertion failures, validation errors — must NOT destroy the browser
    // session: that would discard all page state for a recoverable failure.
    if (code === 'DRIVER_ERROR') {
      logger.error('driver', `resetting driver after ${code}: ${errMsg}`);
      try { if (driver) driver.quit(); } catch {}
      driver = null;
      driverInitError = null;
      // Reset v0.7 network/debug state so BiDi listeners are re-initialized
      // on the new driver. Without this, console/requests/routes commands
      // would use stale listeners after a driver crash.
      resetNetworkDebugState();
      // Reset the cached CDP connection — the new driver gets a fresh one.
      // The emulation STATE itself is kept so buildDriver() replays it.
      resetEmulationState();
    }
    logger.warn('cmd', `${toolName} ${Date.now() - start}ms ${code}: ${errMsg}`);
    return { ok: false, error: errMsg, code };
  }
}

async function shutdown() {
  // Close the server first so no new connections are accepted.
  server.close();
  logger.info('daemon', 'shutting down');
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch {}
  }
  // Quit the driver with a timeout — if it hangs, we still exit.
  try {
    await Promise.race([
      driver ? driver.quit() : Promise.resolve(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('driver quit timeout')), 5000)),
    ]);
  } catch (e: any) {
    logger.warn('driver', `quit failed: ${e.message}`);
  }
  // NOTE: Do NOT delete the session file here.  The CLI's stop() method
  // handles session file cleanup AFTER the daemon has exited.  If the
  // daemon deletes the file during shutdown(), it may race with a new
  // daemon that has already written its own session file, causing the
  // "list" command to return empty results.
  process.exit(0);
}

// Catch uncaught exceptions so the daemon doesn't silently crash.
// Try to send an error response to the client. For errors that occur
// during driver operations, reset the driver so the next command can
// attempt to rebuild it rather than killing the daemon entirely.
process.on('uncaughtException', (err: Error) => {
  // Silently ignore EPIPE/ECONNRESET — these happen when the parent
  // process closes its end of the stdio pipe after the daemon starts.
  const msg = err.message || '';
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write EPIPE')) {
    return;
  }
  process.stderr.write(`Uncaught exception: ${err.message}\n${err.stack || ''}\n`);
  if (activeSocket && !activeSocket.destroyed) {
    try {
      const errResp: ServerMessage = { ok: false, error: `daemon crash: ${err.message}`, code: 'DRIVER_ERROR' };
      activeSocket.write(JSON.stringify(errResp) + '\n');
      activeSocket.end();
    } catch {}
  }
  // Reset driver state so subsequent commands can try to rebuild.
  // Only exit if the error is not driver-related (e.g. out of memory).
  const isDriverError = msg.includes('driver') || msg.includes('WebDriver') ||
    msg.includes('Session') || msg.includes('geckodriver') || msg.includes('chromedriver');
  if (isDriverError) {
    try { if (driver) driver.quit(); } catch {}
    driver = null;
    driverInitError = null;
  } else {
    shutdown();
  }
});

// Catch unhandled promise rejections — same strategy as uncaught exceptions.
process.on('unhandledRejection', (err: any) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('write EPIPE')) {
    return;
  }
  process.stderr.write(`Unhandled rejection: ${msg}\n${err instanceof Error ? err.stack || '' : ''}\n`);
  if (activeSocket && !activeSocket.destroyed) {
    try {
      const errResp: ServerMessage = { ok: false, error: `daemon rejection: ${msg}`, code: 'DRIVER_ERROR' };
      activeSocket.write(JSON.stringify(errResp) + '\n');
      activeSocket.end();
    } catch {}
  }
  const isDriverError = msg.includes('driver') || msg.includes('WebDriver') ||
    msg.includes('Session') || msg.includes('geckodriver') || msg.includes('chromedriver');
  if (isDriverError) {
    try { if (driver) driver.quit(); } catch {}
    driver = null;
    driverInitError = null;
  } else {
    shutdown();
  }
});

// Prevent broken-pipe errors on stdout/stderr from crashing the daemon.
// After the parent process unrefs the stdio pipes, writes may fail with
// EPIPE.  Swallow these errors so the daemon stays alive.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Idle shutdown: auto-close the daemon (and its browser window) after
// `idleTimeoutMin` minutes without client activity. Configurable via
// `--idle-timeout` / SE_CLI_IDLE_TIMEOUT; 0 disables it. This is the
// mechanism that silently replaces the user's window with a fresh one on
// the next command after a long pause.
if (idleTimeoutMin > 0) {
  setInterval(() => {
    if (Date.now() - lastActivity > idleTimeoutMin * 60 * 1000) shutdown();
  }, 60 * 1000);
}

// Heartbeat: periodically check driver health via getTitle().
// If the driver is dead (browser crash, session expired), reset it so
// the next client command can rebuild rather than using a stale driver.
// Uses a 2-strike policy to avoid false positives from transient issues
// like page navigation or slow script execution.
let heartbeatFailures = 0;
setInterval(async () => {
  if (!driver) return;
  try {
    await driver.getTitle();
    heartbeatFailures = 0;
  } catch (e: any) {
    heartbeatFailures++;
    logger.warn('heartbeat', `failed (${heartbeatFailures}): ${e.message}`);
    if (heartbeatFailures >= 2) {
      logger.warn('heartbeat', 'driver appears dead — resetting for rebuild');
      try { if (driver) driver.quit(); } catch {}
      driver = null;
      driverInitError = null;
      heartbeatFailures = 0;
    }
  }
}, 30 * 1000);

const config: SessionConfig = {
  name: sessionName,
  version,
  timestamp: Date.now(),
  socketPath,
  workspaceDir,
  persistent,
  browserName,
  headed,
  cdpEndpoint,
  profilePath,
  idleTimeout: idleTimeoutMin,
  emulation: Object.keys(emulation).length > 0 ? emulation : undefined,
  pid: process.pid,
};

// Startup cleanup (issue #115): garbage-collect orphaned session files from
// crashed daemons, old rotated log backups, and (opt-in) old screenshots.
// Runs BEFORE writeSession so this daemon's own fresh session is never
// swept. Best-effort — failures are swallowed and never block startup.
try {
  const cleaned = runCleanup({
    baseDir: baseDaemonDir(),
    maxAgeDays: Number(process.env.SE_CLI_CLEANUP_MAX_AGE_DAYS) || 7,
    logMaxAgeDays: Number(process.env.SE_CLI_CLEANUP_LOG_MAX_AGE_DAYS) || 7,
    screenshotDir: path.join(workspaceDir, '.se-cli'),
    screenshotMaxAgeDays: Number(process.env.SE_CLI_CLEANUP_SCREENSHOT_DAYS) || 0,
  });
  if (cleaned.removedSessions + cleaned.removedLogs + cleaned.removedScreenshots > 0) {
    logger.info('cleanup', `removed ${cleaned.removedSessions} orphan session(s), ${cleaned.removedLogs} old log backup(s), ${cleaned.removedScreenshots} old screenshot(s)`);
  }
} catch (e: any) {
  logger.warn('cleanup', `cleanup failed: ${e.message}`);
}

registry.writeSession(wsHash, config);

server.on('error', (err: any) => {
  logger.error('daemon', `server error: ${err.message}`);
  shutdown();
});

// Remove stale socket file on POSIX
if (process.platform !== 'win32') {
  try { fs.unlinkSync(socketPath); } catch {}
}

// Pre-build the driver BEFORE listening so the first client command doesn't
// have to wait for driver initialization.  On Windows CI, the first Chrome
// driver build can take >30s (Selenium Manager downloads the driver), which
// exceeds the client's sendAndClose timeout and causes spurious failures.
// If the build fails, we still start listening — the error is reported to
// the client on their first command via driverInitError.
(async () => {
  try {
    await buildDriver();
  } catch (e: any) {
    driverInitError = `Failed to build ${browserName} driver: ${e.message}`;
    logger.error('driver', driverInitError + '\n' + (e.stack || ''));
  }
  server.listen(socketPath, () => {
    console.log(`Daemon listening on ${socketPath}`);
  });
})();
