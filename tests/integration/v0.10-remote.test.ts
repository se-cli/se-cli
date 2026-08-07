import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import {
  shouldRunE2E,
  resolveTestBrowsers,
  type BrowserName,
} from './detect-browsers';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const E2E_ENABLED = shouldRunE2E();
const RESOLVED_BROWSERS = resolveTestBrowsers();

/**
 * Pick the first available browser from `prefs`, based on what the current
 * CI job selected (SE_CLI_TEST_* env) or what is installed locally.
 * Returns undefined when none of the preferred browsers is available —
 * callers skip in that case (e.g. the safari job skips the pdf and
 * browser-args tests, which safaridriver does not support).
 */
function pickBrowser(prefs: BrowserName[]): BrowserName | undefined {
  for (const p of prefs) {
    if (RESOLVED_BROWSERS.includes(p)) return p;
  }
  return undefined;
}

let server: TestServer;
let gridMock: http.Server;
let gridPort = 0;
beforeAll(async () => {
  server = await startTestServer();
  // Minimal Selenium Grid 4 /status mock.
  gridMock = http.createServer((req, res) => {
    if (req.url?.endsWith('/status')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        value: {
          ready: true,
          message: 'Selenium Grid ready.',
          nodes: [{ id: 'n1', maxSession: 5, sessionCount: 1, slots: { chrome: {}, firefox: {} } }],
        },
      }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => gridMock.listen(0, '127.0.0.1', () => {
    gridPort = (gridMock.address() as any).port;
    resolve();
  }));
});
afterAll(async () => {
  await server.close();
  await new Promise<void>((resolve) => gridMock.close(() => resolve()));
});
const EXAMPLE_URL = () => server.url('example.html');

let counter = 0;
function S(): string {
  counter++;
  return `v010-${Date.now().toString(36)}-${counter}`;
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
    return ''; // did not fail — caller checks
  } catch (e: any) {
    return String(e.stderr || e.stdout || e.message);
  }
}

describe('v0.10: --endpoint (remote WebDriver / Grid)', () => {
  (E2E_ENABLED ? it : it.skip)('routes driver build to the endpoint (unreachable → clear ECONNREFUSED error)', async () => {
    const sess = S();
    // open does not block on driver build; the failure surfaces on the
    // first command and must reference the endpoint connection.
    await run(['open', '--browser=chrome', `--endpoint=http://127.0.0.1:1/wd/hub`], { SE_CLI_SESSION: sess });
    const err = await runExpectFail(['title'], { SE_CLI_SESSION: sess });
    expect(err).toContain('ECONNREFUSED');
    expect(err).toContain('127.0.0.1:1');
    await run(['close'], { SE_CLI_SESSION: sess }).catch(() => {});
  });

  (E2E_ENABLED ? it : it.skip)('rejects --endpoint combined with --cdp at the CLI', async () => {
    const sess = S();
    const err = await runExpectFail(
      ['open', '--browser=chrome', '--cdp=127.0.0.1:9222', '--endpoint=http://grid:4444'],
      { SE_CLI_SESSION: sess },
    );
    expect(err).toMatch(/mutually exclusive/i);
  });

  (E2E_ENABLED ? it : it.skip)('rejects invalid --capabilities JSON at the CLI', async () => {
    const sess = S();
    const err = await runExpectFail(
      ['open', '--browser=chrome', '--capabilities=not-json'],
      { SE_CLI_SESSION: sess },
    );
    expect(err).toMatch(/Invalid --capabilities JSON/);
  });
});

describe('v0.10: grid commands', () => {
  (E2E_ENABLED ? it : it.skip)('grid status prints a formatted summary from a live Grid', async () => {
    const out = await run(['grid', 'status', `http://127.0.0.1:${gridPort}/wd/hub`]);
    expect(out).toContain('Grid: http://127.0.0.1:');
    expect(out).toContain('Status: ready');
    expect(out).toContain('Nodes: 1');
    expect(out).toContain('Total slots: 5');
    expect(out).toContain('Browsers: chrome, firefox');
  });

  (E2E_ENABLED ? it : it.skip)('grid status reports an unreachable grid', async () => {
    const out = await run(['grid', 'status', 'http://127.0.0.1:1']);
    expect(out).toMatch(/Grid unreachable/i);
  });

  (E2E_ENABLED ? it : it.skip)('grid distribute computes the requested shard', async () => {
    const out = await run(['grid', 'distribute', '--shard=2/3']);
    expect(out).toContain('Shard 2/3:');
    expect(out).toContain('edge');
  });
});

describe('v0.10: pdf command', () => {
  // W3C print endpoint: Chrome/Edge/Firefox support it; Safari's
  // safaridriver does not (yet). Skipped on the safari job.
  const pdfBrowser = pickBrowser(['edge', 'chrome', 'firefox']);
  (E2E_ENABLED && pdfBrowser ? it : it.skip)(`saves the current page as a PDF in .se-cli (${pdfBrowser ?? 'skipped'})`, async () => {
    const sess = S();
    const pdfName = `v010-${Date.now()}.pdf`;
    await run(['open', EXAMPLE_URL(), `--browser=${pdfBrowser}`], { SE_CLI_SESSION: sess });

    const out = await run(['pdf', `--filename=${pdfName}`], { SE_CLI_SESSION: sess });
    expect(out).toContain('[PDF]');
    expect(out).toContain(pdfName);

    const file = path.join(process.cwd(), '.se-cli', pdfName);
    expect(fs.existsSync(file)).toBe(true);
    // PDF magic bytes
    const head = fs.readFileSync(file).subarray(0, 5).toString('ascii');
    expect(head).toBe('%PDF-');

    await run(['close'], { SE_CLI_SESSION: sess });
    fs.rmSync(file, { force: true });
  });
});

describe('v0.10: safari', () => {
  // Real Safari session coverage moved to tests/integration/v0.10-safari.test.ts
  // (8 tests covering the full safaridriver capability baseline). Running a
  // real session here too would race safaridriver's single-session pairing
  // with that suite, so the real-session test is skipped here.

  // On non-macOS platforms (CI: ubuntu/windows), safaridriver does not
  // exist — the session must fail cleanly instead of hanging.
  const SAFARI_UNAVAILABLE = E2E_ENABLED && process.platform !== 'darwin';
  (SAFARI_UNAVAILABLE ? it : it.skip)('fails clearly when --browser=safari is unavailable on this platform', async () => {
    const sess = S();
    await run(['open', '--browser=safari'], { SE_CLI_SESSION: sess });
    const err = await runExpectFail(['title'], { SE_CLI_SESSION: sess });
    // safaridriver does not exist on Linux/Windows — expect a build error, not a hang.
    expect(err.length).toBeGreaterThan(0);
    await run(['close'], { SE_CLI_SESSION: sess }).catch(() => {});
  });
});

describe('v0.10: --browser-args / --capabilities pass-through', () => {
  // Chromium/Firefox accept browser args + W3C capabilities; the safari
  // job skips (safaridriver ignores browser args).
  const argsBrowser = pickBrowser(['edge', 'chrome', 'firefox']);
  (E2E_ENABLED && argsBrowser ? it : it.skip)(`opens a real session with custom args and capabilities (${argsBrowser ?? 'skipped'})`, async () => {
    const sess = S();
    await run([
      'open',
      EXAMPLE_URL(),
      `--browser=${argsBrowser}`,
      '--browser-args=--disable-gpu --lang=zh-CN',
      '--capabilities={"acceptInsecureCerts":true}',
    ], { SE_CLI_SESSION: sess });

    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: sess })).trim();
    expect(title.length).toBeGreaterThan(0);

    await run(['close'], { SE_CLI_SESSION: sess });
  });
});

describe('v0.10: --browser-binary / --driver-binary pass-through', () => {
  (E2E_ENABLED ? it : it.skip)('fails clearly when --driver-binary points to a nonexistent driver', async () => {
    const sess = S();
    await run(['open', '--browser=chrome', '--driver-binary=C:\\nonexistent\\chromedriver.exe'], { SE_CLI_SESSION: sess });
    const err = await runExpectFail(['title'], { SE_CLI_SESSION: sess });
    expect(err.toLowerCase()).toMatch(/nonexistent|spawn|ENOENT|driver/i);
    await run(['close'], { SE_CLI_SESSION: sess }).catch(() => {});
  });

  (E2E_ENABLED ? it : it.skip)('fails clearly when --browser-binary points to a nonexistent browser', async () => {
    const sess = S();
    await run(['open', '--browser=chrome', '--browser-binary=C:\\nonexistent\\chrome.exe'], { SE_CLI_SESSION: sess });
    const err = await runExpectFail(['title'], { SE_CLI_SESSION: sess });
    expect(err.toLowerCase()).toMatch(/nonexistent|spawn|ENOENT|driver|binary/i);
    await run(['close'], { SE_CLI_SESSION: sess }).catch(() => {});
  });
});

