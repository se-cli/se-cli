import { describe, it, expect } from 'vitest';
import {
  parseBrowserArgs,
  parseCapabilities,
  buildDriverSpec,
  DriverSpecInput,
} from '../../src/driver-options';

describe('parseBrowserArgs', () => {
  it('splits space-separated flags', () => {
    expect(parseBrowserArgs('--disable-gpu --lang=zh-CN --headless')).toEqual([
      '--disable-gpu', '--lang=zh-CN', '--headless',
    ]);
  });

  it('groups quoted values with spaces', () => {
    expect(parseBrowserArgs('--user-agent="Mozilla/5.0 test" --foo')).toEqual([
      '--user-agent=Mozilla/5.0 test', '--foo',
    ]);
  });

  it('supports single quotes too', () => {
    expect(parseBrowserArgs("--lang='zh CN'")).toEqual(['--lang=zh CN']);
  });

  it('returns empty array for empty or whitespace input', () => {
    expect(parseBrowserArgs('')).toEqual([]);
    expect(parseBrowserArgs('   ')).toEqual([]);
  });
});

describe('parseCapabilities', () => {
  it('parses a valid JSON object', () => {
    expect(parseCapabilities('{"acceptInsecureCerts":true,"browserName":"chrome"}')).toEqual({
      acceptInsecureCerts: true,
      browserName: 'chrome',
    });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCapabilities('not-json')).toThrow(/Invalid --capabilities JSON/);
  });

  it('throws on non-object JSON (array / null / primitive)', () => {
    expect(() => parseCapabilities('[1,2]')).toThrow(/must be a JSON object/);
    expect(() => parseCapabilities('null')).toThrow(/must be a JSON object/);
    expect(() => parseCapabilities('"str"')).toThrow(/must be a JSON object/);
  });
});

describe('buildDriverSpec', () => {
  const base: DriverSpecInput = { browserName: 'chrome', headed: false };

  it('maps edge to MicrosoftEdge and chrome/firefox as-is', () => {
    expect(buildDriverSpec({ browserName: 'edge', headed: true }).seleniumBrowserName).toBe('MicrosoftEdge');
    expect(buildDriverSpec({ browserName: 'chrome', headed: true }).seleniumBrowserName).toBe('chrome');
    expect(buildDriverSpec({ browserName: 'firefox', headed: true }).seleniumBrowserName).toBe('firefox');
  });

  it('sets usingServer when endpoint is provided', () => {
    const spec = buildDriverSpec({ ...base, endpoint: 'http://grid:4444/wd/hub' });
    expect(spec.usingServer).toBe('http://grid:4444/wd/hub');
  });

  it('omits usingServer when no endpoint', () => {
    expect(buildDriverSpec(base).usingServer).toBeUndefined();
  });

  it('appends user browser args to chrome headless defaults', () => {
    const spec = buildDriverSpec({ ...base, browserArgs: ['--disable-gpu', '--lang=zh-CN'] });
    expect(spec.chromeOptions!.args).toContain('--headless=new');
    expect(spec.chromeOptions!.args).toContain('--disable-gpu');
    expect(spec.chromeOptions!.args).toContain('--lang=zh-CN');
    // defaults preserved
    expect(spec.chromeOptions!.args).toContain('--no-sandbox');
  });

  it('merges capabilities into extraCapabilities', () => {
    const spec = buildDriverSpec({ ...base, capabilities: { acceptInsecureCerts: true, 'goog:loggingPrefs': { browser: 'ALL' } } });
    expect(spec.extraCapabilities.acceptInsecureCerts).toBe(true);
    expect((spec.extraCapabilities['goog:loggingPrefs'] as any).browser).toBe('ALL');
  });

  it('applies env binary override for chrome when set', () => {
    const spec = buildDriverSpec({ ...base, envBinaries: { chrome: 'C:\\custom\\chrome.exe' } });
    expect(spec.chromeOptions!.binary).toBe('C:\\custom\\chrome.exe');
  });

  it('does not set binary when env binary absent', () => {
    expect(buildDriverSpec(base).chromeOptions!.binary).toBeUndefined();
  });

  it('builds firefox options with -headless when not headed', () => {
    const spec = buildDriverSpec({ browserName: 'firefox', headed: false });
    expect(spec.firefoxOptions!.args).toContain('-headless');
  });

  it('sets debuggerAddress when cdpEndpoint provided', () => {
    const spec = buildDriverSpec({ ...base, cdpEndpoint: '127.0.0.1:9222' });
    expect(spec.chromeOptions!.debuggerAddress).toBe('127.0.0.1:9222');
  });

  it('combines endpoint + browserArgs + capabilities together', () => {
    const spec = buildDriverSpec({
      browserName: 'edge',
      headed: false,
      endpoint: 'http://grid:4444',
      browserArgs: ['--foo'],
      capabilities: { platformName: 'linux' },
    });
    expect(spec.usingServer).toBe('http://grid:4444');
    expect(spec.edgeOptions!.args).toContain('--foo');
    expect(spec.extraCapabilities.platformName).toBe('linux');
  });
});
