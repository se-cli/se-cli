import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import * as path from 'path';
import { shouldRunE2E } from './detect-browsers';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const E2E_ENABLED = shouldRunE2E();

// ── Local real remote WebDriver endpoint (Grid-node equivalent) ────────────
//
// `se-cli open --endpoint=<url>` connects to any W3C WebDriver HTTP server —
// exactly what a Selenium Grid node exposes. A locally spawned chromedriver
// IS such a server, so these tests exercise the real remote path (session
// creation, navigation, commands over HTTP) without needing a Java Grid.
//
// Some sandboxed/CI-less environments cannot create a Chrome user-data dir
// through a child-spawned driver; the probe below detects that and skips the
// real-remote suite automatically (GitHub Actions runners support it).

interface RemoteProbe {
  port: number;
  proc: ChildProcess;
}

async function probeRemoteDriver(): Promise<RemoteProbe | null> {
  let driverPath: string | null = null;
  try {
    // Resolve the chromedriver path exactly like `se-cli install-browser`
    // does (Selenium Manager cache).
    const { binaryPaths } = require('selenium-webdriver/common/seleniumManager');
    const r = binaryPaths(['--browser', 'chrome', '--output', 'json']);
    driverPath = r.driverPath || null;
  } catch {
    return null;
  }
  if (!driverPath) return null;

  const proc = spawn(driverPath, ['--port=0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout?.on('data', (d) => (output += d.toString()));
  proc.stderr?.on('data', (d) => (output += d.toString()));

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let port: number | null = null;
  for (let i = 0; i < 40 && port === null; i++) {
    await sleep(250);
    const m = output.match(/started successfully on port (\d+)/);
    if (m) port = Number(m[1]);
    if (proc.exitCode !== null) return null; // driver exited early
  }
  if (port === null) {
    proc.kill();
    return null;
  }

  // Probe: can this environment actually create a browser session through
  // the child-spawned driver? If not, skip the real-remote suite.
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            browserName: 'chrome',
            'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-gpu'] },
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      const j = (await resp.json()) as any;
      await fetch(`http://127.0.0.1:${port}/session/${j.value.sessionId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      proc.kill();
      return null;
    }
  } catch {
    proc.kill();
    return null;
  }
  return { port, proc };
}

let remote: RemoteProbe | null = null;
beforeAll(async () => {
  if (!E2E_ENABLED) return;
  remote = await probeRemoteDriver();
}, 60000);
afterAll(async () => {
  remote?.proc.kill();
}, 10000);

// ── Local page server (all navigation targets) ─────────────────────────────

let server: TestServer;
beforeAll(async () => {
  if (!E2E_ENABLED) return;
  server = await startTestServer();
}, 10000);
afterAll(async () => {
  await server?.close();
}, 10000);

// ── Mock Grid 4 hub (/status) ──────────────────────────────────────────────

let gridMock: http.Server;
let gridPort = 0;
let gridMode: 'ok' | 'notready' | 'empty' | 'http500' | 'badjson' = 'ok';

function startGridMock(): Promise<void> {
  return new Promise((resolve) => {
    gridMock = http.createServer((req, res) => {
      if (req.url?.endsWith('/status')) {
        if (gridMode === 'http500') {
          res.statusCode = 500;
          res.end('boom');
          return;
        }
        if (gridMode === 'badjson') {
          res.setHeader('content-type', 'application/json');
          res.end('{not-json');
          return;
        }
        if (gridMode === 'empty') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ value: { ready: false, nodes: [] } }));
          return;
        }
        if (gridMode === 'notready') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ value: { ready: false, message: 'starting up', nodes: [] } }));
          return;
        }
        // Default: a realistic Grid 4 multi-node payload.
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          value: {
            ready: true,
            message: 'Selenium Grid ready.',
            nodes: [
              {
                id: 'n1',
                uri: 'http://node1:5555',
                maxSession: 5,
                sessionCount: 1,
                slots: { chrome: {}, edge: {} },
              },
              {
                id: 'n2',
                uri: 'http://node2:5555',
                maxSession: 2,
                sessionCount: 0,
                slots: { firefox: {} },
              },
            ],
          },
        }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    gridMock.listen(0, '127.0.0.1', () => {
      gridPort = (gridMock.address() as any).port;
      resolve();
    });
  });
}

beforeAll(async () => {
  if (!E2E_ENABLED) return;
  await startGridMock();
}, 10000);
afterAll(async () => {
  await new Promise<void>((r) => gridMock.close(() => r()));
}, 10000);

const GRID_URL = () => `http://127.0.0.1:${gridPort}/wd/hub`;

let counter = 0;
function S(): string {
  counter++;
  return `grid-${Date.now().toString(36)}-${counter}`;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 90000,
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function runExpectFail(args: string[], env: Record<string, string> = {}): Promise<string> {
  try {
    await run(args, env);
    return '';
  } catch (e: any) {
    return String(e.stderr || e.stdout || e.message);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('v0.10 grid: status command', () => {
  (E2E_ENABLED ? it : it.skip)('renders a full multi-node Grid summary', async () => {
    const out = await run(['grid', 'status', GRID_URL()]);
    expect(out).toContain('Status: ready');
    expect(out).toContain('Nodes: 2');
    expect(out).toContain('Total slots: 7'); // 5 + 2
    expect(out).toContain('Active sessions: 1');
    expect(out).toContain('Browsers: chrome, edge, firefox');
  });

  (E2E_ENABLED ? it : it.skip)('accepts a URL ending in /status', async () => {
    const out = await run(['grid', 'status', `${GRID_URL()}/status`]);
    expect(out).toContain('Status: ready');
    expect(out).toContain('Nodes: 2');
  });

  (E2E_ENABLED ? it : it.skip)('accepts --endpoint= instead of a positional URL', async () => {
    const out = await run(['grid', 'status', `--endpoint=${GRID_URL()}`]);
    expect(out).toContain('Status: ready');
  });

  (E2E_ENABLED ? it : it.skip)('renders a not-ready Grid with its message', async () => {
    gridMode = 'notready';
    try {
      const out = await run(['grid', 'status', GRID_URL()]);
      expect(out).toMatch(/Status: not ready/);
      expect(out).toContain('starting up');
    } finally {
      gridMode = 'ok';
    }
  });

  (E2E_ENABLED ? it : it.skip)('renders an empty nodes payload', async () => {
    gridMode = 'empty';
    try {
      const out = await run(['grid', 'status', GRID_URL()]);
      expect(out).toContain('Status: not ready');
      expect(out).toContain('Nodes: 0');
    } finally {
      gridMode = 'ok';
    }
  });

  (E2E_ENABLED ? it : it.skip)('reports HTTP 500 from the hub', async () => {
    gridMode = 'http500';
    try {
      const out = await run(['grid', 'status', GRID_URL()]);
      expect(out).toMatch(/Grid unreachable/);
      expect(out).toContain('HTTP 500');
    } finally {
      gridMode = 'ok';
    }
  });

  (E2E_ENABLED ? it : it.skip)('reports malformed JSON gracefully', async () => {
    gridMode = 'badjson';
    try {
      const out = await run(['grid', 'status', GRID_URL()]);
      expect(out).toMatch(/Grid unreachable/);
    } finally {
      gridMode = 'ok';
    }
  });

  (E2E_ENABLED ? it : it.skip)('reports an unreachable grid (ECONNREFUSED)', async () => {
    const out = await run(['grid', 'status', 'http://127.0.0.1:1/wd/hub']);
    expect(out).toMatch(/Grid unreachable/i);
  });

  (E2E_ENABLED ? it : it.skip)('errors when no URL is given', async () => {
    const err = await runExpectFail(['grid', 'status']);
    expect(err).toMatch(/requires a Grid URL/i);
  });
});

describe('v0.10 grid: distribute command', () => {
  (E2E_ENABLED ? it : it.skip)('computes the requested shard from a spec', async () => {
    // 4 browsers round-robin across 3 shards: chrome→1, edge→2, firefox→3, safari→1.
    const out = await run(['grid', 'distribute', '--shard=2/3', '--browsers=chrome,edge,firefox,safari']);
    expect(out).toContain('Shard 2/3:');
    expect(out).toContain('edge');
    expect(out).not.toContain('chrome');
    expect(out).not.toContain('firefox');
    expect(out).not.toContain('safari');
  });

  (E2E_ENABLED ? it : it.skip)('shard 1/1 contains everything', async () => {
    const out = await run(['grid', 'distribute', '--shard=1/1', '--browsers=chrome,edge']);
    expect(out).toContain('Shard 1/1:');
    expect(out).toContain('chrome');
    expect(out).toContain('edge');
  });

  (E2E_ENABLED ? it : it.skip)('rejects out-of-range shard index', async () => {
    const err = await runExpectFail(['grid', 'distribute', '--shard=3/2']);
    expect(err).toMatch(/--shard/);
  });

  (E2E_ENABLED ? it : it.skip)('rejects malformed shard values', async () => {
    for (const bad of ['2/0', 'abc/2', '2', '1/x']) {
      const err = await runExpectFail(['grid', 'distribute', `--shard=${bad}`]);
      expect(err).toMatch(/--shard/);
    }
  });
});

describe('v0.10 grid: attach command', () => {
  (E2E_ENABLED ? it : it.skip)('errors when --endpoint is missing', async () => {
    const err = await runExpectFail(['grid', 'attach']);
    expect(err).toMatch(/--endpoint/);
  });

  // Real remote-session coverage: `grid attach` → open --endpoint, then run
  // commands through the remote driver (navigation, interaction, cookies).
  // Skipped automatically when the local environment cannot create a
  // session through a child-spawned driver (see probeRemoteDriver).
  const REMOTE = remote !== null;
  (E2E_ENABLED && REMOTE ? it : it.skip)('attaches to a real remote WebDriver and runs commands', async () => {
    const sess = S();
    const endpoint = `http://127.0.0.1:${remote!.port}`;
    await run(['grid', 'attach', `--endpoint=${endpoint}`, '--browser=chrome'], { SE_CLI_SESSION: sess });
    await run(['goto', server.url('example.html')], { SE_CLI_SESSION: sess });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: sess })).trim();
    expect(title.length).toBeGreaterThan(0);
    const url = (await run(['--raw', 'url'], { SE_CLI_SESSION: sess })).trim();
    expect(url).toContain('/example.html');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (E2E_ENABLED && REMOTE ? it : it.skip)('reuses the same remote session across commands', async () => {
    const sess = S();
    const endpoint = `http://127.0.0.1:${remote!.port}`;
    await run(['open', server.url('example.html'), '--browser=chrome', `--endpoint=${endpoint}`], { SE_CLI_SESSION: sess });
    // Second open returns "reused" — the remote driver stays alive.
    const reopen = await run(['open', '--browser=chrome', `--endpoint=${endpoint}`], { SE_CLI_SESSION: sess });
    expect(reopen).toMatch(/reusing/i);
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (E2E_ENABLED && REMOTE ? it : it.skip)('runs interaction + cookie commands remotely', async () => {
    const sess = S();
    const endpoint = `http://127.0.0.1:${remote!.port}`;
    await run(['open', server.url('example.html'), '--browser=chrome', `--endpoint=${endpoint}`], { SE_CLI_SESSION: sess });
    await run(['cookie-set', 'remote_k', 'remote_v'], { SE_CLI_SESSION: sess });
    const cookie = await run(['--raw', 'cookie-get', 'remote_k'], { SE_CLI_SESSION: sess });
    expect(cookie).toContain('remote_v');
    await run(['close'], { SE_CLI_SESSION: sess });
  });
});
