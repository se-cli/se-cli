import * as net from 'net';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { Registry, SessionConfig } from './registry';
import { makeSocketPath, workspaceHash, baseDaemonDir } from './config';
import type { ClientMessage, ServerMessage } from './protocol';
import { FileLogger } from './logger';

/** Current CLI version — compared against the daemon's saved version. */
const CLI_VERSION = require('../package.json').version;

export class Session {
  private socketPath: string;
  private wsHash: string;
  private registry: Registry;
  private logger: FileLogger;

  constructor(
    private workspaceDir: string,
    private sessionName: string = 'default',
  ) {
    this.wsHash = workspaceHash(workspaceDir);
    this.socketPath = makeSocketPath(this.wsHash, sessionName);
    this.registry = new Registry(baseDaemonDir());
    // CLI-side log: records start/reuse/stop/connection events that happen
    // inside this (short-lived) process, complementing the daemon log.
    this.logger = new FileLogger(
      path.join(baseDaemonDir(), 'logs'),
      `${this.wsHash}-${sessionName}.cli.log`,
    );
  }

  async canConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = net.connect(this.socketPath);
      const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
      sock.once('connect', () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
    });
  }

  /**
   * Start (or reuse) the daemon for this session.
   *
   * @returns 'reused' if an alive daemon already owns the socket (no new
   *          browser window was spawned), 'started' if a new daemon was
   *          launched (a fresh browser window appears when headed).
   */
  async startDaemon(opts: { browserName?: string; headed?: boolean; cdpEndpoint?: string; profilePath?: string; persistent?: boolean; idleTimeout?: number; emulation?: Record<string, any>; endpoint?: string; browserArgs?: string; capabilities?: Record<string, unknown>; browserBinary?: string; driverBinary?: string } = {}): Promise<'started' | 'reused'> {
    // If a daemon is already running on this socket, verify it's responsive.
    if (await this.canConnect()) {
      try {
        await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
        // spec §4.3/§6.1: handshake exchanges versions — a daemon left over
        // from an older se-cli install may not understand newer commands,
        // so surface the mismatch and suggest close && open.
        const config = this.registry.loadSession(this.wsHash, this.sessionName);
        if (config && config.version && config.version !== CLI_VERSION) {
          this.logger.warn('session', `version mismatch: daemon=${config.version} cli=${CLI_VERSION}`);
          process.emitWarning(
            `daemon was started by se-cli v${config.version}, current CLI is v${CLI_VERSION}. ` +
            'Run `se-cli close` then `se-cli open` to restart the session.'
          );
        }
        this.logger.info('session', `reused existing daemon ${this.sessionName}@${this.wsHash}`);
        return 'reused'; // Daemon is alive and responsive
      } catch {
        // Daemon is listening but not responsive — force kill it.
        const config = this.registry.loadSession(this.wsHash, this.sessionName);
        if (config && config.pid) {
          this.logger.warn('session', `daemon unresponsive — killing pid=${config.pid}`);
          try { process.kill(config.pid, 'SIGKILL'); } catch {}
        }
        this.registry.deleteSession(this.wsHash, this.sessionName);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const browserName = opts.browserName || 'chrome';
    const daemonScript = path.join(__dirname, 'daemon', 'server.js');
    const args = [daemonScript, this.sessionName, this.socketPath, this.workspaceDir, browserName];
    if (opts.headed) args.push('--headed');
    if (opts.cdpEndpoint) args.push(`--cdp=${opts.cdpEndpoint}`);
    if (opts.profilePath) args.push(`--profile=${opts.profilePath}`);
    if (opts.persistent) args.push('--persistent');
    if (opts.idleTimeout !== undefined) args.push(`--idle-timeout=${opts.idleTimeout}`);
    // v0.10: remote/grid/custom-browser flags.
    if (opts.endpoint) args.push(`--endpoint=${opts.endpoint}`);
    if (opts.browserArgs) args.push(`--browser-args=${opts.browserArgs}`);
    if (opts.capabilities) args.push(`--capabilities=${JSON.stringify(opts.capabilities)}`);
    if (opts.browserBinary) args.push(`--browser-binary=${opts.browserBinary}`);
    if (opts.driverBinary) args.push(`--driver-binary=${opts.driverBinary}`);
    // v0.8: open-time emulation flags, passed through verbatim so the daemon
    // can persist them in the SessionConfig and replay them on driver rebuild.
    if (opts.emulation) {
      const emu = opts.emulation;
      if (emu.viewport) args.push(`--viewport=${emu.viewport.width}x${emu.viewport.height}`);
      if (emu.userAgent) args.push(`--user-agent=${emu.userAgent}`);
      if (emu.locale) args.push(`--locale=${emu.locale}`);
      if (emu.colorScheme) args.push(`--color-scheme=${emu.colorScheme}`);
      if (emu.timezone) args.push(`--timezone=${emu.timezone}`);
      if (emu.geolocation) args.push(`--geolocation=${emu.geolocation.latitude},${emu.geolocation.longitude}${emu.geolocation.accuracy !== undefined ? `,${emu.geolocation.accuracy}` : ''}`);
      if (emu.permissions && emu.permissions.length > 0) args.push(`--permissions=${emu.permissions.join(',')}`);
    }

    const child: ChildProcess = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let daemonStderr = '';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('daemon start timeout'));
      }, 120000);
      const onStdout = (data: Buffer) => {
        const line = data.toString().trim();
        if (line.startsWith('Daemon listening on')) {
          clearTimeout(timeout);
          this.logger.info('session', `started daemon pid=${child.pid}`);
          // Detach from the child so it survives the parent's exit.
          child.unref();
          // Remove listeners so we don't interfere with the child's lifecycle.
          child.stdout?.removeListener('data', onStdout);
          child.stderr?.removeListener('data', onStderr);
          child.removeListener('error', onError);
          child.removeListener('exit', onExit);
          // Unref the stdio pipes so they don't keep the parent's event
          // loop alive (which would cause execSync-based callers to hang
          // until their timeout).  Do NOT destroy the pipes — destroying
          // them breaks the child's stdout/stderr fd and causes the daemon
          // to crash with EPIPE the next time it tries to log an error.
          const stdoutSock = child.stdout as unknown as { unref?: () => void };
          const stderrSock = child.stderr as unknown as { unref?: () => void };
          stdoutSock.unref?.();
          stderrSock.unref?.();
          resolve();
        }
      };
      const onStderr = (data: Buffer) => {
        const text = data.toString();
        daemonStderr += text;
        this.logger.warn('daemon-stderr', text.trimEnd());
      };
      const onError = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timeout);
        reject(new Error(`daemon exited early code=${code} signal=${signal}` +
          (daemonStderr ? `\n${daemonStderr}` : '')));
      };
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('exit', onExit);
    });

    // Health check: verify the daemon is actually responsive by sending a ping.
    // The daemon might crash shortly after listening (e.g., during module
    // loading), so we confirm it can handle at least one request.
    try {
      await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
    } catch {
      // Ping failed — the daemon may have crashed. Try one more time with
      // a short delay to give it a chance to fully initialize.
      await new Promise(r => setTimeout(r, 500));
      await this.sendAndClose({ method: 'ping', params: { args: [], cwd: '' } });
    }
    return 'started';
  }

  async run(args: string[], cwd: string, opts: { raw?: boolean; json?: boolean } = {}): Promise<ServerMessage> {
    const msg: ClientMessage = {
      method: 'run',
      params: { args, cwd, raw: opts.raw, json: opts.json },
    };
    // Retry on connection failures — the daemon may have crashed and
    // needs to be restarted from the saved session config.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await this.sendAndClose(msg);
        // Retry on DRIVER_ERROR — the daemon has already reset the driver
        // (see server.ts handleMessage), so the next attempt will trigger a
        // fresh driver build. This handles transient browser crashes (e.g.
        // Windows chromedriver 0xC0000142) without retrying application-
        // level errors like "element not found".
        if (!resp.ok && resp.code === 'DRIVER_ERROR' && attempt < 2) {
          this.logger.warn('session', `DRIVER_ERROR on "${args[0] || '?'}" — retry ${attempt + 1}`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return resp;
      } catch (e: any) {
        lastErr = e;
        const errMsg = e.message || '';
        if (errMsg.includes('daemon closed connection') || errMsg.includes('ECONNREFUSED') || errMsg.includes('connect ENOENT') || errMsg.includes('ECONNRESET') || errMsg.includes('EPIPE')) {
          // Try to restart the daemon on the first connection failure.
          if (attempt === 0) {
            this.logger.warn('session', `daemon connection lost — restarting (${errMsg})`);
            try {
              const config = this.registry.loadSession(this.wsHash, this.sessionName);
              if (config && config.browserName) {
                // Restore the FULL launch configuration, not just the browser:
                // losing --headed/--cdp/--profile/--persistent/--idle-timeout
                // on restart would silently degrade the session (e.g.
                // attach→new browser, window reappearing on idle).
                await this.startDaemon({
                  browserName: config.browserName,
                  headed: config.headed,
                  cdpEndpoint: config.cdpEndpoint,
                  profilePath: config.profilePath,
                  persistent: config.persistent,
                  idleTimeout: config.idleTimeout,
                  emulation: config.emulation,
                });
              }
            } catch {
              // startDaemon may fail — that's OK, we'll retry the connection
            }
          }
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async stop(): Promise<void> {
    this.logger.info('session', 'stopping daemon');
    try {
      await this.sendAndClose({ method: 'stop', params: { args: [], cwd: process.cwd() } });
    } catch {
      // daemon may already be dead
    }
    this.registry.deleteSession(this.wsHash, this.sessionName);

    // Wait for the daemon to actually exit — the 'stop' response is sent
    // before shutdown() completes, so the socket might still be alive briefly.
    for (let i = 0; i < 10; i++) {
      if (!(await this.canConnect())) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  private sendAndClose(msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      const timeout = setTimeout(() => {
        sock.destroy();
        reject(new Error('daemon connection timeout'));
      }, 60000);

      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        sock.removeAllListeners();
        sock.destroy();
      };

      sock.once('connect', () => {
        sock.write(JSON.stringify(msg) + '\n');
      });

      // Use StringDecoder to handle multi-byte UTF-8 characters (e.g.
      // Chinese) that may be split across TCP socket chunks. Without this,
      // data.toString() on a partial multi-byte sequence produces
      // replacement chars (U+FFFD), causing garbled text.
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      sock.on('data', (data) => {
        buffer += decoder.write(data);
        if (buffer.includes('\n')) {
          if (settled) return;
          settled = true;
          try {
            const resp = JSON.parse(buffer.split('\n')[0]) as ServerMessage;
            cleanup();
            resolve(resp);
          } catch (e: any) {
            cleanup();
            reject(e);
          }
        }
      });

      sock.once('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });

      sock.once('close', () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (buffer === '' || !buffer.includes('\n')) {
          reject(new Error('daemon closed connection without response'));
        }
      });
    });
  }

  loadConfig(): SessionConfig | null {
    return this.registry.loadSession(this.wsHash, this.sessionName);
  }
}
