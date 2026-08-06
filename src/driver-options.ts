import type { SessionConfig } from './registry';

/**
 * Driver build options (v0.10: Remote, Grid & Custom Browsers).
 *
 * Pure functions that turn CLI/daemon flags into a selenium-webdriver
 * Builder configuration. Extracted from src/daemon/server.ts so the
 * parsing and capability-assembly logic is unit-testable; the daemon
 * applies the returned spec to its Builder.
 */

export interface DriverSpecInput {
  browserName: 'chrome' | 'edge' | 'firefox' | 'safari';
  headed: boolean;
  cdpEndpoint?: string;
  profilePath?: string;
  /** --endpoint=<url>: connect to Selenium Grid 4 / remote WebDriver. */
  endpoint?: string;
  /** --browser-args="...": pass-through browser launch arguments. */
  browserArgs?: string[];
  /** --capabilities=<json>: pass-through arbitrary W3C capabilities. */
  capabilities?: Record<string, unknown>;
  /** --browser-binary=<path>: custom browser executable (overrides env binary). */
  browserBinary?: string;
  /** --driver-binary=<path>: custom driver executable (bypasses selenium-manager). */
  driverBinary?: string;
  /** env binary overrides (SE_CHROME_BINARY / SE_EDGE_BINARY / SE_FIREFOX_BINARY). */
  envBinaries?: { chrome?: string; edge?: string; firefox?: string };
}

export interface DriverSpec {
  /** selenium-webdriver browser name ('MicrosoftEdge' for edge). */
  seleniumBrowserName: string;
  /** Remote WebDriver / Grid URL, when --endpoint is set. */
  usingServer?: string;
  /** Custom driver executable, when --driver-binary is set. */
  driverBinary?: string;
  /** Capabilities merged from --capabilities (and defaults set by daemon). */
  extraCapabilities: Record<string, unknown>;
  chromeOptions?: {
    args: string[];
    excludeSwitches?: string[];
    debuggerAddress?: string;
    binary?: string;
  };
  edgeOptions?: {
    args: string[];
    excludeSwitches?: string[];
    debuggerAddress?: string;
    binary?: string;
  };
  firefoxOptions?: {
    args?: string[];
    profile?: string;
    binary?: string;
  };
}

/** The profile path travels in SessionConfig as `profilePath` (used by caller). */
export type { SessionConfig };

/**
 * Parse a `--browser-args="..."` string into individual arguments.
 * Supports space separation and single/double-quoted groups anywhere in
 * a token:
 *   `--disable-gpu --user-agent="Mozilla/5.0 test"` → ['--disable-gpu', '--user-agent=Mozilla/5.0 test']
 */
export function parseBrowserArgs(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let inToken = false;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (ch === ' ' || ch === '\t') {
      if (inToken) {
        out.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inToken) out.push(current);
  return out;
}

/**
 * Parse a `--capabilities=<json>` string into a W3C capabilities object.
 * Throws with a clear message on invalid JSON or non-object values.
 */
export function parseCapabilities(input: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (e: any) {
    throw new Error(`Invalid --capabilities JSON: ${e.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('--capabilities must be a JSON object, e.g. --capabilities=\'{"acceptInsecureCerts":true}\'');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Compose the Builder spec from daemon flags. Chromium throttling flags
 * are only added in headless mode without a CDP attach (same policy as
 * before, now centralized here).
 */
export function buildDriverSpec(input: DriverSpecInput): DriverSpec {
  const { browserName, headed, cdpEndpoint, profilePath } = input;
  const seleniumBrowserName = browserName === 'edge' ? 'MicrosoftEdge' : browserName;
  const userArgs = input.browserArgs ?? [];
  const extraCapabilities: Record<string, unknown> = { ...(input.capabilities ?? {}) };

  const chromiumDefaults = [
    '--disable-logging', '--log-level=3', '--disable-breakpad',
  ];
  const headlessThrottling = [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];

  const spec: DriverSpec = { seleniumBrowserName, extraCapabilities };
  if (input.endpoint) spec.usingServer = input.endpoint;
  if (input.driverBinary) spec.driverBinary = input.driverBinary;

  if (browserName === 'chrome' || browserName === 'edge') {
    const isChrome = browserName === 'chrome';
    const args = [...chromiumDefaults];
    if (!headed && !cdpEndpoint) args.push(...headlessThrottling);
    if (profilePath) args.push(`--user-data-dir=${profilePath}`);
    args.push(...userArgs);
    const opts: DriverSpec['chromeOptions'] = {
      args,
      excludeSwitches: ['enable-logging', 'disable-extensions'],
    };
    if (cdpEndpoint) opts.debuggerAddress = cdpEndpoint;
    const binary = input.browserBinary || input.envBinaries?.[browserName];
    if (binary) opts.binary = binary;
    if (isChrome) spec.chromeOptions = opts;
    else spec.edgeOptions = opts;
  } else if (browserName === 'firefox') {
    const opts: DriverSpec['firefoxOptions'] = {};
    const args: string[] = [];
    if (!headed) args.push('-headless');
    if (userArgs.length > 0) args.push(...userArgs);
    if (args.length > 0) opts.args = args;
    if (profilePath) opts.profile = profilePath;
    const binary = input.browserBinary || input.envBinaries?.firefox;
    if (binary) opts.binary = binary;
    spec.firefoxOptions = opts;
  }
  // safari: no options needed — safaridriver needs no browserOptions.

  return spec;
}
