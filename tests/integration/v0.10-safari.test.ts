import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { shouldRunE2E, resolveTestBrowsers } from './detect-browsers';
import { startTestServer, type TestServer } from './test-server';

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');
const E2E_ENABLED = shouldRunE2E();
const RESOLVED_BROWSERS = resolveTestBrowsers();

// Safari (safaridriver) is macOS-only: local Windows/Linux dev machines
// skip the whole suite automatically; the GitHub Actions macOS job sets
// SE_CLI_TEST_SAFARI=1 so it runs there.
const SAFARI_AVAILABLE =
  E2E_ENABLED && process.platform === 'darwin' && RESOLVED_BROWSERS.includes('safari');

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 10000);
afterAll(async () => {
  await server?.close();
}, 10000);

const EXAMPLE_URL = () => server.url('example.html');
const LINKS_URL = () => server.url('links.html');
const BUTTONS_URL = () => server.url('buttons.html');
const STORAGE_URL = () => server.url('storage.html');

let counter = 0;
function S(): string {
  counter++;
  return `safari-${Date.now().toString(36)}-${counter}`;
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

async function open(url: string, sess: string): Promise<void> {
  await run(['open', url, '--browser=safari'], { SE_CLI_SESSION: sess });
}

/**
 * Safari/safaridriver capability baseline (selenium-webdriver support):
 *  - navigation / title / url          ✓ W3C WebDriver
 *  - find element + click/fill         ✓ W3C WebDriver
 *  - screenshot                        ✓ W3C WebDriver
 *  - cookies                           ✓ W3C WebDriver
 *  - executeScript (eval)              ✓ W3C WebDriver (incl. localStorage)
 *  - NOT supported: CDP, BiDi, network interception, emulation, headless
 *
 * The suite below covers exactly that baseline — nothing more, nothing less.
 */

describe('safari (real session, macOS only)', () => {
  (SAFARI_AVAILABLE ? it : it.skip)('opens a page, navigates, and reads title/url', async () => {
    const sess = S();
    await open(EXAMPLE_URL(), sess);
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: sess })).trim();
    expect(title.length).toBeGreaterThan(0);
    const url = (await run(['--raw', 'url'], { SE_CLI_SESSION: sess })).trim();
    expect(url).toContain('/example.html');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('goes to a new URL on the same session', async () => {
    const sess = S();
    await open(EXAMPLE_URL(), sess);
    await run(['goto', BUTTONS_URL()], { SE_CLI_SESSION: sess });
    const url = (await run(['--raw', 'url'], { SE_CLI_SESSION: sess })).trim();
    expect(url).toContain('/buttons.html');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('finds an element via snapshot and clicks by ref', async () => {
    const sess = S();
    await open(BUTTONS_URL(), sess);
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: sess });
    const refMatch = snapshot.match(/Increment \+1[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: sess });
    const count = (await run(['--raw', 'eval', `document.getElementById('count').textContent`], { SE_CLI_SESSION: sess })).trim();
    expect(count).toBe('1');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('navigates by clicking a link ref', async () => {
    const sess = S();
    await open(LINKS_URL(), sess);
    const snapshot = await run(['--raw', 'snapshot'], { SE_CLI_SESSION: sess });
    const refMatch = snapshot.match(/Go to Example Page[^\n]*ref=(e\d+)/);
    expect(refMatch).not.toBeNull();
    const ref = refMatch![1];
    await run(['click', ref], { SE_CLI_SESSION: sess });
    const title = (await run(['--raw', 'title'], { SE_CLI_SESSION: sess })).trim();
    expect(title).toBe('Example Domain');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('evaluates JavaScript (executeScript support)', async () => {
    const sess = S();
    await open(EXAMPLE_URL(), sess);
    const result = (await run(['--raw', 'eval', 'document.title'], { SE_CLI_SESSION: sess })).trim();
    expect(result.length).toBeGreaterThan(0);
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('sets and reads cookies (W3C cookie API)', async () => {
    const sess = S();
    await open(EXAMPLE_URL(), sess);
    await run(['cookie-set', 'safari_cookie', 'safari_value'], { SE_CLI_SESSION: sess });
    const result = await run(['--raw', 'cookie-get', 'safari_cookie'], { SE_CLI_SESSION: sess });
    expect(result).toContain('safari_cookie');
    expect(result).toContain('safari_value');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('reads and writes localStorage via eval', async () => {
    const sess = S();
    await open(STORAGE_URL(), sess);
    await run(['eval', `localStorage.setItem('safari_k', 'safari_v')`], { SE_CLI_SESSION: sess });
    const value = (await run(['--raw', 'eval', `localStorage.getItem('safari_k')`], { SE_CLI_SESSION: sess })).trim();
    expect(value).toContain('safari_v');
    await run(['close'], { SE_CLI_SESSION: sess });
  });

  (SAFARI_AVAILABLE ? it : it.skip)('takes a screenshot (W3C screenshot API)', async () => {
    const sess = S();
    await open(EXAMPLE_URL(), sess);
    const name = `safari-${Date.now()}.png`;
    await run(['screenshot', `--filename=${name}`], { SE_CLI_SESSION: sess });
    const file = path.join(process.cwd(), '.se-cli', name);
    expect(fs.existsSync(file)).toBe(true);
    // PNG magic bytes
    const head = fs.readFileSync(file).subarray(0, 8).toString('hex');
    expect(head).toBe('89504e470d0a1a0a');
    fs.rmSync(file, { force: true });
    await run(['close'], { SE_CLI_SESSION: sess });
  });
});
