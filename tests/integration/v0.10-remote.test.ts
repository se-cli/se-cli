import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { shouldRunE2E } from './detect-browsers';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const E2E_ENABLED = shouldRunE2E();

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
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

describe('v0.10: --browser-args / --capabilities pass-through', () => {
  (E2E_ENABLED ? it : it.skip)('opens a real Edge session with custom args and capabilities', async () => {
    const sess = S();
    await run([
      'open',
      EXAMPLE_URL(),
      '--browser=edge',
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

