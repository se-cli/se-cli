/**
 * Comprehensive coverage tests to boost code coverage from 89% to 95%+.
 *
 * Covers uncovered branches in:
 *  1.  Tool _wait paths (click, fill, check, goto, interactions)
 *  2.  shared.ts findElementWithWait polling logic
 *  3.  state.ts error paths and SameSite cookie sanitization
 *  4.  find.ts search paths
 *  5.  snapshot.ts retry/empty paths
 *  6.  storage.ts sessionstorage paths
 *  7.  tab.ts edge cases
 *  8.  minimist.ts edge cases
 *  9.  config.ts platform branches
 * 10.  wait-config.ts remaining paths (attached condition body, default case)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Key } from 'selenium-webdriver';

import { Response } from '../../src/response';
import { browser_click } from '../../src/daemon/tools/click';
import { browser_fill } from '../../src/daemon/tools/fill';
import { browser_check, browser_uncheck } from '../../src/daemon/tools/check';
import { browser_goto } from '../../src/daemon/tools/goto';
import { browser_hover, browser_dblclick, browser_drag } from '../../src/daemon/tools/interactions';
import { findElementWithWait } from '../../src/daemon/tools/shared';
import { browser_state_save, browser_state_load } from '../../src/daemon/tools/state';
import { browser_find } from '../../src/daemon/tools/find';
import { browser_snapshot } from '../../src/daemon/tools/snapshot';
import {
  browser_sessionstorage_delete,
  browser_sessionstorage_list,
} from '../../src/daemon/tools/storage';
import { browser_tab_close, browser_tab_select } from '../../src/daemon/tools/tab';
import { parseArgs } from '../../src/minimist';
import {
  makeSocketPath,
  baseDaemonDir,
  userHash,
  sessionFileDir,
  sessionFilePath,
  outputDir,
} from '../../src/config';
import {
  waitForElementState,
  resolveConfig,
  type WaitConfig,
  type ParsedFlags,
} from '../../src/wait-config';
import { browser_press } from '../../src/daemon/tools/press';
import { browser_mousedown } from '../../src/daemon/tools/advanced-input';
import { browser_console } from '../../src/daemon/tools/console';
import { Registry } from '../../src/registry';
import type { SessionConfig } from '../../src/registry';
import { browser_dialog_accept, browser_dialog_dismiss } from '../../src/daemon/tools/dialog';
import { render, CliError } from '../../src/output';
import { browser_highlight } from '../../src/daemon/tools/highlight';
import {
  browser_cookie_set,
  browser_cookie_delete,
  browser_localstorage_get,
  browser_localstorage_delete,
  browser_sessionstorage_get,
} from '../../src/daemon/tools/storage';
import { addHighlight, clearAllHighlights, addRoute, removeAllRoutes, getRoutes } from '../../src/daemon/tools/network-state';
import { callTool, parseCommand } from '../../src/daemon/backend';
import { browser_expect } from '../../src/daemon/tools/expect';
import { Session } from '../../src/session';
import { filterCliFlags } from '../../src/program';
import { browser_route_list, browser_unroute } from '../../src/daemon/tools/route';

// Mock network-state to make ensureBidiInitialized a no-op and getNetwork
// return a mock object, enabling route_list/unroute tests without a real BiDi driver.
vi.mock('../../src/daemon/tools/network-state', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    ensureBidiInitialized: vi.fn(async () => {}),
    getNetwork: vi.fn(() => ({
      addIntercept: vi.fn(async () => 'intercept-1'),
      removeIntercept: vi.fn(async () => {}),
      beforeRequestSent: vi.fn(async () => {}),
      provideResponse: vi.fn(async () => {}),
      continueRequest: vi.fn(async () => {}),
    })),
  };
});

// ── Mock driver factory ───────────────────────────────────────────

function makeMockDriver(opts: any = {}): any {
  const actionsMock = {
    move: vi.fn().mockReturnThis(),
    doubleClick: vi.fn().mockReturnThis(),
    dragAndDrop: vi.fn().mockReturnThis(),
    press: vi.fn().mockReturnThis(),
    release: vi.fn().mockReturnThis(),
    scroll: vi.fn().mockReturnThis(),
    perform: vi.fn(async () => {}),
  };
  const el = {
    click: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    isSelected: vi.fn(async () => opts.selected ?? false),
    getAttribute: vi.fn(async () => ''),
    getTagName: vi.fn(async () => 'div'),
    isDisplayed: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
  };
  return {
    getTitle: vi.fn(async () => opts.title ?? 'Test Page'),
    getCurrentUrl: vi.fn(async () => opts.url ?? 'https://example.com'),
    findElement: vi.fn(async () => el),
    executeScript: vi.fn(async () => opts.scriptResult ?? ''),
    wait: vi.fn(async () => {}),
    manage: vi.fn(() => ({
      setTimeouts: vi.fn(async () => {}),
      window: vi.fn(() => ({ setRect: vi.fn(async () => {}) })),
      getCookies: vi.fn(async () => opts.cookies ?? []),
      getCookie: vi.fn(async () => null),
      deleteAllCookies: vi.fn(async () => {}),
      addCookie: vi.fn(async () => {}),
      deleteCookie: vi.fn(async () => {}),
    })),
    switchTo: vi.fn(() => ({
      window: vi.fn(async () => {}),
      newWindow: vi.fn(async () => {}),
      defaultContent: vi.fn(async () => {}),
      frame: vi.fn(async () => {}),
    })),
    getAllWindowHandles: vi.fn(async () => opts.handles ?? ['w1']),
    getWindowHandle: vi.fn(async () => 'w1'),
    close: vi.fn(async () => {}),
    get: vi.fn(async () => {}),
    actions: vi.fn(() => actionsMock),
    _actions: actionsMock,
    _el: el,
  };
}

// ===========================================================================
// 1. Tool _wait paths
// ===========================================================================

describe('Tool _wait paths', () => {
  describe('click.ts _wait', () => {
    it('calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_click(
        driver,
        { target: 'e1', _wait: { state: 'visible', timeout: 3000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._el.click).toHaveBeenCalled();
      expect(out.code.join('\n')).toContain('elementIsVisible');
      expect(out.result).toBe('clicked');
    });
  });

  describe('fill.ts _wait', () => {
    it('calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_fill(
        driver,
        { target: 'e1', value: 'hello', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._el.sendKeys).toHaveBeenCalledWith('hello');
      expect(out.code.join('\n')).toContain('elementIsVisible');
      expect(out.result).toBe('filled');
    });

    it('falls back to CTRL+a+NULL+DELETE when clear() throws', async () => {
      const driver = makeMockDriver();
      // Make clear() throw to trigger the fallback path
      driver._el.clear = vi.fn(async () => { throw new Error('invalid element state'); });

      const resp = new Response({ raw: false, json: true });
      await browser_fill(driver, { target: 'e1', value: 'text' }, resp);

      expect(driver._el.clear).toHaveBeenCalled();
      // First sendKeys call should be the CTRL+a+NULL fallback
      expect(driver._el.sendKeys).toHaveBeenCalledWith(Key.CONTROL, 'a', Key.NULL);
      // Second sendKeys call should be DELETE
      expect(driver._el.sendKeys).toHaveBeenCalledWith(Key.DELETE);
      // Third sendKeys call should be the actual value
      expect(driver._el.sendKeys).toHaveBeenCalledWith('text');
    });
  });

  describe('check.ts _wait', () => {
    it('browser_check calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver({ selected: false });
      const resp = new Response({ raw: false, json: true });
      await browser_check(
        driver,
        { target: 'e1', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._el.click).toHaveBeenCalled(); // not selected → click
      expect(out.result).toBe('checked');
    });

    it('browser_uncheck calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver({ selected: true });
      const resp = new Response({ raw: false, json: true });
      await browser_uncheck(
        driver,
        { target: 'e1', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._el.click).toHaveBeenCalled(); // selected → click to uncheck
      expect(out.result).toBe('unchecked');
    });
  });

  describe('goto.ts driver.wait', () => {
    it('calls driver.wait for page readyState', async () => {
      const driver = makeMockDriver();
      // Override wait to actually call the callback
      driver.wait = vi.fn(async (fn: any) => { return await fn(); });
      driver.executeScript = vi.fn(async () => true);

      const resp = new Response({ raw: false, json: true });
      await browser_goto(driver, { url: 'https://example.com' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.get).toHaveBeenCalledWith('https://example.com');
      expect(driver.wait).toHaveBeenCalled();
      expect(driver.executeScript).toHaveBeenCalled();
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.result).toBe('navigated to https://example.com');
    });

    it('does not fail when driver.wait times out', async () => {
      const driver = makeMockDriver();
      // Simulate wait timeout (throws)
      driver.wait = vi.fn(async () => { throw new Error('Page did not reach ready state'); });

      const resp = new Response({ raw: false, json: true });
      await browser_goto(driver, { url: 'https://example.com' }, resp);
      const out = JSON.parse(resp.serialize());

      // Should still succeed — goto catches the wait timeout
      expect(out.result).toBe('navigated to https://example.com');
    });
  });

  describe('interactions.ts _wait', () => {
    it('browser_hover calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_hover(
        driver,
        { target: 'e1', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._actions.move).toHaveBeenCalledWith({ origin: driver._el });
      expect(driver._actions.perform).toHaveBeenCalled();
      expect(out.result).toBe('hovered');
    });

    it('browser_dblclick calls waitForElementState when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_dblclick(
        driver,
        { target: 'e1', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._actions.doubleClick).toHaveBeenCalledWith(driver._el);
      expect(driver._actions.perform).toHaveBeenCalled();
      expect(out.result).toBe('double-clicked');
    });

    it('browser_drag calls waitForElementState for both elements when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_drag(
        driver,
        { start: 'e1', end: 'e2', _wait: { state: 'visible', timeout: 2000 } as WaitConfig },
        resp,
      );
      const out = JSON.parse(resp.serialize());

      // waitForElementState is called twice (for start and end elements)
      expect(driver.wait).toHaveBeenCalledTimes(2);
      expect(driver._actions.dragAndDrop).toHaveBeenCalledWith(driver._el, driver._el);
      expect(driver._actions.perform).toHaveBeenCalled();
      expect(out.result).toBe('dragged');
    });
  });
});

// ===========================================================================
// 2. shared.ts findElementWithWait
// ===========================================================================

describe('shared.ts findElementWithWait', () => {
  const waitConfig: WaitConfig = { state: 'visible', timeout: 5000, retry: 0, retryInterval: 100 };

  it('calls findElement directly when wait is undefined', async () => {
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn(async () => mockEl),
      executeScript: vi.fn(),
    };
    const el = await findElementWithWait(driver, 'e1', undefined);
    expect(el).toBe(mockEl);
    expect(driver.findElement).toHaveBeenCalledTimes(1);
  });

  it('calls findElement directly when wait state is none', async () => {
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn(async () => mockEl),
      executeScript: vi.fn(),
    };
    const el = await findElementWithWait(driver, 'e1', { state: 'none', timeout: 5000, retry: 0, retryInterval: 100 });
    expect(el).toBe(mockEl);
    expect(driver.findElement).toHaveBeenCalledTimes(1);
  });

  it('calls findElement directly when wait timeout <= 0', async () => {
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn(async () => mockEl),
      executeScript: vi.fn(),
    };
    const el = await findElementWithWait(driver, 'e1', { state: 'visible', timeout: 0, retry: 0, retryInterval: 100 });
    expect(el).toBe(mockEl);
    expect(driver.findElement).toHaveBeenCalledTimes(1);
  });

  it('calls findElement directly for cross-frame refs', async () => {
    const mockIframe = { tagName: 'IFRAME' };
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn(async () => mockEl),
      executeScript: vi.fn(async () => mockIframe),
      switchTo: vi.fn(() => ({
        frame: vi.fn(async () => {}),
      })),
    };
    const el = await findElementWithWait(driver, 'f3e15', waitConfig);
    expect(el).toBe(mockEl);
    expect(driver.executeScript).toHaveBeenCalled(); // iframe lookup
    expect(driver.switchTo).toHaveBeenCalled();
  });

  it('returns element on fast path when found immediately', async () => {
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn(async () => mockEl),
      executeScript: vi.fn(),
    };
    const el = await findElementWithWait(driver, 'e1', waitConfig);
    expect(el).toBe(mockEl);
    expect(driver.findElement).toHaveBeenCalledTimes(1); // only fast path
  });

  it('finds element on retry when not found initially', async () => {
    const mockEl = { click: vi.fn() };
    const driver = {
      findElement: vi.fn()
        .mockRejectedValueOnce(new Error('not found'))   // fast path (via findElement)
        .mockRejectedValueOnce(new Error('not found'))   // slow path first poll
        .mockResolvedValueOnce(mockEl),                    // slow path second poll
      executeScript: vi.fn(async () => null), // shadow root search returns null
    };
    const el = await findElementWithWait(driver, 'e1', { state: 'visible', timeout: 1000, retry: 0, retryInterval: 100 });
    expect(el).toBe(mockEl);
    expect(driver.findElement).toHaveBeenCalledTimes(3); // 1 fast + 2 slow
  });

  it('throws when element is never found', async () => {
    const driver = {
      findElement: vi.fn().mockRejectedValue(new Error('not found')),
      executeScript: vi.fn(async () => null),
    };
    await expect(
      findElementWithWait(driver, 'e1', { state: 'visible', timeout: 100, retry: 0, retryInterval: 100 }),
    ).rejects.toMatchObject({
      // Must be a selenium TimeoutError, NOT a generic Error: the server
      // classifies generic Errors as DRIVER_ERROR and destroys the session.
      name: 'TimeoutError',
      message: 'Element not found after 100ms: e1',
    });
  });
});

// ===========================================================================
// 3. state.ts error paths
// ===========================================================================

describe('state.ts', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-state-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('browser_state_save', () => {
    it('writes a JSON file with cookies, localStorage, and sessionStorage', async () => {
      const addCookie = vi.fn(async () => {});
      const driver = {
        manage: vi.fn(() => ({
          getCookies: vi.fn(async () => [{ name: 'session', value: 'abc' }]),
        })),
        executeScript: vi.fn(async (script: string) => {
          if (script.includes('localStorage')) return { theme: 'dark' };
          if (script.includes('sessionStorage')) return { cart: 'items' };
          return null;
        }),
        getCurrentUrl: vi.fn(async () => 'https://example.com'),
      };

      const resp = new Response({ raw: false, json: true });
      await browser_state_save(driver, { filename: 'test-state.json' }, resp);

      const filePath = path.join(tmpDir, '.se-cli', 'test-state.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(state.url).toBe('https://example.com');
      expect(state.cookies).toEqual([{ name: 'session', value: 'abc' }]);
      expect(state.localStorage).toEqual({ theme: 'dark' });
      expect(state.sessionStorage).toEqual({ cart: 'items' });
      expect(state.savedAt).toBeTruthy();
    });
  });

  describe('browser_state_load error paths', () => {
    it('errors when no filename and .se-cli directory does not exist', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, {}, resp);

      expect(resp.serialize()).toContain('No state file specified');
    });

    it('errors when no filename and no state-*.json files found', async () => {
      fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, {}, resp);

      expect(resp.serialize()).toContain('No state file specified');
    });

    it('errors when specified file not found', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, { filename: 'nonexistent.json' }, resp);

      expect(resp.serialize()).toContain('State file not found');
    });

    it('errors when JSON parse fails', async () => {
      fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.se-cli', 'bad.json'), '{invalid json');
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, { filename: 'bad.json' }, resp);

      expect(resp.serialize()).toContain('Failed to parse state file');
    });
  });

  describe('browser_state_load success with SameSite cookie', () => {
    it('sanitizes SameSite=None cookies without secure flag', async () => {
      fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
      const state = {
        url: 'https://example.com',
        cookies: [
          { name: 'csrf', value: 'token', sameSite: 'None', secure: false },
          { name: 'normal', value: 'val', sameSite: 'Lax', secure: false },
        ],
        localStorage: { theme: 'dark' },
        sessionStorage: { key: 'value' },
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(tmpDir, '.se-cli', 'test-state.json'),
        JSON.stringify(state),
      );

      const addCookie = vi.fn(async () => {});
      const driver = {
        get: vi.fn(async () => {}),
        manage: vi.fn(() => ({
          deleteAllCookies: vi.fn(async () => {}),
          addCookie,
        })),
        executeScript: vi.fn(async () => {}),
      };

      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, { filename: 'test-state.json' }, resp);

      // SameSite=None cookie should have secure=true
      expect(addCookie).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'csrf', sameSite: 'None', secure: true }),
      );
      // Normal cookie should not be modified
      expect(addCookie).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'normal', sameSite: 'Lax', secure: false }),
      );
    });
  });

  describe('browser_state_load missing fields', () => {
    it('tolerates state files with missing cookies/storage/url fields', async () => {
      fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.se-cli', 'minimal.json'), JSON.stringify({}));
      const driver = {
        get: vi.fn(async () => {}),
        manage: vi.fn(() => ({
          deleteAllCookies: vi.fn(async () => {}),
          addCookie: vi.fn(async () => {}),
        })),
        executeScript: vi.fn(async () => {}),
      };
      const resp = new Response({ raw: false, json: true });
      await browser_state_load(driver, { filename: 'minimal.json' }, resp);
      const out = JSON.parse(resp.serialize());
      expect(out.result).toContain('loaded state from minimal.json');
      expect(driver.get).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 4. find.ts search paths
// ===========================================================================

describe('find.ts search paths', () => {
  const yamlContent = '- button:\n  - Submit [ref=e1]\n  - Cancel [ref=e2]\n- link:\n  - Home [ref=e3]';

  function makeFindDriver(scriptResults: any[]): any {
    let callIndex = 0;
    return {
      executeScript: vi.fn(async () => {
        const result = scriptResults[callIndex] ?? '';
        callIndex++;
        if (result instanceof Error) throw result;
        return result;
      }),
      wait: vi.fn(async (fn: any) => { return await fn(); }),
    };
  }

  it('finds matching text lines with context', async () => {
    const driver = makeFindDriver([true, yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { text: 'Submit' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('Submit');
    expect(out.result).toContain('---');
  });

  it('returns "No matches found." when text does not match', async () => {
    const driver = makeFindDriver([true, yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { text: 'NonExistent' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('No matches found.');
  });

  it('parses regex with /pattern/flags format', async () => {
    const driver = makeFindDriver([true, yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { regex: '/cancel/i' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('Cancel');
  });

  it('uses plain regex pattern without slashes', async () => {
    const driver = makeFindDriver([true, yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { regex: 'button' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('button');
  });

  it('returns "No matches found." when snapshot is empty', async () => {
    const driver = makeFindDriver([true, '', '', '']);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { text: 'anything' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('No matches found.');
  });

  it('adds error when getSnapshotYaml throws', async () => {
    const scriptError = new Error('script execution failed');
    const driver = makeFindDriver([true, scriptError, scriptError, scriptError]);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { text: 'anything' }, resp);

    expect(resp.serialize()).toContain('Failed to generate snapshot for find');
  });

  it('matches every line with a /g-flag regex (no lastIndex skipping)', async () => {
    const driver = makeFindDriver([true, '- item A\n- item B\n- item C']);
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { regex: '/item/g' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('item A');
    expect(out.result).toContain('item B');
    expect(out.result).toContain('item C');
  });
});

// ===========================================================================
// 5. snapshot.ts retry/empty paths
// ===========================================================================

describe('snapshot.ts', () => {
  const yamlContent = '- button:\n  - Submit [ref=e1]';

  function makeSnapshotDriver(scriptResults: any[]): any {
    let callIndex = 0;
    return {
      executeScript: vi.fn(async () => {
        const result = scriptResults[callIndex] ?? '';
        callIndex++;
        if (result instanceof Error) throw result;
        return result;
      }),
      wait: vi.fn(async (fn: any) => { return await fn(); }),
    };
  }

  it('calls driver.wait when no target is provided', async () => {
    const driver = makeSnapshotDriver([true, yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, {}, resp);

    expect(driver.wait).toHaveBeenCalled();
  });

  it('does NOT call driver.wait when target is provided', async () => {
    const driver = makeSnapshotDriver([yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, { target: 'e1' }, resp);

    expect(driver.wait).not.toHaveBeenCalled();
  });

  it('retries when first attempt returns empty, succeeds on second', async () => {
    const driver = makeSnapshotDriver([true, '', yamlContent]);
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe(yamlContent);
  });

  it('adds error when all 3 attempts throw', async () => {
    const scriptError = new Error('script error');
    const driver = makeSnapshotDriver([true, scriptError, scriptError, scriptError]);
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, {}, resp);

    expect(resp.serialize()).toContain('Failed to generate snapshot');
  });

  it('adds error when result is always empty', async () => {
    const driver = makeSnapshotDriver([true, '', '', '']);
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, {}, resp);

    expect(resp.serialize()).toContain('Snapshot returned empty result');
  });

  it('writes to file when filename is provided', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-snap-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    try {
      const driver = makeSnapshotDriver([true, yamlContent]);
      const resp = new Response({ raw: false, json: true });
      await browser_snapshot(driver, { filename: 'snap.yaml' }, resp);
      const out = JSON.parse(resp.serialize());

      const filePath = path.join(tmpDir, '.se-cli', 'snap.yaml');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(yamlContent);
      expect(out.result).toContain('snap.yaml');
    } finally {
      cwdSpy.mockRestore();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});

// ===========================================================================
// 6. storage.ts sessionstorage paths
// ===========================================================================

describe('storage.ts sessionstorage', () => {
  it('sessionstorage_delete without key calls clear()', async () => {
    const driver = makeMockDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_sessionstorage_delete(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(driver.executeScript).toHaveBeenCalledWith('sessionStorage.clear();');
    expect(out.result).toBe('cleared all sessionStorage');
  });

  it('sessionstorage_delete with key calls removeItem()', async () => {
    const driver = makeMockDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_sessionstorage_delete(driver, { key: 'myKey' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(driver.executeScript).toHaveBeenCalledWith(
      'sessionStorage.removeItem(arguments[0]);',
      'myKey',
    );
    expect(out.result).toBe('deleted sessionStorage key: myKey');
  });

  it('sessionstorage_list returns JSON of all items', async () => {
    const items = { key1: 'val1', key2: 'val2' };
    const driver = makeMockDriver({ scriptResult: items });
    const resp = new Response({ raw: false, json: true });
    await browser_sessionstorage_list(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(JSON.parse(out.result)).toEqual(items);
  });
});

// ===========================================================================
// 7. tab.ts edge cases
// ===========================================================================

describe('tab.ts edge cases', () => {
  it('tab_close reports no remaining tabs when handles is empty', async () => {
    const driver = makeMockDriver({ handles: [] });
    const resp = new Response({ raw: false, json: true });
    await browser_tab_close(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(driver.close).toHaveBeenCalled();
    expect(out.result).toBe('closed tab; no remaining tabs');
  });

  it('tab_select with negative index adds error', async () => {
    const driver = makeMockDriver({ handles: ['w1', 'w2'] });
    const resp = new Response({ raw: false, json: true });
    await browser_tab_select(driver, { index: -1 }, resp);

    expect(resp.serialize()).toContain('out of range');
  });

  it('tab_select with index too high adds error', async () => {
    const driver = makeMockDriver({ handles: ['w1', 'w2'] });
    const resp = new Response({ raw: false, json: true });
    await browser_tab_select(driver, { index: 5 }, resp);

    expect(resp.serialize()).toContain('out of range');
  });

  it('tab_select with NaN index adds error instead of switching', async () => {
    const driver = makeMockDriver({ handles: ['w1', 'w2'] });
    const resp = new Response({ raw: false, json: true });
    await browser_tab_select(driver, { index: NaN }, resp);

    expect(resp.serialize()).toContain('out of range');
    expect(driver.switchTo().window).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 8. minimist.ts edge cases
// ===========================================================================

describe('minimist.ts edge cases', () => {
  it('treats everything after -- as positional args', () => {
    const result = parseArgs(['click', '--', '--flag', 'value'], {
      boolean: [],
      string: [],
      alias: {},
    });
    expect(result._).toEqual(['click', '--flag', 'value']);
  });

  it('treats unknown flag as boolean true', () => {
    const result = parseArgs(['--unknown', 'cmd'], {
      boolean: [],
      string: [],
      alias: {},
    });
    expect(result.unknown).toBe(true);
    expect(result._).toEqual(['cmd']);
  });
});

// ===========================================================================
// 9. config.ts platform branches
// ===========================================================================

describe('config.ts platform branches', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    // Restore env vars
    for (const key of ['LOCALAPPDATA', 'TMPDIR', 'USERNAME', 'USER']) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('makeSocketPath', () => {
    it('returns named pipe format on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      const result = makeSocketPath('wshash', 'session1');
      expect(result).toContain('\\\\.\\pipe\\');
      expect(result).toContain('se-cli-');
      expect(result).toContain('wshash');
      expect(result).toContain('session1');
    });

    it('returns /tmp path on POSIX', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      delete process.env.TMPDIR;
      const result = makeSocketPath('wshash', 'session1');
      // On Windows, path.join uses backslashes even when platform is mocked;
      // check for path component regardless of separator direction.
      expect(result).toMatch(/[\\/]tmp[\\/]/);
      expect(result).toContain('se-cli-');
      expect(result).toContain('wshash');
      expect(result).toContain('session1');
      expect(result).toContain('.sock');
    });

    it('uses TMPDIR when set on POSIX', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.TMPDIR = '/custom/tmp';
      const result = makeSocketPath('wshash', 'session1');
      expect(result).toMatch(/[\\/]custom[\\/]tmp[\\/]/);
      delete process.env.TMPDIR;
    });
  });

  describe('baseDaemonDir', () => {
    it('uses LOCALAPPDATA on Windows when set', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
      const result = baseDaemonDir();
      expect(result).toContain('C:\\Users\\test\\AppData\\Local');
      expect(result).toContain('ms-se-cli');
      expect(result).toContain('daemon');
    });

    it('uses Library/Caches on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      delete process.env.LOCALAPPDATA;
      const result = baseDaemonDir();
      expect(result).toContain('Library');
      expect(result).toContain('Caches');
      expect(result).toContain('ms-se-cli');
    });

    it('uses .cache on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      delete process.env.LOCALAPPDATA;
      const result = baseDaemonDir();
      expect(result).toContain('.cache');
      expect(result).toContain('ms-se-cli');
    });
  });

  describe('userHash', () => {
    it('uses USERNAME env var when set', () => {
      process.env.USERNAME = 'testuser1';
      delete process.env.USER;
      const hash = userHash();
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
      // Verify deterministic: same input → same hash
      process.env.USERNAME = 'testuser1';
      expect(userHash()).toBe(hash);
    });

    it('uses USER env var when USERNAME is not set', () => {
      delete process.env.USERNAME;
      process.env.USER = 'testuser2';
      const hash = userHash();
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
      // Should differ from 'default' hash
      delete process.env.USER;
      delete process.env.USERNAME;
      const defaultHash = userHash();
      expect(hash).not.toBe(defaultHash);
    });

    it('uses "default" when neither USERNAME nor USER is set', () => {
      delete process.env.USERNAME;
      delete process.env.USER;
      const hash = userHash();
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
      // Should be deterministic
      expect(userHash()).toBe(hash);
    });
  });
});

// ===========================================================================
// 10. wait-config.ts remaining paths
// ===========================================================================

describe('wait-config.ts remaining paths', () => {
  describe('waitForElementState attached condition', () => {
    it('executes condition: getTagName succeeds → returns true', async () => {
      const el = { getTagName: vi.fn(async () => 'div') };
      const driver = {
        wait: vi.fn(async (fn: any) => fn()),
      };
      const result = await waitForElementState(driver, el, 'attached', 5000);

      expect(el.getTagName).toHaveBeenCalled();
      expect(driver.wait).toHaveBeenCalled();
      expect(result).toContain('attached');
    });

    it('executes condition: StaleElementReferenceError → returns false', async () => {
      const el = {
        getTagName: vi.fn(async () => {
          const err = new Error('stale element');
          err.name = 'StaleElementReferenceError';
          throw err;
        }),
      };
      const driver = {
        wait: vi.fn(async (fn: any) => fn()),
      };
      const result = await waitForElementState(driver, el, 'attached', 5000);

      expect(el.getTagName).toHaveBeenCalled();
      expect(result).toContain('attached');
    });

    it('executes condition: other error → throws', async () => {
      const el = {
        getTagName: vi.fn(async () => {
          throw new Error('unexpected error');
        }),
      };
      const driver = {
        wait: vi.fn(async (fn: any) => fn()),
      };

      await expect(
        waitForElementState(driver, el, 'attached', 5000),
      ).rejects.toThrow('unexpected error');
    });
  });

  describe('waitForElementState default case', () => {
    it('returns null for unknown state', async () => {
      const el = {};
      const driver = {
        wait: vi.fn(async () => {}),
      };
      const result = await waitForElementState(driver, el, 'unknown' as any, 5000);

      expect(result).toBeNull();
      expect(driver.wait).not.toHaveBeenCalled();
    });
  });

  describe('waitForElementState compound states', () => {
    it('handles visible+enabled compound state', async () => {
      const el = {};
      const driver = {
        wait: vi.fn(async () => {}),
      };
      const result = await waitForElementState(driver, el, 'visible+enabled' as any, 5000);

      expect(driver.wait).toHaveBeenCalledTimes(2); // once per sub-state
      expect(result).toContain('elementIsVisible');
      expect(result).toContain('elementIsEnabled');
    });
  });
});

// ===========================================================================
// 11. config.ts remaining functions
// ===========================================================================

describe('config.ts remaining functions', () => {
  it('sessionFileDir returns path with wsHash and daemon dir', () => {
    const result = sessionFileDir('abc123');
    expect(result).toContain('abc123');
    expect(result).toContain('daemon');
  });

  it('sessionFilePath returns path with session file name', () => {
    const result = sessionFilePath('abc123', 'default');
    expect(result).toContain('abc123');
    expect(result).toContain('default.session');
  });

  it('outputDir returns .se-cli under cwd', () => {
    const result = outputDir('/tmp/test-project');
    expect(result).toContain('.se-cli');
    expect(result).toContain('test-project');
  });
});

// ===========================================================================
// 12. registry.ts error paths
// ===========================================================================

describe('registry.ts error paths', () => {
  let tmpDir: string;
  let registry: Registry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-reg-'));
    registry = new Registry(tmpDir);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('listSessions skips invalid session files (catch block)', () => {
    const dir = path.join(tmpDir, 'wsHash');
    fs.mkdirSync(dir, { recursive: true });
    const validConfig: SessionConfig = {
      name: 'default', version: '1.0', timestamp: Date.now(),
      socketPath: '/tmp/test.sock', workspaceDir: '/tmp', persistent: false, browserName: 'chrome',
    };
    fs.writeFileSync(path.join(dir, 'default.session'), JSON.stringify(validConfig));
    fs.writeFileSync(path.join(dir, 'broken.session'), '{invalid json');

    const sessions = registry.listSessions('wsHash');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe('default');
  });

  it('deleteSession does not throw when file does not exist (catch block)', () => {
    expect(() => registry.deleteSession('nonexistent', 'session')).not.toThrow();
  });

  it('writeSession and loadSession round-trip', () => {
    const config: SessionConfig = {
      name: 'test', version: '1.0', timestamp: Date.now(),
      socketPath: '/tmp/test.sock', workspaceDir: '/tmp', persistent: false, browserName: 'chrome',
    };
    registry.writeSession('wsHash', config);
    const loaded = registry.loadSession('wsHash', 'test');
    expect(loaded).toEqual(config);
  });

  it('loadSession returns null when file does not exist', () => {
    expect(registry.loadSession('nonexistent', 'session')).toBeNull();
  });

  it('listSessions returns empty array when directory does not exist', () => {
    expect(registry.listSessions('nonexistent')).toEqual([]);
  });

  it('listAllSessions aggregates sessions across all workspace hashes', () => {
    const makeConfig = (name: string, wsDir: string): SessionConfig => ({
      name, version: '1.0', timestamp: Date.now(),
      socketPath: '/tmp/test.sock', workspaceDir: wsDir, persistent: false, browserName: 'chrome',
    });
    fs.mkdirSync(path.join(tmpDir, 'ws1'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'ws2'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'ws1', 'default.session'), JSON.stringify(makeConfig('default', '/proj/a')));
    fs.writeFileSync(path.join(tmpDir, 'ws1', 'scrape.session'), JSON.stringify(makeConfig('scrape', '/proj/a')));
    fs.writeFileSync(path.join(tmpDir, 'ws2', 'default.session'), JSON.stringify(makeConfig('default', '/proj/b')));
    // A stray file that is not a *.session and a non-directory entry are ignored
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'not a session');
    fs.writeFileSync(path.join(tmpDir, 'ws1', 'junk.json'), '{}');

    const entries = registry.listAllSessions();
    expect(entries).toHaveLength(3);
    expect(entries.map(e => `${e.wsHash}:${e.config.workspaceDir}`).sort()).toEqual([
      'ws1:/proj/a',
      'ws1:/proj/a',
      'ws2:/proj/b',
    ]);
  });

  it('listAllSessions returns empty array when base dir does not exist', () => {
    const empty = new Registry(path.join(tmpDir, 'missing'));
    expect(empty.listAllSessions()).toEqual([]);
  });
});

// ===========================================================================
// 13. output.ts render paths
// ===========================================================================

describe('output.ts render', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('throws CliError with DAEMON_DEAD hint', () => {
    try {
      render({ ok: false, error: 'daemon is dead', code: 'DAEMON_DEAD' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.message).toContain('daemon is dead');
      expect(e.message).toContain('se-cli open');
      expect(e.code).toBe('DAEMON_DEAD');
    }
  });

  it('throws CliError with ELEMENT_NOT_FOUND hint', () => {
    try {
      render({ ok: false, error: 'element not found', code: 'ELEMENT_NOT_FOUND' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.message).toContain('element not found');
      expect(e.message).toContain('se-cli snapshot');
    }
  });

  it('throws CliError for other errors without hint', () => {
    try {
      render({ ok: false, error: 'some error', code: 'DRIVER_ERROR' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.message).toContain('some error');
      expect(e.message).not.toContain('Hint');
    }
  });

  it('writes text to stdout for ok messages', () => {
    render({ ok: true, text: 'hello world' });
    expect(stdoutSpy).toHaveBeenCalledWith('hello world\n');
  });

  it('writes raw to stdout for ok raw messages', () => {
    render({ ok: true, raw: 'raw output' });
    expect(stdoutSpy).toHaveBeenCalledWith('raw output');
  });

  it('writes JSON to stdout for ok json messages', () => {
    render({ ok: true, json: { key: 'value' } });
    const written = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
    expect(written).toContain('"key"');
    expect(written).toContain('"value"');
  });
});

// ===========================================================================
// 14. press.ts key mapping
// ===========================================================================

describe('press.ts key mapping', () => {
  it('maps known keys to selenium Key constants', async () => {
    const sendKeys = vi.fn(async () => {});
    const driver = {
      switchTo: vi.fn(() => ({
        activeElement: vi.fn(() => ({ sendKeys })),
      })),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_press(driver, { key: 'Enter' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(sendKeys).toHaveBeenCalledWith(Key.ENTER);
    expect(out.code.join('\n')).toContain('Key.ENTER');
    expect(out.result).toBe('pressed Enter');
  });

  it('rejects unknown keys instead of typing them as literal text', async () => {
    const sendKeys = vi.fn(async () => {});
    const driver = {
      switchTo: vi.fn(() => ({
        activeElement: vi.fn(() => ({ sendKeys })),
      })),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_press(driver, { key: 'Delete' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(sendKeys).not.toHaveBeenCalled();
    expect(out.error).toContain('Unsupported key: Delete');
  });
});

// ===========================================================================
// 15. storage.ts additional paths
// ===========================================================================

describe('storage.ts additional paths', () => {
  it('cookie_set with all optional params', async () => {
    const addCookie = vi.fn(async () => {});
    const driver = {
      manage: vi.fn(() => ({ addCookie })),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_cookie_set(driver, {
      name: 'test', value: 'val',
      domain: 'example.com', path: '/',
      httpOnly: true, secure: true,
    }, resp);
    const out = JSON.parse(resp.serialize());

    expect(addCookie).toHaveBeenCalledWith({
      name: 'test', value: 'val',
      domain: 'example.com', path: '/',
      httpOnly: true, secure: true,
    });
    expect(out.code.join('\n')).toContain('domain');
    expect(out.code.join('\n')).toContain('httpOnly');
    expect(out.code.join('\n')).toContain('secure');
  });

  it('cookie_delete without name deletes all', async () => {
    const deleteAllCookies = vi.fn(async () => {});
    const driver = {
      manage: vi.fn(() => ({ deleteAllCookies })),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_cookie_delete(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(deleteAllCookies).toHaveBeenCalled();
    expect(out.result).toBe('deleted all cookies');
  });

  it('localstorage_get returns null when key does not exist', async () => {
    const driver = {
      executeScript: vi.fn(async () => null),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_localstorage_get(driver, { key: 'missing' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('null');
  });

  it('localstorage_delete without key clears all', async () => {
    const driver = makeMockDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_localstorage_delete(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(driver.executeScript).toHaveBeenCalledWith('localStorage.clear();');
    expect(out.result).toBe('cleared all localStorage');
  });

  it('sessionstorage_get returns null when key does not exist', async () => {
    const driver = {
      executeScript: vi.fn(async () => null),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_sessionstorage_get(driver, { key: 'missing' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('null');
  });
});

// ===========================================================================
// 16. dialog.ts wait catch and dismiss
// ===========================================================================

describe('dialog.ts', () => {
  it('dialog_accept falls through to alert when wait times out', async () => {
    const alert = {
      sendKeys: vi.fn(async () => {}),
      accept: vi.fn(async () => {}),
    };
    const driver = {
      wait: vi.fn(async () => { throw new Error('timeout'); }),
      switchTo: vi.fn(() => ({
        alert: vi.fn(async () => alert),
      })),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_dialog_accept(driver, { text: 'hello' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(alert.sendKeys).toHaveBeenCalledWith('hello');
    expect(alert.accept).toHaveBeenCalled();
    expect(out.result).toBe('dialog accepted');
  });

  it('dialog_accept without text just accepts', async () => {
    const alert = {
      accept: vi.fn(async () => {}),
    };
    const driver = {
      wait: vi.fn(async () => {}),
      switchTo: vi.fn(() => ({
        alert: vi.fn(async () => alert),
      })),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_dialog_accept(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(alert.accept).toHaveBeenCalled();
    expect(out.result).toBe('dialog accepted');
  });

  it('dialog_dismiss dismisses the alert', async () => {
    const alert = {
      dismiss: vi.fn(async () => {}),
    };
    const driver = {
      wait: vi.fn(async () => {}),
      switchTo: vi.fn(() => ({
        alert: vi.fn(async () => alert),
      })),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_dialog_dismiss(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(alert.dismiss).toHaveBeenCalled();
    expect(out.result).toBe('dialog dismissed');
  });
});

// ===========================================================================
// 17. highlight.ts catch blocks + list/apply
// ===========================================================================

describe('highlight.ts', () => {
  beforeEach(() => {
    clearAllHighlights();
  });

  afterEach(() => {
    clearAllHighlights();
  });

  it('clearAllHighlights catches executeScript error', async () => {
    addHighlight('e1');
    const driver = {
      executeScript: vi.fn(async () => { throw new Error('page navigated'); }),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, { hide: true, all: true }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('All highlights cleared');
  });

  it('removeHighlight catches findElement error', async () => {
    addHighlight('e1');
    const driver = {
      executeScript: vi.fn(async () => { throw new Error('element gone'); }),
      findElement: vi.fn(async () => { throw new Error('not found'); }),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, { target: 'e1', hide: true }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('Removed highlight from e1');
  });

  it('lists active highlights', async () => {
    addHighlight('e1');
    addHighlight('e2');
    const driver = {};
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('e1');
    expect(out.result).toContain('e2');
  });

  it('shows no active highlights when empty', async () => {
    const driver = {};
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe('No active highlights');
  });

  it('applies highlight with default style', async () => {
    const el = {};
    const driver = {
      findElement: vi.fn(async () => el),
      executeScript: vi.fn(async () => {}),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, { target: 'e1' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('Highlighted e1');
    expect(out.result).toContain('3px solid red');
  });

  it('applies highlight with custom style', async () => {
    const el = {};
    const driver = {
      findElement: vi.fn(async () => el),
      executeScript: vi.fn(async () => {}),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_highlight(driver, { target: 'e1', style: '2px dashed blue' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('2px dashed blue');
  });
});

// ===========================================================================
// 18. minimist.ts alias resolution
// ===========================================================================

describe('minimist.ts alias resolution', () => {
  it('resolves alias for boolean options', () => {
    const result = parseArgs(['-v'], {
      boolean: ['verbose'],
      string: [],
      alias: { v: 'verbose' },
    });
    expect(result.verbose).toBe(true);
  });

  it('resolves alias for short flag with = value', () => {
    const result = parseArgs(['-t=value'], {
      boolean: [],
      string: ['title'],
      alias: { t: 'title' },
    });
    expect(result.title).toBe('value');
  });

  it('resolves alias for short flag with space value', () => {
    const result = parseArgs(['-t', 'mytitle'], {
      boolean: [],
      string: ['title'],
      alias: { t: 'title' },
    });
    expect(result.title).toBe('mytitle');
  });

  it('resolves alias for boolean short flag with = value', () => {
    const result = parseArgs(['-v=true'], {
      boolean: ['verbose'],
      string: [],
      alias: { v: 'verbose' },
    });
    expect(result.verbose).toBe(true);
  });

  it('treats --flag=false / --flag=0 as false for boolean options', () => {
    const opts = { boolean: ['headed'], string: [], alias: {} };
    expect(parseArgs(['--headed=false'], opts).headed).toBe(false);
    expect(parseArgs(['--headed=0'], opts).headed).toBe(false);
    expect(parseArgs(['--headed=true'], opts).headed).toBe(true);
  });

  it('keeps negative numbers as positional args (not flags)', () => {
    const opts = { boolean: [], string: [], alias: {} };
    const result = parseArgs(['mousewheel', '-100', '-50'], opts);
    expect(result._).toEqual(['mousewheel', '-100', '-50']);
    expect(result['100']).toBeUndefined();
  });
});

// ===========================================================================
// 19. wait-config.ts script timeout from file config
// ===========================================================================

describe('wait-config.ts file config', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-wc-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('reads scriptTimeout from per-command config in file', () => {
    const config = {
      version: 1,
      perCommand: {
        click: {
          scriptTimeout: 30000,
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, '.se-cli.json'), JSON.stringify(config));

    const result = resolveConfig({}, tmpDir, process.env as any, 'click');
    expect(result.timeouts.script).toBe(30000);
  });

  it('reads scriptTimeout from file-level config', () => {
    const config = {
      version: 1,
      timeouts: { script: 25000 },
    };
    fs.writeFileSync(path.join(tmpDir, '.se-cli.json'), JSON.stringify(config));

    const result = resolveConfig({}, tmpDir, process.env as any, 'click');
    expect(result.timeouts.script).toBe(25000);
  });

  it('ignores invalid numeric flag values (NaN) instead of poisoning config', () => {
    const result = resolveConfig(
      { timeout: 'abc', retry: 'xyz', 'retry-interval': 'q', 'implicit-wait': 'nope' },
      tmpDir,
      {},
      'click',
    );
    expect(result.wait.timeout).toBe(5000);
    expect(result.wait.retry).toBe(0);
    expect(result.wait.retryInterval).toBe(100);
    expect(result.timeouts.implicit).toBe(0);
  });
});

// ===========================================================================
// 20. backend.ts retry, defaultContent catch, config commands
// ===========================================================================

describe('backend.ts', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-be-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('retries on handler failure and eventually succeeds', async () => {
    const el = {
      click: vi.fn()
        .mockRejectedValueOnce(new Error('element not clickable'))
        .mockResolvedValueOnce(undefined),
      clear: vi.fn(async () => {}),
      sendKeys: vi.fn(async () => {}),
      isSelected: vi.fn(async () => false),
      getAttribute: vi.fn(async () => ''),
      getTagName: vi.fn(async () => 'div'),
      isDisplayed: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
    };
    const driver = {
      findElement: vi.fn(async () => el),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      wait: vi.fn(async () => {}),
      executeScript: vi.fn(async () => null),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => {}),
        frame: vi.fn(async () => {}),
      })),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => {}),
      })),
    };

    const resp = await callTool(
      driver, 'browser_click', { target: 'e1' },
      { raw: false, json: true },
      { retry: '1', 'retry-interval': '10' },
      tmpDir,
    );
    const out = JSON.parse(resp.serialize());

    expect(el.click).toHaveBeenCalledTimes(2);
    expect(out.result).toBe('clicked');
  });

  it('breaks retry loop on timeout for retry=-1', async () => {
    const el = {
      click: vi.fn(async () => { throw new Error('always fails'); }),
      clear: vi.fn(async () => {}),
      sendKeys: vi.fn(async () => {}),
      isSelected: vi.fn(async () => false),
      getAttribute: vi.fn(async () => ''),
      getTagName: vi.fn(async () => 'div'),
      isDisplayed: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
    };
    const driver = {
      findElement: vi.fn(async () => el),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      wait: vi.fn(async () => {}),
      executeScript: vi.fn(async () => null),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => {}),
        frame: vi.fn(async () => {}),
      })),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => {}),
      })),
    };

    const resp = await callTool(
      driver, 'browser_click', { target: 'e1' },
      { raw: false, json: true },
      { retry: '-1', timeout: '1', 'retry-interval': '10' },
      tmpDir,
    );

    expect(resp.serialize()).toContain('always fails');
  });

  it('catches defaultContent error in no-retry path', async () => {
    const el = {
      click: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      sendKeys: vi.fn(async () => {}),
      isSelected: vi.fn(async () => false),
      getAttribute: vi.fn(async () => ''),
      getTagName: vi.fn(async () => 'div'),
      isDisplayed: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
    };
    const driver = {
      findElement: vi.fn(async () => el),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      wait: vi.fn(async () => {}),
      executeScript: vi.fn(async () => null),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => { throw new Error('switch failed'); }),
        frame: vi.fn(async () => {}),
      })),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => {}),
      })),
    };

    const resp = await callTool(
      driver, 'browser_click', { target: 'e1' },
      { raw: false, json: true },
      {},
      tmpDir,
    );
    const out = JSON.parse(resp.serialize());

    expect(el.click).toHaveBeenCalled();
    expect(out.result).toBe('clicked');
  });

  it('returns error for unknown tool', async () => {
    const resp = await callTool(
      {}, 'browser_nonexistent', {},
      { raw: false, json: true },
      {},
      tmpDir,
    );
    expect(resp.serialize()).toContain('Unknown tool');
  });

  it('parseCommand throws on unknown config subcommand', () => {
    expect(() => parseCommand(['config', 'unknown'])).toThrow('Unknown config subcommand');
  });

  it('parseCommand parses goto command', () => {
    const { toolName, toolParams } = parseCommand(['goto', 'https://example.com']);
    expect(toolName).toBe('browser_goto');
    expect(toolParams.url).toBe('https://example.com');
  });
});

// ===========================================================================
// 21. session.ts canConnect and loadConfig
// ===========================================================================

describe('session.ts', () => {
  it('canConnect returns false when no daemon is running', async () => {
    const session = new Session('/nonexistent/workspace/path', 'test-session');
    const result = await session.canConnect();
    expect(result).toBe(false);
  });

  it('loadConfig returns null when no session file exists', () => {
    const session = new Session('/nonexistent/workspace/path', 'test-session');
    const config = session.loadConfig();
    expect(config).toBeNull();
  });
});

// ===========================================================================
// 22. expect.ts poll catch blocks
// ===========================================================================

describe('expect.ts poll catch blocks', () => {
  it('pollBoolean catches transient error and retries for visible assertion', async () => {
    const el = {
      isDisplayed: vi.fn()
        .mockRejectedValueOnce(new Error('stale element'))
        .mockResolvedValueOnce(true),
      getTagName: vi.fn(async () => 'div'),
    };
    const driver = {
      findElement: vi.fn(async () => el),
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      executeScript: vi.fn(async () => null),
      wait: vi.fn(async () => {}),
    };

    const resp = new Response({ raw: false, json: true });
    await browser_expect(
      driver,
      { target: 'e1', assertion: 'visible', _wait: { state: 'visible', timeout: 1000 } as WaitConfig },
      resp,
    );
    const out = JSON.parse(resp.serialize());

    expect(el.isDisplayed).toHaveBeenCalledTimes(2);
    expect(out.result).toContain('visible');
  });

  it('pollString catches error and retries for title assertion', async () => {
    const driver = {
      getTitle: vi.fn()
        .mockRejectedValueOnce(new Error('driver error'))
        .mockResolvedValueOnce('Expected Title'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      executeScript: vi.fn(async () => null),
    };

    const resp = new Response({ raw: false, json: true });
    await browser_expect(
      driver,
      { target: 'title', assertion: 'Expected Title', _wait: { state: 'visible', timeout: 1000 } as WaitConfig },
      resp,
    );
    const out = JSON.parse(resp.serialize());

    expect(driver.getTitle).toHaveBeenCalledTimes(2);
    expect(out.result).toContain('title');
  });

  it('pollString returns empty on timeout <= 0 with error', async () => {
    const driver = {
      getTitle: vi.fn(async () => { throw new Error('driver error'); }),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      executeScript: vi.fn(async () => null),
    };

    const resp = new Response({ raw: false, json: true });
    // pollString catches the error and returns '', then AssertionError is thrown
    // because '' doesn't match 'Missing'
    await expect(
      browser_expect(
        driver,
        { target: 'title', assertion: 'Missing', _wait: { state: 'visible', timeout: 0 } as WaitConfig },
        resp,
      ),
    ).rejects.toThrow('Expected title');
  });
});

// ===========================================================================
// 23. state.ts auto-find state files
// ===========================================================================

describe('state.ts auto-find', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-state-af-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('auto-finds state-*.json file when no filename specified', async () => {
    fs.mkdirSync(path.join(tmpDir, '.se-cli'), { recursive: true });
    const state = {
      url: 'https://example.com',
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpDir, '.se-cli', 'state-2026-01-01.json'), JSON.stringify(state));

    const driver = {
      get: vi.fn(async () => {}),
      manage: vi.fn(() => ({
        deleteAllCookies: vi.fn(async () => {}),
        addCookie: vi.fn(async () => {}),
      })),
      executeScript: vi.fn(async () => {}),
    };

    const resp = new Response({ raw: false, json: true });
    await browser_state_load(driver, {}, resp);

    expect(driver.get).toHaveBeenCalledWith('https://example.com');
  });
});

// ===========================================================================
// 24. find.ts non-string result handling
// ===========================================================================

describe('find.ts non-string result', () => {
  const yamlContent = '- button:\n  - Submit [ref=e1]';

  it('handles non-string executeScript result by retrying', async () => {
    let callIndex = 0;
    const results = [null, yamlContent]; // first: non-string, second: valid
    const driver = {
      executeScript: vi.fn(async () => {
        const r = results[callIndex] ?? '';
        callIndex++;
        return r;
      }),
      wait: vi.fn(async (fn: any) => { return await fn(); }),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_find(driver, { text: 'Submit' }, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toContain('Submit');
  });
});

// ===========================================================================
// 25. snapshot.ts non-string result handling
// ===========================================================================

describe('snapshot.ts non-string result', () => {
  const yamlContent = '- button:\n  - Submit [ref=e1]';

  it('handles non-string executeScript result by retrying', async () => {
    let callIndex = 0;
    const results = [true, null, yamlContent]; // body check: true, first: null, second: valid
    const driver = {
      executeScript: vi.fn(async () => {
        const r = results[callIndex] ?? '';
        callIndex++;
        return r;
      }),
      wait: vi.fn(async (fn: any) => { return await fn(); }),
    };
    const resp = new Response({ raw: false, json: true });
    await browser_snapshot(driver, {}, resp);
    const out = JSON.parse(resp.serialize());

    expect(out.result).toBe(yamlContent);
  });
});

// ===========================================================================
// 26. wait-config.ts retryInterval from file config (lines 255-258, 279-282)
// ===========================================================================

describe('wait-config.ts retryInterval from file', () => {
  it('applies perCommand retryInterval from file config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-wc-'));
    const configPath = path.join(tmpDir, '.se-cli.json');
    fs.writeFileSync(configPath, JSON.stringify({
      perCommand: {
        click: {
          wait: { retryInterval: 250, retry: 3 },
          scriptTimeout: 10000,
        },
      },
    }));
    const result = resolveConfig({}, tmpDir, {}, 'click');
    expect(result.wait.retryInterval).toBe(250);
    expect(result.sources.retryInterval).toBe('file');
    expect(result.wait.retry).toBe(3);
    expect(result.sources.retry).toBe('file');
    expect(result.timeouts.script).toBe(10000);
    expect(result.sources.script).toBe('file');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('applies file-level retryInterval when no perCommand override', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-wc-'));
    const configPath = path.join(tmpDir, '.se-cli.json');
    fs.writeFileSync(configPath, JSON.stringify({
      wait: { retryInterval: 300 },
    }));
    // 'snapshot' has no perCommand retryInterval override in defaults
    const result = resolveConfig({}, tmpDir, {}, 'snapshot');
    expect(result.wait.retryInterval).toBe(300);
    expect(result.sources.retryInterval).toBe('file');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('applies file-level timeout defaults (implicit, pageLoad, script)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-wc-'));
    const configPath = path.join(tmpDir, '.se-cli.json');
    fs.writeFileSync(configPath, JSON.stringify({
      wait: { timeout: 8000, state: 'visible', retry: 2 },
      timeouts: { implicit: 500, pageLoad: 60000, script: 45000 },
    }));
    // 'screenshot' has perCommand state='none' which blocks file-level state,
    // but timeout/retry should still come from file since perCommand doesn't set them
    const result = resolveConfig({}, tmpDir, {}, 'screenshot');
    expect(result.timeouts.implicit).toBe(500);
    expect(result.sources.implicit).toBe('file');
    expect(result.timeouts.pageLoad).toBe(60000);
    expect(result.sources.pageLoad).toBe('file');
    expect(result.timeouts.script).toBe(45000);
    expect(result.sources.script).toBe('file');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ===========================================================================
// 27. advanced-input.ts default button case (line 207)
// ===========================================================================

describe('advanced-input.ts default button', () => {
  it('uses default (LEFT) button for invalid button name in mousedown', async () => {
    const driver = makeMockDriver();
    const resp = new Response({ raw: false, json: true });
    await browser_mousedown(driver, { button: 'invalid' }, resp);
    const out = JSON.parse(resp.serialize());
    // Should not throw — falls back to Button.LEFT
    expect(out.result).toContain('mousedown: invalid');
    expect(driver._actions.press).toHaveBeenCalled();
  });
});

// ===========================================================================
// 28. backend.ts error catch blocks (lines 42, 75, 84)
// ===========================================================================

describe('backend.ts catch blocks', () => {
  it('continues when applyTimeouts fails (setTimeouts unsupported)', async () => {
    const driver = {
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => { throw new Error('not supported'); }),
      })),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => {}),
      })),
    };
    const resp = await callTool(driver, 'browser_title', {}, { raw: false, json: true });
    // Should still work despite applyTimeouts failure
    expect(resp.serialize()).toContain('Test');
  });

  it('continues when switchTo().defaultContent() throws in the retry path', async () => {
    const driver = {
      getTitle: vi.fn(async () => 'Test'),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => {}),
      })),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => { throw new Error('no frame'); }),
      })),
    };
    // Use retry=1 to enter the retry path
    const resp = await callTool(
      driver,
      'browser_title',
      {},
      { raw: false, json: true },
      { retry: '1' } as ParsedFlags,
    );
    // Should still succeed on first attempt despite switchTo throwing
    expect(resp.serialize()).toContain('Test');
  });

  it('handles switchTo().defaultContent() throwing after error in retry path (line 84)', async () => {
    let callCount = 0;
    const driver = {
      // First call throws, second succeeds
      getTitle: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('element not found');
        return 'Test';
      }),
      getCurrentUrl: vi.fn(async () => 'https://example.com'),
      manage: vi.fn(() => ({
        setTimeouts: vi.fn(async () => {}),
      })),
      switchTo: vi.fn(() => ({
        defaultContent: vi.fn(async () => { throw new Error('no frame'); }),
      })),
    };
    // Use retry=1 to enter the retry path; first attempt throws, second succeeds
    const resp = await callTool(
      driver,
      'browser_title',
      {},
      { raw: false, json: true },
      { retry: '1', 'retry-interval': '0' } as ParsedFlags,
    );
    // Should succeed on retry despite switchTo throwing on both attempts
    expect(resp.serialize()).toContain('Test');
  });
});

// ===========================================================================
// 21. program.ts filterCliFlags
// ===========================================================================

describe('program.ts filterCliFlags', () => {
  it('keeps tool command and positional args', () => {
    expect(filterCliFlags(['click', 'e1'])).toEqual(['click', 'e1']);
  });

  it('strips =value CLI flags', () => {
    expect(filterCliFlags(['click', 'e1', '--raw', '--session=dev'])).toEqual(['click', 'e1']);
    expect(filterCliFlags(['click', '--browser=chrome', 'e1'])).toEqual(['click', 'e1']);
  });

  it('consumes space-separated values of CLI flags (no leak)', () => {
    expect(filterCliFlags(['click', 'e1', '-s', 'dev'])).toEqual(['click', 'e1']);
    expect(filterCliFlags(['-s', 'dev', 'click', 'e1'])).toEqual(['click', 'e1']);
    expect(filterCliFlags(['click', '--browser', 'chrome', 'e1'])).toEqual(['click', 'e1']);
  });

  it('does not consume the next arg when it is another flag', () => {
    expect(filterCliFlags(['click', '-s', '--raw', 'e1'])).toEqual(['click', 'e1']);
  });

  it('keeps tool-specific flags', () => {
    expect(filterCliFlags(['fill', 'e1', 'hello', '--submit'])).toEqual(['fill', 'e1', 'hello', '--submit']);
  });

  it('keeps negative-number positionals after a stripped flag', () => {
    expect(filterCliFlags(['mousewheel', '-100', '-50', '-s', 'dev'])).toEqual(['mousewheel', '-100', '-50']);
  });

  it('strips v0.10 remote/grid/custom-browser flags', () => {
    expect(filterCliFlags(['open', '--endpoint=http://grid:4444'])).toEqual(['open']);
    expect(filterCliFlags(['open', '--endpoint', 'http://grid:4444'])).toEqual(['open']);
    expect(filterCliFlags(['open', '--browser-args=--disable-gpu --foo'])).toEqual(['open']);
    expect(filterCliFlags(['open', '--capabilities={"a":1}', '--raw'])).toEqual(['open']);
    expect(filterCliFlags(['open', '--browser-binary=C:\\chrome.exe'])).toEqual(['open']);
    expect(filterCliFlags(['open', '--driver-binary', '/opt/chromedriver'])).toEqual(['open']);
  });
});
