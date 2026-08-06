import { Response } from '../response';
import { parseArgs } from '../minimist';
import { tools } from './tools';
import {
  resolveConfig,
  applyTimeouts,
  waitForElementState,
  type ParsedFlags,
  type WaitConfig,
} from '../wait-config';

/**
 * Map a tool name to the CLI command name used as the per-command
 * configuration key. CLI command names are hyphenated (run-code,
 * generate-locator, dialog-accept, actions-chain), while tool names use
 * underscores — normalizing here keeps DEFAULTS.perCommand and
 * .se-cli.json perCommand entries (which use CLI names) effective.
 */
export function toolCommandName(toolName: string): string {
  return toolName.replace('browser_', '').replace(/_/g, '-');
}

export async function callTool(
  driver: any,
  toolName: string,
  params: any,
  responseOpts: { raw: boolean; json: boolean },
  flags: ParsedFlags = {},
  cwd: string = process.cwd(),
): Promise<Response> {
  // Handle config commands locally (no driver needed)
  if (toolName === 'config_get' || toolName === 'config_set' ||
      toolName === 'config_list' || toolName === 'config_init') {
    return handleConfigCommand(toolName, params, responseOpts, cwd);
  }

  const handler = tools[toolName];
  if (!handler) {
    const r = new Response(responseOpts);
    r.addError(`Unknown tool: ${toolName}`);
    return r;
  }

  // Resolve the effective wait/retry/timeout configuration
  const commandName = toolCommandName(toolName);
  const config = resolveConfig(flags, cwd, process.env as any, commandName);

  // Apply timeout settings to the driver
  try {
    await applyTimeouts(driver, config.timeouts);
  } catch {
    // Some drivers may not support all timeout methods — ignore failures
  }

  // Pass resolved wait config to interactive tools via params._wait
  if (config.wait.state !== 'none' && config.wait.timeout > 0) {
    params._wait = {
      state: config.wait.state,
      timeout: config.wait.timeout,
    } as WaitConfig;
  }

  const response = new Response(responseOpts);

  // Retry logic: retry count > 0 or -1 (until timeout)
  if (config.wait.retry !== 0) {
    const maxRetries = config.wait.retry === -1 ? Infinity : config.wait.retry;
    const startTime = Date.now();
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // For retry=-1, stop when timeout expires
      if (config.wait.retry === -1 && Date.now() - startTime > config.wait.timeout) {
        break;
      }

      // Use a fresh response for each attempt to avoid duplicate results
      const retryResponse = new Response(responseOpts);
      try {
        await handler(driver, params, retryResponse);
        // Success — return the response
        try {
          await driver.switchTo().defaultContent();
        } catch {
          // Ignore
        }
        return retryResponse;
      } catch (e: any) {
        lastError = e;
        // Reset to top-level frame before retry
        try {
          await driver.switchTo().defaultContent();
        } catch {
          // Ignore
        }
        // If more retries remain, wait before retrying
        if (attempt < maxRetries) {
          if (config.wait.retry === -1 &&
              Date.now() - startTime > config.wait.timeout) {
            break;
          }
          await new Promise(r => setTimeout(r, config.wait.retryInterval));
        }
      }
    }
    // All retries exhausted — report the last error
    response.addError(lastError?.message || 'All retries exhausted');
    return response;
  }

  // No retry — single attempt
  try {
    await handler(driver, params, response);
  } finally {
    // Always reset to the top-level frame after a tool call so the
    // next command starts in the main document context. This is
    // essential for cross-frame refs: after clicking an element
    // inside an iframe (which calls driver.switchTo().frame()),
    // subsequent snapshot/find/eval commands must run in the main frame.
    try {
      await driver.switchTo().defaultContent();
    } catch {
      // Ignore — some drivers throw if there's no frame to switch back from.
    }
  }
  return response;
}

/**
 * Handle config commands locally without a driver.
 */
function handleConfigCommand(
  toolName: string,
  params: any,
  responseOpts: { raw: boolean; json: boolean },
  cwd: string,
): Response {
  const response = new Response(responseOpts);
  const {
    getConfigValue,
    setConfigValue,
    listConfig,
    generateTemplateConfig,
    loadConfigFile,
    resolveConfig,
  } = require('../wait-config');

  switch (toolName) {
    case 'config_get': {
      const fileConfig = loadConfigFile(cwd);
      if (!fileConfig) {
        response.addResult('(no config file found)');
        return response;
      }
      const result = getConfigValue(fileConfig, params.key);
      if (result) {
        response.addResult(String(result.value));
        response.addCode(`config get ${params.key}`);
      } else {
        response.addResult(`(not set: ${params.key})`);
      }
      return response;
    }
    case 'config_set': {
      setConfigValue(cwd, params.key, params.value);
      response.addResult(`Set ${params.key} = ${params.value}`);
      response.addCode(`config set ${params.key} ${params.value}`);
      return response;
    }
    case 'config_list': {
      const resolved = resolveConfig({}, cwd, process.env as any);
      const lines = listConfig(resolved);
      response.addResult(lines.join('\n'));
      response.addCode('config list');
      return response;
    }
    case 'config_init': {
      const content = generateTemplateConfig(cwd);
      response.addResult('Generated .se-cli.json');
      response.addCode('config init');
      return response;
    }
    default:
      response.addError(`Unknown config command: ${toolName}`);
      return response;
  }
}

export function parseCommand(args: string[]): { toolName: string; toolParams: any; flags: ParsedFlags } {
  const [cmd, ...rest] = args;

  // Parse flags from rest using minimist
  // Include wait/retry flags in the known options
  const parsed = parseArgs(rest, {
    boolean: ['submit', 'no-wait', 'not', 'exact', 'hide', 'all', 'clear', 'offline', 'reset'],
    string: [
      'filename', 'depth', 'regex',
      // v0.4 wait/retry flags
      'timeout', 'wait', 'retry', 'retry-interval',
      'implicit-wait', 'page-load-timeout', 'script-timeout',
      // v0.7 network/debug flags
      'status', 'body', 'headers', 'style', 'since',
      'filter', 'method',
      // v0.8 emulation flags
      'throttle-network', 'throttle-cpu',
      // v0.9 locator flags
      'locator-style',
    ],
    alias: {},
  });
  const positional = parsed._;

  // Extract wait/retry flags for config resolution
  const flags: ParsedFlags = {};
  if (parsed.timeout !== undefined) flags.timeout = String(parsed.timeout);
  if (parsed.wait !== undefined) flags.wait = String(parsed.wait);
  if (parsed.retry !== undefined) flags.retry = String(parsed.retry);
  if (parsed['retry-interval'] !== undefined) flags['retry-interval'] = String(parsed['retry-interval']);
  if (parsed['implicit-wait'] !== undefined) flags['implicit-wait'] = String(parsed['implicit-wait']);
  if (parsed['page-load-timeout'] !== undefined) flags['page-load-timeout'] = String(parsed['page-load-timeout']);
  if (parsed['script-timeout'] !== undefined) flags['script-timeout'] = String(parsed['script-timeout']);
  if (parsed['no-wait'] !== undefined) flags['no-wait'] = true;

  // v0.9: role-based codegen style — only included when explicitly set so
  // default toolParams stay stable for tests and MCP mappings.
  const locatorStyle = parsed['locator-style'];
  const ls = (o: any) => (locatorStyle ? { ...o, locatorStyle } : o);

  const commands: Record<string, () => { toolName: string; toolParams: any }> = {
    'goto': () => ({ toolName: 'browser_goto', toolParams: { url: positional[0] } }),
    'go-back': () => ({ toolName: 'browser_go_back', toolParams: {} }),
    'go-forward': () => ({ toolName: 'browser_go_forward', toolParams: {} }),
    'reload': () => ({ toolName: 'browser_reload', toolParams: {} }),
    'title': () => ({ toolName: 'browser_title', toolParams: {} }),
    'url': () => ({ toolName: 'browser_url', toolParams: {} }),
    'click': () => ({ toolName: 'browser_click', toolParams: ls({ target: positional[0] }) }),
    'fill': () => ({ toolName: 'browser_fill', toolParams: ls({ target: positional[0], value: positional[1], submit: parsed.submit }) }),
    'type': () => ({ toolName: 'browser_type', toolParams: { value: positional[0] } }),
    'press': () => ({ toolName: 'browser_press', toolParams: { key: positional[0] } }),
    'select': () => ({ toolName: 'browser_select', toolParams: ls({ target: positional[0], value: positional[1] }) }),
    'check': () => ({ toolName: 'browser_check', toolParams: ls({ target: positional[0] }) }),
    'uncheck': () => ({ toolName: 'browser_uncheck', toolParams: ls({ target: positional[0] }) }),
    'snapshot': () => ({ toolName: 'browser_snapshot', toolParams: { target: positional[0], depth: parsed.depth ? parseInt(parsed.depth) : undefined, filename: parsed.filename } }),
    'find': () => ({ toolName: 'browser_find', toolParams: { text: positional[0], regex: parsed.regex } }),
    'screenshot': () => ({ toolName: 'browser_screenshot', toolParams: { target: positional[0], filename: parsed.filename } }),
    // v0.10: save the current page as a PDF (W3C print endpoint)
    'pdf': () => ({ toolName: 'browser_pdf', toolParams: { filename: parsed.filename } }),
    'eval': () => ({ toolName: 'browser_eval', toolParams: { script: positional[0], target: positional[1] } }),
    // v0.9: run-code — arbitrary Selenium snippets
    'run-code': () => ({ toolName: 'browser_run_code', toolParams: { code: positional[0] } }),
    // v0.9: generate-locator — best locator for a ref
    'generate-locator': () => ({
      toolName: 'browser_generate_locator',
      toolParams: {
        target: positional[0],
        all: parsed.all || false,
        style: parsed.style,
      },
    }),
    'cookie-list': () => ({ toolName: 'browser_cookie_list', toolParams: {} }),
    'cookie-get': () => ({ toolName: 'browser_cookie_get', toolParams: { name: positional[0] } }),
    'cookie-set': () => ({ toolName: 'browser_cookie_set', toolParams: { name: positional[0], value: positional[1] } }),
    'cookie-delete': () => ({ toolName: 'browser_cookie_delete', toolParams: { name: positional[0] } }),
    'localstorage-get': () => ({ toolName: 'browser_localstorage_get', toolParams: { key: positional[0] } }),
    'localstorage-set': () => ({ toolName: 'browser_localstorage_set', toolParams: { key: positional[0], value: positional[1] } }),
    'localstorage-delete': () => ({ toolName: 'browser_localstorage_delete', toolParams: { key: positional[0] } }),
    'localstorage-list': () => ({ toolName: 'browser_localstorage_list', toolParams: {} }),
    'sessionstorage-get': () => ({ toolName: 'browser_sessionstorage_get', toolParams: { key: positional[0] } }),
    'sessionstorage-set': () => ({ toolName: 'browser_sessionstorage_set', toolParams: { key: positional[0], value: positional[1] } }),
    'sessionstorage-delete': () => ({ toolName: 'browser_sessionstorage_delete', toolParams: { key: positional[0] } }),
    'sessionstorage-list': () => ({ toolName: 'browser_sessionstorage_list', toolParams: {} }),
    'tab-list': () => ({ toolName: 'browser_tab_list', toolParams: {} }),
    'tab-new': () => ({ toolName: 'browser_tab_new', toolParams: { url: positional[0] } }),
    'tab-close': () => ({ toolName: 'browser_tab_close', toolParams: {} }),
    'tab-select': () => ({ toolName: 'browser_tab_select', toolParams: { index: positional[0] ? parseInt(positional[0]) : 0 } }),
    'state-save': () => ({ toolName: 'browser_state_save', toolParams: { filename: parsed.filename } }),
    'state-load': () => ({ toolName: 'browser_state_load', toolParams: { filename: parsed.filename } }),
    // v0.4 config commands
    'config': () => {
      const subCmd = positional[0];
      if (subCmd === 'get') return { toolName: 'config_get', toolParams: { key: positional[1] } };
      if (subCmd === 'set') return { toolName: 'config_set', toolParams: { key: positional[1], value: positional[2] } };
      if (subCmd === 'list') return { toolName: 'config_list', toolParams: {} };
      if (subCmd === 'init') return { toolName: 'config_init', toolParams: {} };
      throw new Error(`Unknown config subcommand: ${subCmd}. Supported: get, set, list, init`);
    },
    // v0.5: Interaction Completion
    'hover': () => ({ toolName: 'browser_hover', toolParams: ls({ target: positional[0] }) }),
    'dblclick': () => ({ toolName: 'browser_dblclick', toolParams: ls({ target: positional[0] }) }),
    'drag': () => ({ toolName: 'browser_drag', toolParams: { start: positional[0], end: positional[1] } }),
    'dialog-accept': () => ({ toolName: 'browser_dialog_accept', toolParams: { text: positional[0] } }),
    'dialog-dismiss': () => ({ toolName: 'browser_dialog_dismiss', toolParams: {} }),
    'upload': () => ({ toolName: 'browser_upload', toolParams: { target: positional[0], file: positional[1] } }),
    'resize': () => ({ toolName: 'browser_resize', toolParams: { width: parseInt(positional[0]), height: parseInt(positional[1]) } }),
    'keydown': () => ({ toolName: 'browser_keydown', toolParams: { key: positional[0] } }),
    'keyup': () => ({ toolName: 'browser_keyup', toolParams: { key: positional[0] } }),
    'mousemove': () => ({ toolName: 'browser_mousemove', toolParams: { x: parseInt(positional[0]), y: parseInt(positional[1]) } }),
    'mousedown': () => ({ toolName: 'browser_mousedown', toolParams: { button: positional[0] } }),
    'mouseup': () => ({ toolName: 'browser_mouseup', toolParams: { button: positional[0] } }),
    'mousewheel': () => ({ toolName: 'browser_mousewheel', toolParams: { dx: parseInt(positional[0]), dy: parseInt(positional[1]) } }),
    'actions-chain': () => ({ toolName: 'browser_actions_chain', toolParams: { actions: positional[0] } }),
    // v0.6: Web-First Assertions
    'expect': () => ({
      toolName: 'browser_expect',
      toolParams: {
        target: positional[0],
        assertion: positional[1],
        expected: positional[2],
        attributeValue: positional[3],
        not: parsed.not || false,
        exact: parsed.exact || false,
      },
    }),
    // v0.7: Network & Debugging
    'highlight': () => ({
      toolName: 'browser_highlight',
      toolParams: {
        target: positional[0],
        style: parsed.style,
        hide: parsed.hide || false,
        all: parsed.all || false,
      },
    }),
    'console': () => ({
      toolName: 'browser_console',
      toolParams: {
        level: positional[0],
        since: parsed.since,
        clear: parsed.clear || false,
      },
    }),
    'requests': () => ({
      toolName: 'browser_requests',
      toolParams: {
        filter: parsed.filter,
        status: parsed.status,
        method: parsed.method,
        clear: parsed.clear || false,
      },
    }),
    'request': () => ({
      toolName: 'browser_request',
      toolParams: {
        index: positional[0] ? parseInt(positional[0]) : 0,
      },
    }),
    'route': () => ({
      toolName: 'browser_route',
      toolParams: {
        pattern: positional[0],
        status: parsed.status,
        body: parsed.body,
        headers: parsed.headers,
      },
    }),
    'route-list': () => ({
      toolName: 'browser_route_list',
      toolParams: {},
    }),
    'unroute': () => ({
      toolName: 'browser_unroute',
      toolParams: {
        index: positional[0] ? parseInt(positional[0]) : undefined,
        all: parsed.all || false,
      },
    }),
    // v0.8: Device & Environment Emulation
    'device': () => ({
      toolName: 'browser_device',
      toolParams: { name: positional[0] },
    }),
    'device-list': () => ({
      toolName: 'browser_device_list',
      toolParams: {},
    }),
    'emulate': () => ({
      toolName: 'browser_emulate',
      toolParams: {
        // Keep explicit false so `--offline=false` can clear an offline state.
        offline: parsed.offline !== undefined ? parsed.offline : undefined,
        throttleNetwork: parsed['throttle-network'],
        throttleCpu: parsed['throttle-cpu'],
        reset: parsed.reset || false,
      },
    }),
  };
  const factory = commands[cmd];
  if (!factory) throw new Error(`Unknown command: ${cmd}`);
  const result = factory();
  return { ...result, flags };
}
