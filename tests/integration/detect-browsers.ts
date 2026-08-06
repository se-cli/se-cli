/**
 * Local browser auto-detection for integration tests.
 *
 * When running integration tests locally without explicit SE_CLI_TEST_*
 * environment variables, this module probes the system for installed
 * browsers and returns them in priority order: Edge → Chrome → Firefox →
 * Safari (macOS).
 *
 * CI pipelines always set explicit SE_CLI_TEST_* vars, so auto-detection
 * is only used for local development convenience.
 */
import * as fs from 'fs';
import { execSync } from 'child_process';

export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari';

/** Common installation paths, keyed by platform. */
const BROWSER_PATHS: Record<BrowserName, Record<string, string[]>> = {
  edge: {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    linux: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  },
  chrome: {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  },
  firefox: {
    win32: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ],
    linux: ['/usr/bin/firefox', '/usr/bin/firefox-esr'],
    darwin: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
  },
  safari: {
    // safaridriver ships with macOS; the Safari app is its driver target.
    darwin: [
      '/usr/bin/safaridriver',
      '/Applications/Safari.app/Contents/MacOS/Safari',
    ],
  },
};

/** Binary names to search for on PATH (via which/where). */
const PATH_NAMES: Record<BrowserName, string[]> = {
  edge: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'],
  firefox: ['firefox'],
  safari: ['safaridriver'],
};

/** Check if a command exists on PATH using which (Unix) or where (Windows). */
function findOnPath(name: string): boolean {
  const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if a browser is installed by probing common paths and PATH. */
function isBrowserAvailable(browser: BrowserName): boolean {
  const platform = process.platform;
  const paths = BROWSER_PATHS[browser][platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) return true;
  }
  for (const name of PATH_NAMES[browser]) {
    if (findOnPath(name)) return true;
  }
  return false;
}

/**
 * Detect which browsers are installed on the local system.
 * Returns browser names in priority order: edge, chrome, firefox, safari.
 */
export function detectBrowsers(): BrowserName[] {
  const priority: BrowserName[] = ['edge', 'chrome', 'firefox', 'safari'];
  return priority.filter((b) => isBrowserAvailable(b));
}

/**
 * Resolve which browsers to test based on environment variables and local detection.
 *
 * Resolution order:
 * 1. If any SE_CLI_TEST_* env var is explicitly set → use those (CI mode).
 * 2. If SE_CLI_E2E=1 is set but no SE_CLI_TEST_* → auto-detect locally.
 * 3. If nothing is set → auto-detect (caller decides whether to run).
 *
 * CI always sets both SE_CLI_E2E and a single SE_CLI_TEST_<browser>,
 * so auto-detection never triggers in CI.
 */
export function resolveTestBrowsers(): BrowserName[] {
  // CI mode: explicit browser selection takes precedence
  const explicit: BrowserName[] = [];
  if (process.env.SE_CLI_TEST_EDGE) explicit.push('edge');
  if (process.env.SE_CLI_TEST_CHROME) explicit.push('chrome');
  if (process.env.SE_CLI_TEST_FIREFOX) explicit.push('firefox');
  if (process.env.SE_CLI_TEST_SAFARI) explicit.push('safari');

  if (explicit.length > 0) {
    return explicit;
  }

  // Local mode: auto-detect installed browsers
  return detectBrowsers();
}

/**
 * Whether integration tests should run at all.
 * - True if SE_CLI_E2E=1 is set (explicit opt-in)
 * - True if any SE_CLI_TEST_* is set (CI mode, implies E2E)
 * - False otherwise (safe default — unit tests still run via `npm test`)
 */
export function shouldRunE2E(): boolean {
  if (process.env.SE_CLI_E2E) return true;
  if (
    process.env.SE_CLI_TEST_CHROME ||
    process.env.SE_CLI_TEST_EDGE ||
    process.env.SE_CLI_TEST_FIREFOX ||
    process.env.SE_CLI_TEST_SAFARI
  ) {
    return true;
  }
  return false;
}
