import { parseArgs } from './minimist';
import { Session } from './session';
import { Registry } from './registry';
import { baseDaemonDir, workspaceHash } from './config';
import { render } from './output';
import { detectBrowser } from './detect-browser';
import type { ServerMessage } from './protocol';
import {
  loadConfigFile,
  getConfigValue,
  setConfigValue,
  listConfig,
  generateTemplateConfig,
  resolveConfig,
} from './wait-config';
import * as path from 'path';
import * as fs from 'fs';
import { installSkills, parseAgentList, detectInstalledAgents, listAgentTargets, AGENTS } from './install';
import { resolveBrowserName, installBrowser } from './install-browser';

export async function main(argv: string[]): Promise<void> {
  const opts = {
    boolean: ['headed', 'raw', 'json', 'persistent', 'help', 'no-wait', 'skills', 'force', 'list-agents', 'http'],
    string: [
      'browser', 'filename', 'depth', 's', 'session', 'cdp', 'profile', 'tail',
      // v0.9: skill installation / MCP HTTP transport
      'agent', 'path', 'port', 'host',
      // v0.4 wait/retry flags
      'timeout', 'wait', 'retry', 'retry-interval',
      'implicit-wait', 'page-load-timeout', 'script-timeout',
      'idle-timeout',
      // v0.8 open-time environment emulation flags
      'viewport', 'user-agent', 'locale', 'color-scheme', 'timezone', 'geolocation', 'permissions',
    ],
    alias: { s: 'session' },
  };
  const args = parseArgs(argv, opts);

  if (args.help || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const sessionName = args.session || process.env.SE_CLI_SESSION || 'default';
  // Validate the session name: it is used in file paths (e.g. --persistent
  // profile dirs), so reject path separators and traversal attempts.
  if (!/^[\w.-]+$/.test(sessionName) || sessionName === '.' || sessionName === '..') {
    console.error(`Error: Invalid session name: "${sessionName}". Use only letters, digits, _ - .`);
    process.exit(1);
  }
  const cwd = process.cwd();
  const workspaceDir = findWorkspaceDir(cwd);
  const session = new Session(workspaceDir, sessionName);

  const cmd = args._[0];

  if (cmd === 'open') {
    const url = args._[1];
    const openOpts: any = {};
    if (args.browser) {
      openOpts.browserName = args.browser;
    } else if (!args.cdp) {
      // No explicit --browser and no CDP attach: probe installed browsers
      // in the order Edge → Chrome → Firefox, and fail if none is found.
      const detected = detectBrowser();
      if (!detected) {
        console.error('Error: No browser detected. Install Edge, Chrome, or Firefox, or specify --browser=<name>.');
        process.exit(1);
      }
      openOpts.browserName = detected;
    }
    if (args.headed) openOpts.headed = true;
    if (args.cdp) openOpts.cdpEndpoint = args.cdp;
    if (args.profile) openOpts.profilePath = args.profile;
    // v0.10: remote/grid/custom-browser flags.
    if (args.endpoint) {
      if (args.cdp) {
        console.error('Error: --endpoint and --cdp are mutually exclusive (remote WebDriver vs local CDP attach)');
        process.exit(1);
      }
      openOpts.endpoint = args.endpoint;
    }
    if (args['browser-args']) openOpts.browserArgs = args['browser-args'];
    if (args['browser-binary']) openOpts.browserBinary = args['browser-binary'];
    if (args['driver-binary']) openOpts.driverBinary = args['driver-binary'];
    if (args.capabilities) {
      try {
        openOpts.capabilities = JSON.parse(args.capabilities);
      } catch (e: any) {
        console.error(`Error: Invalid --capabilities JSON: ${e.message}`);
        process.exit(1);
      }
    }
    if (args.persistent) {
      openOpts.persistent = true;
      // Auto-assign profile path
      const wsHash = workspaceHash(workspaceDir);
      openOpts.profilePath = path.join(baseDaemonDir(), 'profiles', wsHash, sessionName);
    }
    if (args['idle-timeout'] !== undefined) openOpts.idleTimeout = Number(args['idle-timeout']);
    // v0.8: environment emulation flags — validated here so the CLI reports
    // a clear error before any browser is spawned.
    const emulation: any = {};
    if (args.viewport) {
      const { parseViewport } = require('./daemon/tools/emulation-state');
      emulation.viewport = parseViewport(args.viewport);
    }
    if (args['user-agent']) emulation.userAgent = args['user-agent'];
    if (args.locale) emulation.locale = args.locale;
    if (args['color-scheme']) {
      if (args['color-scheme'] !== 'light' && args['color-scheme'] !== 'dark') {
        console.error('Error: --color-scheme must be "light" or "dark"');
        process.exit(1);
      }
      emulation.colorScheme = args['color-scheme'];
    }
    if (args.timezone) emulation.timezone = args.timezone;
    if (args.geolocation) {
      const { parseGeolocation } = require('./daemon/tools/emulation-state');
      emulation.geolocation = parseGeolocation(args.geolocation);
    }
    if (args.permissions) {
      emulation.permissions = args.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
    }
    if (Object.keys(emulation).length > 0) openOpts.emulation = emulation;
    const startResult = await session.startDaemon(openOpts);
    if (startResult === 'reused') {
      console.log(`(reusing existing browser session "${sessionName}" — no new window opened. Run "se-cli close" to stop it.)`);
    }
    if (url) {
      const resp = await session.run(['goto', url], cwd, { raw: args.raw, json: args.json });
      render(resp);
    }
    return;
  }

  // install-browser — install/verify the WebDriver for a browser via
  // Selenium Manager (spec §6.1/§9: suggested on driver startup failure).
  if (cmd === 'install-browser') {
    let browserName: string;
    try {
      browserName = resolveBrowserName(args._[1]);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    console.log(`Installing ${browserName} driver via Selenium Manager...`);
    try {
      const result = await installBrowser(browserName as any);
      console.log(`✓ Driver installed: ${result.driverPath}`);
      if (result.browserPath) console.log(`  Browser: ${result.browserPath}`);
      else console.log('  (browser not found — install it or pass --browser-binary)');
    } catch (e: any) {
      console.error(`Error: driver installation failed: ${e.message}`);
      console.error('Hint: install the browser manually, or check the Selenium Manager documentation.');
      process.exit(1);
    }
    return;
  }

  // Grid management (v0.10): status query, attach alias, shard planning.
  if (cmd === 'grid') {
    const { gridStatus, formatGridStatus, parseShard, computeShardPlan } = require('./grid');
    const sub = args._[1];
    if (sub === 'status') {
      const url = args.endpoint || args._[2];
      if (!url) {
        console.error('Error: grid status requires a Grid URL. Usage: se-cli grid status <url> [--endpoint=<url>]');
        process.exit(1);
      }
      gridStatus(url).then((s: any) => {
        console.log(formatGridStatus(s));
      });
      return;
    }
    if (sub === 'attach') {
      // Alias for `open --endpoint=<url>`: attach to a Grid/remote driver.
      if (!args.endpoint) {
        console.error('Error: grid attach requires --endpoint=<url>. Usage: se-cli grid attach --endpoint=<grid-url> [--browser=<name>]');
        process.exit(1);
      }
      const startResult = await session.startDaemon({
        endpoint: args.endpoint,
        browserName: args.browser,
      });
      if (startResult === 'reused') {
        console.log(`(reusing existing browser session "${sessionName}" — run "se-cli close" to stop it.)`);
      }
      return;
    }
    if (sub === 'distribute') {
      if (!args.shard) {
        console.error('Error: grid distribute requires --shard=<index>/<total>. Usage: se-cli grid distribute --shard=1/4 [--browsers=a,b,c]');
        process.exit(1);
      }
      let spec: any;
      try {
        spec = parseShard(args.shard);
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      const list = args.browsers ? String(args.browsers).split(',').map((s: string) => s.trim()).filter(Boolean)
        : ['chrome', 'edge', 'firefox'];
      const plan = computeShardPlan(list, spec);
      console.log(`Shard ${plan.index}/${plan.total}: ${plan.items.length === 0 ? '(no browsers assigned)' : plan.items.join(', ')}`);
      return;
    }
    console.error('Error: unknown grid subcommand. Supported: status, attach, distribute');
    process.exit(1);
  }

  // MCP Server mode — start a long-lived MCP server over stdio or HTTP
  if (cmd === 'mcp-server') {
    const { startMcpServer } = require('./mcp-server');
    const port = args.port === undefined ? 8931 : Number(args.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`Error: Invalid --port: "${args.port}". Use an integer between 0 and 65535.`);
      process.exit(1);
    }
    startMcpServer(workspaceDir, {
      http: !!args.http,
      port,
      host: args.host || '127.0.0.1',
    });
    return;
  }

  if (cmd === 'install') {
    // v0.9: multi-target skill installation
    //   se-cli install [--skills] [--agent=claude,cursor,copilot] [--path=dir] [--force] [--list-agents]

    if (args['list-agents']) {
      for (const { name, dir } of listAgentTargets()) {
        console.log(`${name}\t${dir}`);
      }
      console.log('custom\t<requires --path=<dir>>');
      return;
    }

    if (args.path && args.agent) {
      console.error('Error: --path and --agent are mutually exclusive.');
      process.exit(1);
    }
    if (args.agent !== undefined && typeof args.agent !== 'string') {
      console.error('Error: --agent requires a value, e.g. --agent=claude,cursor (see --list-agents).');
      process.exit(1);
    }
    if (args.path !== undefined && typeof args.path !== 'string') {
      console.error('Error: --path requires a value, e.g. --path=./my-agent/skills/.');
      process.exit(1);
    }

    let targets: string[];
    if (args.path) {
      targets = ['custom'];
    } else if (args.agent) {
      try {
        targets = parseAgentList(args.agent);
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
    } else {
      // Legacy positional form: `se-cli install claude` (v0.2).
      const positional = args._[1];
      if (positional && AGENTS[positional]) {
        targets = [positional];
      } else if (positional) {
        console.error(`Unknown target: ${positional}. Supported: ${Object.keys(AGENTS).join(', ')}, custom (with --path).`);
        process.exit(1);
      } else {
        // Auto-detect which agent directories exist in this project.
        targets = detectInstalledAgents(cwd);
        if (targets.length === 0) {
          console.error(
            'Error: No agent skill directories detected (.claude/, .cursor/, .github/copilot/). ' +
              'Use --agent=<names> or --path=<dir> to choose a target.'
          );
          process.exit(1);
        }
      }
    }

    const sourceDir = path.join(__dirname, '..', 'skill');
    if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
      console.error('SKILL.md not found in package. This may be a development installation.');
      process.exit(1);
    }

    let result: { installed: string[]; skipped: string[] };
    try {
      result = installSkills({
        targets,
        cwd,
        force: !!args.force,
        sourceDir,
        customDir: args.path,
      });
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }

    for (const file of result.installed) console.log(`Installed SKILL.md to ${file}`);
    for (const file of result.skipped) {
      console.log(`Skipped (already exists, use --force to overwrite): ${file}`);
    }
    if (result.installed.length === 0 && result.skipped.length === 0) {
      console.log('Nothing to install.');
    }
    return;
  }

  if (cmd === 'close') {
    if (args.all) {
      // Close every session across ALL workspaces — multiple projects each
      // run their own daemon+browser window, so closing only the current
      // workspace's sessions would leave windows piling up elsewhere.
      const registry = new Registry(baseDaemonDir());
      const entries = registry.listAllSessions();
      for (const { config } of entries) {
        const sess = new Session(config.workspaceDir, config.name);
        try { await sess.stop(); } catch {}
      }
      return;
    }
    await session.stop();
    return;
  }

  if (cmd === 'logs') {
    // Print the tail of this session's daemon + CLI log files. The daemon is
    // detached and its stdio is unreachable from the CLI, so the log files
    // under %LOCALAPPDATA%/ms-se-cli/daemon/logs are the only window into
    // its runtime behavior (driver builds, resets, crashes, command times).
    const logDir = path.join(baseDaemonDir(), 'logs');
    const wsHash = workspaceHash(workspaceDir);
    const tail = Math.max(1, Number(args['tail'] || 50));
    const files = [
      `${wsHash}-${sessionName}.daemon.log`,
      `${wsHash}-${sessionName}.cli.log`,
    ];
    let printed = false;
    for (const f of files) {
      const fp = path.join(logDir, f);
      if (!fs.existsSync(fp)) continue;
      printed = true;
      console.log(`--- ${f} ---`);
      const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
      for (const line of lines.slice(-tail)) console.log(line);
    }
    if (!printed) console.log('(no log files yet — run `se-cli open` first)');
    return;
  }

  if (cmd === 'sessions') {
    // Global session overview across all workspaces. Each project (workspace)
    // owns a daemon + browser window; this shows which are still alive so the
    // user can close the ones they no longer need.
    const registry = new Registry(baseDaemonDir());
    const entries = registry.listAllSessions();
    for (const { config } of entries) {
      const alive = await new Session(config.workspaceDir, config.name).canConnect();
      const status = alive ? 'live' : 'dead';
      const mode = config.headed ? 'headed' : 'headless';
      console.log(
        `${config.workspaceDir}\t${config.name}\t${status}\t${config.browserName}\t${mode}\t${new Date(config.timestamp).toISOString()}`
      );
    }
    return;
  }

  if (cmd === 'list') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      const alive = await new Session(workspaceDir, s.name).canConnect();
      const status = alive ? 'live' : 'dead';
      console.log(`${s.name}\t${status}\t${s.browserName}\t${new Date(s.timestamp).toISOString()}`);
    }
    return;
  }

  if (cmd === 'close-all') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      const sess = new Session(workspaceDir, s.name);
      try { await sess.stop(); } catch {}
    }
    return;
  }

  if (cmd === 'kill-all') {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    const sessions = registry.listSessions(wsHash);
    for (const s of sessions) {
      // Force-kill daemon process if we have a PID
      const cfg = registry.loadSession(wsHash, s.name);
      if (cfg && cfg.pid) {
        try { process.kill(cfg.pid, 'SIGKILL'); } catch {}
      }
      // Also try graceful stop in case process is still alive
      const sess = new Session(workspaceDir, s.name);
      try { await sess.stop(); } catch {}
      registry.deleteSession(wsHash, s.name);
    }
    return;
  }

  // v0.4: config commands — handled locally, no daemon needed
  if (cmd === 'config') {
    const subCmd = args._[1];
    if (subCmd === 'get') {
      const key = args._[2];
      if (!key) {
        console.error('Usage: se-cli config get <key>');
        process.exit(1);
      }
      const fileConfig = loadConfigFile(cwd);
      if (!fileConfig) {
        console.log('(no config file found)');
        return;
      }
      const result = getConfigValue(fileConfig, key);
      if (result) {
        console.log(result.value);
      } else {
        console.log(`(not set: ${key})`);
      }
    } else if (subCmd === 'set') {
      const key = args._[2];
      const value = args._[3];
      if (!key || !value) {
        console.error('Usage: se-cli config set <key> <value>');
        process.exit(1);
      }
      setConfigValue(cwd, key, value);
      console.log(`Set ${key} = ${value}`);
    } else if (subCmd === 'list') {
      const resolved = resolveConfig({}, cwd, process.env as any);
      const lines = listConfig(resolved);
      for (const line of lines) console.log(line);
    } else if (subCmd === 'init') {
      generateTemplateConfig(cwd);
      console.log('Generated .se-cli.json');
    } else {
      console.error('Usage: se-cli config [get|set|list|init]');
      process.exit(1);
    }
    return;
  }

  // Tool commands — forward to daemon.
  // Strip CLI-level flags (--raw, --json, --headed, --browser, --cdp, -s, --session,
  // --persistent, --help) so the daemon only sees the command and its tool-specific
  // flags (e.g. --filename, --depth, --regex, --submit).
  const forwardArgs = filterCliFlags(argv);
  let resp: ServerMessage;
  try {
    resp = await session.run(forwardArgs, cwd, { raw: args.raw, json: args.json });
  } catch (e: any) {
    // Connection failed: clean up orphan session file and hint to reopen
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(workspaceDir);
    registry.deleteSession(wsHash, sessionName);
    console.error('### Error\nDaemon not reachable: ' + (e.message || e) + '\nHint: run `se-cli open` to start a new session.');
    process.exit(1);
  }
  render(resp);
}

/**
 * Strip CLI-level flags from the tool command args before forwarding to the
 * daemon. Handles both `--flag=value` and `--flag value` (space-separated)
 * forms — the space-separated value must be consumed too, otherwise it would
 * leak through as a positional arg (e.g. `-s dev click e1` would forward
 * 'dev' as an extra argument).
 */
export function filterCliFlags(argv: string[]): string[] {
  const cliFlags = new Set(['raw', 'json', 'headed', 'persistent', 'help', 'browser', 'cdp', 's', 'session', 'profile', 'idle-timeout', 'endpoint', 'browser-args', 'capabilities', 'browser-binary', 'driver-binary', 'shard', 'browsers']);
  const valueFlags = new Set(['browser', 'cdp', 'profile', 's', 'session', 'endpoint', 'browser-args', 'capabilities', 'browser-binary', 'driver-binary', 'shard', 'browsers']);
  const forwardArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = arg.match(/^-{1,2}([\w-]+)(=.*)?$/);
    if (!m || !cliFlags.has(m[1])) {
      forwardArgs.push(arg);
      continue;
    }
  // CLI-level flag — strip it, and consume its space-separated value
  // (only when the next arg looks like a value, not another flag).
  if (!m[2] && valueFlags.has(m[1]) && i + 1 < argv.length && !/^-{1,2}[a-zA-Z]/.test(argv[i + 1])) {
    i++;
  }
  }
  return forwardArgs;
}

export function findWorkspaceDir(cwd: string): string {
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.se-cli'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

function printHelp(): void {
  console.log(`se-cli - token-efficient Selenium browser automation

Usage:
  se-cli open [url] [--browser=chrome|edge|firefox] [--headed] [--cdp=url] [--profile=path] [--persistent] [--viewport=WxH] [--user-agent=ua] [--locale=tag] [--color-scheme=light|dark] [--timezone=tz] [--geolocation=lat,lon] [--permissions=geolocation]
  se-cli install [--skills] [--agent=claude,cursor,copilot] [--path=dir] [--force] [--list-agents]
  se-cli install-browser [chrome|edge|firefox]
                    install/verify the browser driver via Selenium Manager
  se-cli mcp-server [--http] [--port=8931] [--host=127.0.0.1]
                    start MCP server (stdio for VS Code / AI agents; --http for Streamable HTTP)
  se-cli close [--all]            stop current session; --all stops every session (all projects)
  se-cli sessions                 list all sessions across all projects (live/dead)
  se-cli logs [--tail=N]          show recent daemon log lines for this session
  se-cli list
  se-cli close-all
  se-cli kill-all
  se-cli config [get|set|list|init]
  se-cli -s=<name> <cmd>

Commands:
  goto <url>              navigate to url
  go-back / go-forward / reload
  click <ref|selector>    click element
  fill <ref|selector> <text>
  type <text>             type into focused element
  press <key>             press keyboard key
  select <ref> <value>    select dropdown option
  check <ref> / uncheck <ref>
  snapshot [ref] [--depth=N]
  find <text> / find --regex <pattern>
  screenshot [ref] [--filename=f]
  eval "<js>" [ref]
  run-code "<snippet>"    execute arbitrary Selenium snippet (receives driver; returned elements become refs)
  generate-locator <ref>   show recommended locator [--all] [--style=role|id|css|xpath]
  title / url
  cookie-list / cookie-get <name> / cookie-set <name> <val> / cookie-delete [name]
  localstorage-get <key> / localstorage-set <key> <val> / localstorage-delete [key] / localstorage-list
  sessionstorage-get <key> / sessionstorage-set <key> <val> / sessionstorage-delete [key] / sessionstorage-list
  tab-list / tab-new [url] / tab-close / tab-select <index>
  state-save [--filename=f] / state-load [--filename=f]
  config get <key>        get config value (e.g. wait.timeout)
  config set <key> <val>  set config value in .se-cli.json
  config list             list all config values with sources
  config init            generate template .se-cli.json

MCP Server:
  mcp-server              start MCP server in stdio mode (for VS Code / AI agents)
                          exposes all browser commands as MCP tools
  mcp-server --http       start MCP server with Streamable HTTP transport
                          (default port 8931; --port / --host to override)
                          endpoints: POST|GET|DELETE /mcp, Mcp-Session-Id

Interaction (v0.5):
  hover <ref>             mouse hover over element
  dblclick <ref>          double-click element
  drag <start> <end>     drag and drop element
  dialog-accept [text]    accept alert/confirm/prompt dialog
  dialog-dismiss          dismiss dialog
  upload <ref> <file>     upload file to input element
  resize <w> <h>          set viewport size
  keydown <key>          press and hold key
  keyup <key>             release held key
  mousemove <x> <y>      move mouse to coordinates
  mousedown [button]      press mouse button (left/right/middle)
  mouseup [button]        release mouse button
  mousewheel <dx> <dy>   scroll wheel by offsets
  actions-chain <json>    chain multiple actions in one perform()

Assertions (v0.6):
  expect <ref> visible    assert element is visible (exit 0/1)
  expect <ref> hidden     assert element is hidden
  expect <ref> enabled    assert element is enabled
  expect <ref> disabled   assert element is disabled
  expect <ref> checked    assert checkbox is checked
  expect <ref> unchecked  assert checkbox is unchecked
  expect <ref> text "..."  assert element text [--exact] [--not]
  expect <ref> value "..." assert input value [--exact] [--not]
  expect <ref> count N     assert matching element count
  expect <ref> attribute <name> <value>  assert attribute value
  expect title "..."       assert page title [--exact] [--not]
  expect url "..."         assert page URL [--exact] [--not]
  Flags: --not (invert), --exact (strict match), --timeout=<ms>

Network & Debugging (v0.7):
  highlight [ref]           outline element (default: 3px solid red)
  highlight <ref> --style="2px solid blue"
  highlight <ref> --hide    remove single highlight
  highlight --hide --all    remove all highlights
  console                   all buffered messages
  console error             error-level only
  console js-error          JS exceptions only
  console --since=5m        messages from last 5 minutes
  console --clear           clear buffer after output
  requests                  list all network requests
  requests --filter="api"   filter by URL substring
  requests --status=500     filter by status code
  requests --method=POST    filter by HTTP method
  requests --clear          clear request buffer
  request <index>           show request details (headers, body, response)
  route <pattern> --status=401 --body='{"error":"invalid"}'
  route-list                list active route mocks
  unroute <index>           remove specific route
  unroute --all             remove all routes

Emulation (v0.8):
  device <name>             apply device preset (e.g. "iPhone 13")
  device-list               list built-in device presets
  device                    show current emulation state
  emulate                   show current emulation state
  emulate --offline         go offline (Chrome/Edge)
  emulate --throttle-network=slow3g|fast3g|gprs|custom:download=,upload=,latency=
  emulate --throttle-cpu=4  CPU slowdown rate (Chrome/Edge)
  emulate --reset           restore runtime emulation (keeps open-time flags)

Flags:
  --raw                   output only the result value
  --json                  structured JSON output
  --locator-style=role    codegen style for interaction commands: role (default) | css | ref
  -s=<name>               session name
  --browser=chrome        browser (default: auto-detect Edge → Chrome → Firefox)
  --headed                show browser window (default headless)
  --cdp=<url>             attach to running Chrome via CDP
  --profile=<path>        use a persistent browser profile directory
  --persistent            keep browser profile across sessions (auto-assigns profile path)
  --idle-timeout=<min>    auto-close idle daemon after N minutes (default 30; 0 = never)

Emulation (v0.8, open-time; Chrome/Edge full, Firefox viewport only):
  --viewport=<WxH>        page viewport size, e.g. 1280x720
  --user-agent=<string>   override the browser user agent
  --locale=<tag>          override the page locale, e.g. zh-CN
  --color-scheme=<light|dark>  emulate prefers-color-scheme
  --timezone=<id>         override the timezone, e.g. America/New_York
  --geolocation=<lat,lon[,accuracy]>  override geolocation
  --permissions=<list>    grant permissions, e.g. geolocation,camera

Wait & Retry (v0.4):
  --timeout=<ms>          per-command explicit-wait timeout (default 5000)
  --wait=<state>          wait condition: visible|hidden|enabled|disabled|stable|attached|none|auto (default auto)
  --retry=<n>             failure retry count (default 0; -1 = until timeout)
  --retry-interval=<ms>   polling interval (default 100)
  --implicit-wait=<ms>    driver implicit wait (default 0)
  --page-load-timeout=<ms>  page load timeout (default 30000)
  --script-timeout=<ms>  script timeout for async eval (default 30000)
  --no-wait               shorthand for --wait=none --timeout=0

Environment:
  SE_CLI_TIMEOUT / SE_CLI_WAIT / SE_CLI_RETRY / SE_CLI_RETRY_INTERVAL
  SE_CLI_IMPLICIT_WAIT / SE_CLI_PAGE_LOAD_TIMEOUT / SE_CLI_SCRIPT_TIMEOUT
  SE_CLI_IDLE_TIMEOUT   daemon idle timeout in minutes (same as --idle-timeout)
`);
}
