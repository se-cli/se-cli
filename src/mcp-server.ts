/**
 * MCP (Model Context Protocol) Server for se-cli.
 *
 * Implements JSON-RPC 2.0 over stdio, exposing all se-cli browser automation
 * commands as MCP tools. This allows AI agents in VS Code (and other MCP-aware
 * clients) to discover and use se-cli's capabilities directly.
 *
 * Usage:
 *   se-cli mcp-server          # start MCP server in stdio mode
 *   npx @browsers-cli/se-cli mcp-server
 *
 * The server maintains a long-lived process that:
 * 1. Reads JSON-RPC requests from stdin (newline-delimited)
 * 2. Processes initialize / tools/list / tools/call methods
 * 3. Writes JSON-RPC responses to stdout (newline-delimited)
 *
 * Browser control is delegated to the existing daemon architecture (Session).
 */

import * as readline from 'readline';
import * as http from 'http';
import { Session } from './session';
import { baseDaemonDir, workspaceHash } from './config';
import { Registry } from './registry';
import { detectBrowser } from './detect-browser';
import { FileLogger } from './logger';
import * as path from 'path';
import * as fs from 'fs';
import type { ServerMessage } from './protocol';

// ─── JSON-RPC Types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ─── MCP Protocol Constants ──────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'se-cli';
const SERVER_VERSION = require('../package.json').version;

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ─── Tool Definitions ────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * All se-cli commands exposed as MCP tools.
 * Each tool maps to CLI args that are forwarded to the daemon via Session.run().
 */
export const toolDefinitions: ToolDef[] = [
  // ── Session & Browser Management ──
  {
    name: 'browser_open',
    description: 'Start a browser session. Launches Chrome (default), Edge, or Firefox in headless or headed mode. Optionally navigate to a URL immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to after opening (optional)' },
        browser: { type: 'string', enum: ['chrome', 'edge', 'firefox'], description: 'Browser to launch (default: chrome)' },
        headed: { type: 'boolean', description: 'Show browser window (default: headless)' },
        cdp: { type: 'string', description: 'Attach to a running Chrome via CDP endpoint URL' },
        profile: { type: 'string', description: 'Path to persistent browser profile directory' },
        persistent: { type: 'boolean', description: 'Keep browser profile across sessions (auto-assigns profile path)' },
        session: { type: 'string', description: 'Named session for parallel browser isolation (default: "default")' },
      },
    },
  },
  {
    name: 'browser_close',
    description: 'Close the current browser session and stop the daemon.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name to close (default: "default")' },
      },
    },
  },
  {
    name: 'browser_list_sessions',
    description: 'List all active browser sessions for the current workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_close_all',
    description: 'Close all active browser sessions for the current workspace.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Navigation ──
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL. Returns page title and URL after navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session: { type: 'string', description: 'Session name (default: "default")' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_go_back',
    description: 'Navigate back in browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_go_forward',
    description: 'Navigate forward in browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_get_title',
    description: 'Get the current page title.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_get_url',
    description: 'Get the current page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },

  // ── Interaction ──
  {
    name: 'browser_click',
    description: 'Click an element. Use a ref (e1, e2...) from snapshot or a CSS selector. Emits role-based Selenium code by default (--locator-style=role), or data-se-ref style with locatorStyle="ref".',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (e1) or CSS selector' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill an input field with text. Optionally submit the form. Emits role-based Selenium code by default (--locator-style=role), or data-se-ref style with locatorStyle="ref".',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (e1) or CSS selector' },
        value: { type: 'string', description: 'Text to enter' },
        submit: { type: 'boolean', description: 'Submit the form after filling' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target', 'value'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into the currently focused element.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Text to type' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['value'],
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key (e.g. Enter, Tab, Escape).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (Enter, Tab, Escape, ArrowDown, etc.)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a dropdown element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector of the <select>' },
        value: { type: 'string', description: 'Option value to select' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target', 'value'],
    },
  },
  {
    name: 'browser_check',
    description: 'Check a checkbox element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_uncheck',
    description: 'Uncheck a checkbox element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover the mouse over an element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_dblclick',
    description: 'Double-click an element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        locatorStyle: { type: 'string', enum: ['role', 'css', 'ref'], description: 'Codegen locator style (default: role)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag an element from one position to another (drag and drop).',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Element ref or CSS selector to drag from' },
        end: { type: 'string', description: 'Element ref or CSS selector to drag to' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['start', 'end'],
    },
  },

  // ── Snapshot & Search ──
  {
    name: 'browser_snapshot',
    description: 'Take an accessibility (aria) snapshot of the page or a specific element. Returns a YAML-like tree with element refs (e1, e2...) for use in other commands.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref to snapshot a subtree (optional — omit for full page)' },
        depth: { type: 'number', description: 'Max traversal depth (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_find',
    description: 'Find elements by text content. Returns matching elements with their refs.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for' },
        regex: { type: 'string', description: 'Use as regex pattern instead of literal text' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the page or a specific element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector (optional — omit for full page)' },
        filename: { type: 'string', description: 'Output filename (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_pdf',
    description: 'Save the current page as a PDF (W3C WebDriver print endpoint).',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Output filename (optional, default page-<timestamp>.pdf)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_eval',
    description: 'Execute JavaScript in the page. Can run on a specific element or the document.',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
        target: { type: 'string', description: 'Element ref to use as argument (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['script'],
    },
  },
  {
    name: 'browser_run_code',
    description:
      'Execute an arbitrary Selenium snippet inside the daemon process (v0.9). The snippet is the body of an async function that receives the live selenium-webdriver `driver`, e.g. `async driver => { return await driver.getTitle(); }`. The result is awaited and serialized; returned WebElements are assigned fresh refs (e100, e101, ...) so subsequent commands can act on them. SECURITY: runs with full driver privileges — prefer dedicated commands (browser_click, browser_fill, ...) whenever possible.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript function body: `async driver => { ... return value; }`' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_generate_locator',
    description:
      'Inspect the best locator(s) for a snapshot ref (v0.9). Reports the recommended locator (role-based by default, falling back to id/css/xpath) with match counts, without performing any action. The recommended locator has matchCount 1 and the highest stability (role > id > css > xpath).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref, e.g. "e7"' },
        all: { type: 'boolean', description: 'List all candidate locators with match counts' },
        style: { type: 'string', enum: ['role', 'id', 'css', 'xpath'], description: 'Force a specific locator type' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target'],
    },
  },

  // ── Tab Management ──
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs/windows.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_tab_new',
    description: 'Open a new browser tab. Optionally navigate to a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open in the new tab (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_tab_close',
    description: 'Close the current browser tab.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_tab_select',
    description: 'Switch to a browser tab by index.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index (0-based)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['index'],
    },
  },

  // ── Storage & State ──
  {
    name: 'browser_cookie_list',
    description: 'List all cookies for the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_cookie_get',
    description: 'Get a specific cookie by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie name' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_cookie_set',
    description: 'Set a cookie with name and value.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie name' },
        value: { type: 'string', description: 'Cookie value' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'browser_cookie_delete',
    description: 'Delete a cookie by name, or all cookies if no name given.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie name to delete (optional — omit for all)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_localstorage_list',
    description: 'List all keys in localStorage for the current origin.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_localstorage_get',
    description: 'Get a value from localStorage by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'localStorage key' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_localstorage_set',
    description: 'Set a value in localStorage.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'localStorage key' },
        value: { type: 'string', description: 'Value to store' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'browser_localstorage_delete',
    description: 'Delete a localStorage key, or clear all if no key given.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'localStorage key to delete (optional — omit for clear)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_sessionstorage_list',
    description: 'List all keys in sessionStorage for the current origin.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_sessionstorage_get',
    description: 'Get a value from sessionStorage by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'sessionStorage key' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_sessionstorage_set',
    description: 'Set a value in sessionStorage.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'sessionStorage key' },
        value: { type: 'string', description: 'Value to store' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'browser_sessionstorage_delete',
    description: 'Delete a sessionStorage key, or clear all if no key given.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'sessionStorage key to delete (optional — omit for clear)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_state_save',
    description: 'Save browser state (cookies + storage) to a JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Output filename (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_state_load',
    description: 'Load browser state (cookies + storage) from a JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Input filename (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },

  // ── Advanced Input (v0.5) ──
  {
    name: 'browser_dialog_accept',
    description: 'Accept an alert/confirm/prompt dialog. Optionally provide text for prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to enter in a prompt dialog (optional)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_dialog_dismiss',
    description: 'Dismiss an alert/confirm/prompt dialog.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_upload',
    description: 'Upload a file to a file input element.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector of the file input' },
        file: { type: 'string', description: 'Path to the file to upload' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['target', 'file'],
    },
  },
  {
    name: 'browser_resize',
    description: 'Set the viewport size.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Viewport width in pixels' },
        height: { type: 'number', description: 'Viewport height in pixels' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'browser_keydown',
    description: 'Press and hold a keyboard key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_keyup',
    description: 'Release a held keyboard key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_mousemove',
    description: 'Move the mouse to specific coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_mousedown',
    description: 'Press a mouse button (left/right/middle).',
    inputSchema: {
      type: 'object',
      properties: {
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_mouseup',
    description: 'Release a mouse button.',
    inputSchema: {
      type: 'object',
      properties: {
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_mousewheel',
    description: 'Scroll the mouse wheel by offsets.',
    inputSchema: {
      type: 'object',
      properties: {
        dx: { type: 'number', description: 'Horizontal scroll offset' },
        dy: { type: 'number', description: 'Vertical scroll offset' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['dx', 'dy'],
    },
  },
  {
    name: 'browser_actions_chain',
    description: 'Chain multiple actions into a single perform() call to reduce round-trips. Pass a JSON array of action objects.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: { type: 'string', description: 'JSON array of action objects' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['actions'],
    },
  },

  // ── Assertions (v0.6) ──
  {
    name: 'browser_expect',
    description: 'Assert a condition on the page. Supports: visible, hidden, enabled, disabled, checked, unchecked, text, value, count, attribute, title, url. Use --not to invert. Returns success (exit 0) or failure (exit 1).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector (not needed for title/url assertions)' },
        assertion: {
          type: 'string',
          enum: ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'text', 'value', 'count', 'attribute', 'title', 'url'],
          description: 'Assertion type',
        },
        expected: { type: 'string', description: 'Expected value (for text/value/count/attribute/title/url assertions)' },
        attributeValue: { type: 'string', description: 'Attribute value (for attribute assertions: name value)' },
        not: { type: 'boolean', description: 'Invert the assertion' },
        exact: { type: 'boolean', description: 'Use exact match (for text/value assertions)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds for polling' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['assertion'],
    },
  },

  // ── Network & Debugging (v0.7) ──
  {
    name: 'browser_highlight',
    description: 'Outline an element for visual debugging. Default: 3px solid red. Use --hide to remove.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector (optional for --all)' },
        style: { type: 'string', description: 'CSS style for the outline (e.g. "2px solid blue")' },
        hide: { type: 'boolean', description: 'Remove highlight(s)' },
        all: { type: 'boolean', description: 'Remove all highlights (use with --hide)' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_console',
    description: 'Get buffered console messages and JS errors. Filter by level or time range.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['error', 'warn', 'info', 'log', 'js-error'], description: 'Filter by log level or JS errors' },
        since: { type: 'string', description: 'Only show messages from last N (e.g. "5m", "1h")' },
        clear: { type: 'boolean', description: 'Clear buffer after output' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_requests',
    description: 'List all buffered network requests. Filter by URL substring, status code, or HTTP method.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter by URL substring' },
        status: { type: 'string', description: 'Filter by status code' },
        method: { type: 'string', description: 'Filter by HTTP method (GET, POST, etc.)' },
        clear: { type: 'boolean', description: 'Clear buffer after output' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_request_detail',
    description: 'Show details of a specific network request (headers, body, response).',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Request index from browser_requests list' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['index'],
    },
  },
  {
    name: 'browser_route',
    description: 'Mock a network route by URL pattern. Set a custom status code, body, or headers for matching requests.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'URL glob pattern to match (e.g. "**/api/**")' },
        status: { type: 'string', description: 'HTTP status code to return (required)' },
        body: { type: 'string', description: 'Response body to return' },
        headers: { type: 'string', description: 'Response headers (JSON string)' },
        session: { type: 'string', description: 'Session name' },
      },
      required: ['pattern', 'status'],
    },
  },
  {
    name: 'browser_route_list',
    description: 'List all active route mocks.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_unroute',
    description: 'Remove a route mock by index, or all routes with --all.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Route index to remove (from route-list)' },
        all: { type: 'boolean', description: 'Remove all routes' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  // ── v0.8: Device & Environment Emulation ──
  {
    name: 'browser_device',
    description: 'Apply a device preset (viewport, user agent, deviceScaleFactor, touch). Chrome/Edge full support; Firefox viewport only. Run browser_device_list for available presets.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Device preset name (e.g. "iPhone 13")' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_device_list',
    description: 'List all built-in device presets.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
  {
    name: 'browser_emulate',
    description: 'Apply or reset runtime network/CPU emulation (offline, throttling). Chrome/Edge only. Use --reset to restore.',
    inputSchema: {
      type: 'object',
      properties: {
        offline: { type: 'boolean', description: 'Go offline' },
        throttleNetwork: { type: 'string', description: 'slow3g | fast3g | gprs | custom:download=,upload=,latency=' },
        throttleCpu: { type: 'number', description: 'CPU slowdown rate (>= 1)' },
        reset: { type: 'boolean', description: 'Reset all runtime emulation' },
        session: { type: 'string', description: 'Session name' },
      },
    },
  },
];

// ─── Tool-to-CLI Arg Mapping ─────────────────────────────────────────────────

/**
 * Map an MCP tool name + arguments to CLI args for the daemon.
 * Exported for unit testing.
 */
export function mapToolToCliArgs(toolName: string, args: any): string[] | null {
  const sessionFlag = args.session ? ['-s', args.session] : [];
  const timeoutFlag = args.timeout ? ['--timeout', String(args.timeout)] : [];

  switch (toolName) {
    // Navigation
    case 'browser_navigate':
      return ['goto', args.url, ...sessionFlag];
    case 'browser_go_back':
      return ['go-back', ...sessionFlag];
    case 'browser_go_forward':
      return ['go-forward', ...sessionFlag];
    case 'browser_reload':
      return ['reload', ...sessionFlag];
    case 'browser_get_title':
      return ['title', ...sessionFlag];
    case 'browser_get_url':
      return ['url', ...sessionFlag];

    // Interaction
    case 'browser_click':
      return ['click', args.target, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_fill':
      return ['fill', args.target, args.value, ...(args.submit ? ['--submit'] : []), ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_type':
      return ['type', args.value, ...sessionFlag];
    case 'browser_press':
      return ['press', args.key, ...sessionFlag];
    case 'browser_select':
      return ['select', args.target, args.value, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_check':
      return ['check', args.target, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_uncheck':
      return ['uncheck', args.target, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_hover':
      return ['hover', args.target, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_dblclick':
      return ['dblclick', args.target, ...(args.locatorStyle ? [`--locator-style=${args.locatorStyle}`] : []), ...sessionFlag];
    case 'browser_drag':
      return ['drag', args.start, args.end, ...sessionFlag];

    // Snapshot & Search
    case 'browser_snapshot': {
      const cliArgs: string[] = ['snapshot'];
      if (args.target) cliArgs.push(args.target);
      if (args.depth) cliArgs.push(`--depth=${args.depth}`);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_find': {
      const cliArgs: string[] = ['find'];
      if (args.regex) {
        cliArgs.push('--regex', args.regex);
      } else {
        cliArgs.push(args.text || '');
      }
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_screenshot': {
      const cliArgs: string[] = ['screenshot'];
      if (args.target) cliArgs.push(args.target);
      if (args.filename) cliArgs.push(`--filename=${args.filename}`);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_pdf': {
      const cliArgs: string[] = ['pdf'];
      if (args.filename) cliArgs.push(`--filename=${args.filename}`);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_eval': {
      const cliArgs: string[] = ['eval', args.script];
      if (args.target) cliArgs.push(args.target);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_run_code': {
      const cliArgs: string[] = ['run-code', args.code];
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_generate_locator': {
      const cliArgs: string[] = ['generate-locator', args.target];
      if (args.all) cliArgs.push('--all');
      if (args.style) cliArgs.push(`--style=${args.style}`);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }

    // Tab Management
    case 'browser_tab_list':
      return ['tab-list', ...sessionFlag];
    case 'browser_tab_new':
      return ['tab-new', ...(args.url ? [args.url] : []), ...sessionFlag];
    case 'browser_tab_close':
      return ['tab-close', ...sessionFlag];
    case 'browser_tab_select':
      return ['tab-select', String(args.index), ...sessionFlag];

    // Storage & State
    case 'browser_cookie_list':
      return ['cookie-list', ...sessionFlag];
    case 'browser_cookie_get':
      return ['cookie-get', args.name, ...sessionFlag];
    case 'browser_cookie_set':
      return ['cookie-set', args.name, args.value, ...sessionFlag];
    case 'browser_cookie_delete':
      return ['cookie-delete', ...(args.name ? [args.name] : []), ...sessionFlag];
    case 'browser_localstorage_list':
      return ['localstorage-list', ...sessionFlag];
    case 'browser_localstorage_get':
      return ['localstorage-get', args.key, ...sessionFlag];
    case 'browser_localstorage_set':
      return ['localstorage-set', args.key, args.value, ...sessionFlag];
    case 'browser_localstorage_delete':
      return ['localstorage-delete', ...(args.key ? [args.key] : []), ...sessionFlag];
    case 'browser_sessionstorage_list':
      return ['sessionstorage-list', ...sessionFlag];
    case 'browser_sessionstorage_get':
      return ['sessionstorage-get', args.key, ...sessionFlag];
    case 'browser_sessionstorage_set':
      return ['sessionstorage-set', args.key, args.value, ...sessionFlag];
    case 'browser_sessionstorage_delete':
      return ['sessionstorage-delete', ...(args.key ? [args.key] : []), ...sessionFlag];
    case 'browser_state_save':
      return ['state-save', ...(args.filename ? [`--filename=${args.filename}`] : []), ...sessionFlag];
    case 'browser_state_load':
      return ['state-load', ...(args.filename ? [`--filename=${args.filename}`] : []), ...sessionFlag];

    // Advanced Input (v0.5)
    case 'browser_dialog_accept':
      return ['dialog-accept', ...(args.text ? [args.text] : []), ...sessionFlag];
    case 'browser_dialog_dismiss':
      return ['dialog-dismiss', ...sessionFlag];
    case 'browser_upload':
      return ['upload', args.target, args.file, ...sessionFlag];
    case 'browser_resize':
      return ['resize', String(args.width), String(args.height), ...sessionFlag];
    case 'browser_keydown':
      return ['keydown', args.key, ...sessionFlag];
    case 'browser_keyup':
      return ['keyup', args.key, ...sessionFlag];
    case 'browser_mousemove':
      return ['mousemove', String(args.x), String(args.y), ...sessionFlag];
    case 'browser_mousedown':
      return ['mousedown', ...(args.button ? [args.button] : []), ...sessionFlag];
    case 'browser_mouseup':
      return ['mouseup', ...(args.button ? [args.button] : []), ...sessionFlag];
    case 'browser_mousewheel':
      return ['mousewheel', String(args.dx), String(args.dy), ...sessionFlag];
    case 'browser_actions_chain':
      return ['actions-chain', args.actions, ...sessionFlag];

    // Assertions (v0.6)
    case 'browser_expect': {
      const cliArgs: string[] = ['expect'];
      if (args.target) cliArgs.push(args.target);
      cliArgs.push(args.assertion);
      if (args.expected) cliArgs.push(args.expected);
      if (args.attributeValue) cliArgs.push(args.attributeValue);
      if (args.not) cliArgs.push('--not');
      if (args.exact) cliArgs.push('--exact');
      cliArgs.push(...timeoutFlag);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }

    // Network & Debugging (v0.7)
    case 'browser_highlight': {
      const cliArgs: string[] = ['highlight'];
      if (args.target) cliArgs.push(args.target);
      if (args.style) cliArgs.push(`--style=${args.style}`);
      if (args.hide) cliArgs.push('--hide');
      if (args.all) cliArgs.push('--all');
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_console': {
      const cliArgs: string[] = ['console'];
      if (args.level) cliArgs.push(args.level);
      if (args.since) cliArgs.push(`--since=${args.since}`);
      if (args.clear) cliArgs.push('--clear');
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_requests': {
      const cliArgs: string[] = ['requests'];
      if (args.filter) cliArgs.push(`--filter=${args.filter}`);
      if (args.status) cliArgs.push(`--status=${args.status}`);
      if (args.method) cliArgs.push(`--method=${args.method}`);
      if (args.clear) cliArgs.push('--clear');
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_request_detail':
      return ['request', String(args.index), ...sessionFlag];
    case 'browser_route': {
      const cliArgs: string[] = ['route', args.pattern];
      cliArgs.push(`--status=${args.status}`);
      if (args.body) cliArgs.push(`--body=${args.body}`);
      if (args.headers) cliArgs.push(`--headers=${args.headers}`);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_route_list':
      return ['route-list', ...sessionFlag];
    case 'browser_unroute': {
      const cliArgs: string[] = ['unroute'];
      if (args.all) {
        cliArgs.push('--all');
      } else if (args.index !== undefined) {
        cliArgs.push(String(args.index));
      }
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    // v0.8: Device & Environment Emulation
    case 'browser_device': {
      const cliArgs: string[] = ['device'];
      if (args.name) cliArgs.push(args.name);
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }
    case 'browser_device_list':
      return ['device-list', ...sessionFlag];
    case 'browser_emulate': {
      const cliArgs: string[] = ['emulate'];
      if (args.offline !== undefined) cliArgs.push(args.offline ? '--offline' : '--offline=false');
      if (args.throttleNetwork) cliArgs.push(`--throttle-network=${args.throttleNetwork}`);
      if (args.throttleCpu !== undefined) cliArgs.push(`--throttle-cpu=${args.throttleCpu}`);
      if (args.reset) cliArgs.push('--reset');
      cliArgs.push(...sessionFlag);
      return cliArgs;
    }

    // Session management handled separately in handleToolsCall
    case 'browser_open':
    case 'browser_close':
    case 'browser_list_sessions':
    case 'browser_close_all':
      return [];

    default:
      return null;
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

export type McpTransport = 'stdio' | 'http';

export interface HttpServerOptions {
  port: number;
  host?: string;
}

export class McpServer {
  private rl: readline.Interface | null = null;
  private initialized = false;
  private workspaceDir: string;
  private sessions: Map<string, Session> = new Map();
  private queue: Promise<void> = Promise.resolve();
  private transport: McpTransport;
  // The transport writes JSON-RPC response lines; stdio writes to stdout,
  // the HTTP transport captures lines per-request instead.
  private writeResponse: (line: string) => void = (line) => process.stdout.write(line);

  constructor(workspaceDir?: string, transport: McpTransport = 'stdio') {
    this.workspaceDir = workspaceDir || this.findWorkspaceDir(process.cwd());
    this.transport = transport;

    // Redirect console.* and stderr into a log file. stdout is reserved for
    // JSON-RPC responses and MCP clients (VS Code, Claude Desktop) typically
    // don't read the server's stderr either — without this, uncaught
    // exceptions and stray console output from the long-lived server would
    // be lost. Original console/stderr are preserved for callers that opt out.
    const mcpLogger = new FileLogger(path.join(baseDaemonDir(), 'logs'), 'mcp.log');
    mcpLogger.installConsoleRedirect();
    mcpLogger.installStderrRedirect();

    if (transport === 'stdio') {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      // Suppress stdout from the daemon/Session so it doesn't corrupt JSON-RPC.
      // stderr is fine — MCP clients read stderr separately.
      this.rl.on('line', (line: string) => {
        // Serialize requests through a promise chain: concurrent handling
        // (e.g. a client burst) would race on the same daemon/session.
        this.queue = this.queue
          .then(() => this.handleLine(line))
          .catch((err) => {
            // Fatal error in message handling — send internal error
            this.writeResponse(
              JSON.stringify({
                jsonrpc: '2.0',
                id: -1,
                error: {
                  code: INTERNAL_ERROR,
                  message: `Internal error: ${err.message}`,
                },
              }) + '\n'
            );
          });
      });

      this.rl.on('close', () => {
        // stdin closed — shut down
        this.shutdown();
      });
    }
  }

  /**
   * Start the MCP server. stdio mode reads JSON-RPC messages from stdin;
   * http mode starts a Streamable HTTP server on the configured port.
   */
  start(options?: HttpServerOptions): void {
    if (this.transport === 'http') {
      startHttpServer(this, options || { port: 8931 });
      return;
    }
    // stdio: the readline interface is already set up in the constructor.
  }

  /**
   * Run a JSON-RPC message through the serialized request queue. Used by the
   * HTTP transport; stdio goes through handleLine() instead.
   */
  enqueueMessage(msg: JsonRpcMessage): Promise<void> {
    const run = this.queue.then(() => this.handleMessage(msg));
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Stop every browser session managed by this server (used by HTTP DELETE).
   */
  async closeSessions(): Promise<void> {
    for (const [, session] of this.sessions) {
      try { await session.stop(); } catch {}
    }
    this.sessions.clear();
  }

  private findWorkspaceDir(cwd: string): string {
    let dir = cwd;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, '.se-cli'))) return dir;
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return cwd;
  }

  private getSession(sessionName: string = 'default'): Session {
    if (!this.sessions.has(sessionName)) {
      const session = new Session(this.workspaceDir, sessionName);
      this.sessions.set(sessionName, session);
    }
    return this.sessions.get(sessionName)!;
  }

  private async handleLine(line: string): Promise<void> {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      this.sendResponse(-1, undefined, {
        code: PARSE_ERROR,
        message: 'Parse error: invalid JSON',
      });
      return;
    }
    await this.handleMessage(msg);
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    // Notifications don't have an id — no response needed
    if (!('id' in msg) || msg.id === undefined || msg.id === null) {
      // Handle notification
      if ('method' in msg) {
        const notif = msg as JsonRpcNotification;
        if (notif.method === 'notifications/initialized') {
          this.initialized = true;
        }
        if (notif.method === 'notifications/cancelled') {
          // Request cancellation — we don't support it yet, just ignore
        }
      }
      return;
    }

    // It's a request — we need to respond
    const req = msg as JsonRpcRequest;
    await this.handleRequest(req);
  }

  private async handleRequest(req: JsonRpcRequest): Promise<void> {
    const { id, method, params } = req;

    try {
      switch (method) {
        case 'initialize':
          await this.handleInitialize(id, params);
          break;
        case 'ping':
          this.sendResponse(id, {});
          break;
        case 'tools/list':
          await this.handleToolsList(id);
          break;
        case 'tools/call':
          await this.handleToolsCall(id, params);
          break;
        case 'resources/list':
          this.sendResponse(id, { resources: [] });
          break;
        case 'prompts/list':
          this.sendResponse(id, { prompts: [] });
          break;
        default:
          this.sendResponse(id, undefined, {
            code: METHOD_NOT_FOUND,
            message: `Method not found: ${method}`,
          });
      }
    } catch (err: any) {
      this.sendResponse(id, undefined, {
        code: INTERNAL_ERROR,
        message: err.message || 'Internal error',
      });
    }
  }

  private async handleInitialize(id: number | string, params: any): Promise<void> {
    this.sendResponse(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
        logging: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    });
  }

  private async handleToolsList(id: number | string): Promise<void> {
    this.sendResponse(id, {
      tools: toolDefinitions,
    });
  }

  private async handleToolsCall(id: number | string, params: any): Promise<void> {
    const { name, arguments: args } = params;

    if (!args || typeof args !== 'object') {
      this.sendResponse(id, undefined, {
        code: INVALID_PARAMS,
        message: 'Missing or invalid arguments',
      });
      return;
    }

    // Map MCP tool name + args to CLI args
    const cliArgs = this.mapToolToCliArgs(name, args);
    if (!cliArgs) {
      this.sendResponse(id, undefined, {
        code: INVALID_PARAMS,
        message: `Unknown tool: ${name}`,
      });
      return;
    }

    const sessionName = args.session || 'default';

    // Handle session-management commands locally
    if (name === 'browser_open') {
      const result = await this.handleOpen(args, sessionName);
      this.sendResponse(id, {
        content: [{ type: 'text', text: result.text }],
        isError: !result.ok,
      });
      return;
    }

    if (name === 'browser_close') {
      const session = this.sessions.get(sessionName);
      if (!session) {
        // The daemon may exist but was started outside this MCP process
        // (e.g. via CLI) — don't claim success for a session we never opened.
        this.sendResponse(id, {
          content: [{
            type: 'text',
            text: `No browser session managed by this MCP server: "${sessionName}". Use browser_open first, or "se-cli close" to stop CLI-started sessions.`,
          }],
          isError: true,
        });
        return;
      }
      try {
        await session.stop();
        this.sessions.delete(sessionName);
        this.sendResponse(id, {
          content: [{ type: 'text', text: 'Browser session closed.' }],
          isError: false,
        });
      } catch (e: any) {
        this.sendResponse(id, {
          content: [{ type: 'text', text: `Error closing session: ${e.message}` }],
          isError: true,
        });
      }
      return;
    }

    if (name === 'browser_list_sessions') {
      const result = await this.handleListSessions();
      this.sendResponse(id, {
        content: [{ type: 'text', text: result }],
        isError: false,
      });
      return;
    }

    if (name === 'browser_close_all') {
      let failures = 0;
      for (const [sName, session] of this.sessions) {
        try {
          await session.stop();
          this.sessions.delete(sName);
        } catch {
          failures++;
        }
      }
      this.sendResponse(id, {
        content: [{
          type: 'text',
          text: failures === 0
            ? 'All browser sessions closed.'
            : `${failures} session(s) failed to close.`,
        }],
        isError: failures > 0,
      });
      return;
    }

    // Forward tool command to daemon
    const session = this.getSession(sessionName);
    let resp: ServerMessage;
    try {
      resp = await session.run(cliArgs, process.cwd(), { raw: false, json: false });
    } catch (e: any) {
      this.sendResponse(id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      });
      return;
    }

    const text = resp.ok
      ? resp.text || ''
      : `Error: ${resp.error || 'Unknown error'}`;

    this.sendResponse(id, {
      content: [{ type: 'text', text }],
      isError: !resp.ok,
    });
  }

/**
 * Map an MCP tool name + arguments to CLI args for the daemon.
 */
  private mapToolToCliArgs(toolName: string, args: any): string[] | null {
    return mapToolToCliArgs(toolName, args);
  }

  private async handleOpen(args: any, sessionName: string): Promise<{ ok: boolean; text: string }> {
    const session = this.getSession(sessionName);
    const { opts: openOpts, error } = buildOpenOptions(args, this.workspaceDir, sessionName);
    if (error) {
      return { ok: false, text: error };
    }

    try {
      await session.startDaemon(openOpts);
      const browserName = openOpts.browserName || 'chrome';
      let result = `Browser session "${sessionName}" started (${browserName}, ${args.headed ? 'headed' : 'headless'}).`;

      if (args.url) {
        const resp = await session.run(['goto', args.url], process.cwd(), { raw: false, json: false });
        if (resp.ok && resp.text) {
          result += '\n' + resp.text;
        } else if (!resp.ok) {
          result += `\nError navigating: ${resp.error}`;
        }
      }
      return { ok: true, text: result };
    } catch (e: any) {
      return { ok: false, text: `Error starting browser: ${e.message}` };
    }
  }

  private async handleListSessions(): Promise<string> {
    const registry = new Registry(baseDaemonDir());
    const wsHash = workspaceHash(this.workspaceDir);
    const sessions = registry.listSessions(wsHash);
    if (sessions.length === 0) {
      return 'No active sessions.';
    }
    const lines: string[] = ['Active sessions:'];
    for (const s of sessions) {
      const alive = await new Session(this.workspaceDir, s.name).canConnect();
      const status = alive ? 'live' : 'dead';
      lines.push(`  ${s.name}\t${status}\t${s.browserName}\t${new Date(s.timestamp).toISOString()}`);
    }
    return lines.join('\n');
  }

  private sendResponse(id: number | string, result?: any, error?: { code: number; message: string; data?: any }): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
    };
    if (error) {
      response.error = error;
    } else {
      response.result = result;
    }
    this.writeResponse(JSON.stringify(response) + '\n');
  }

  private async shutdown(): Promise<void> {
    await this.closeSessions();
    this.rl?.close();
  }
}

// ─── Streamable HTTP transport ──────────────────────────────────────────────
//
// Implements the MCP Streamable HTTP transport (2025-06-18 spec):
//   POST /mcp  — JSON-RPC request; responds application/json (initialize,
//                requests without SSE accept) or text/event-stream
//   GET  /mcp  — SSE stream for server-initiated messages (kept open; se-cli
//                sends none, so the stream only carries keep-alive comments)
//   DELETE /mcp — terminate the session and close managed browser sessions
//
// Session lifecycle: a session id is minted on initialize and echoed back
// via the Mcp-Session-Id header on subsequent requests.

const MCP_PATH = '/mcp';
const KEEPALIVE_INTERVAL_MS = 15000;
const crypto = require('crypto') as typeof import('crypto');

function isJsonRpcMessage(value: any): value is JsonRpcRequest | JsonRpcNotification {
  return (
    !!value &&
    typeof value === 'object' &&
    'method' in value &&
    typeof (value as JsonRpcRequest).method === 'string'
  );
}

/**
 * Start the Streamable HTTP server for an McpServer instance.
 * Returns the http.Server (useful for tests with port 0).
 */
export function startHttpServer(mcp: McpServer, options: HttpServerOptions): http.Server {
  const host = options.host || '127.0.0.1';
  const httpSessions = new Set<string>();
  // Serialize POST handling at the HTTP layer: the MCP server captures
  // response lines on the shared McpServer instance, so concurrent requests
  // must not interleave.
  let postChain: Promise<void> = Promise.resolve();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. MCP endpoint: /mcp' }));
      return;
    }

    if (req.method === 'GET') {
      // Server-initiated SSE stream. se-cli has no server-initiated events,
      // so the stream stays open with periodic keep-alive comments.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // flushHeaders() is required for SSE: without it the client's HTTP
      // parser (no Content-Length / chunked framing) waits for EOF before
      // delivering the response.
      res.flushHeaders();
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
      }, KEEPALIVE_INTERVAL_MS);
      res.on('close', () => clearInterval(keepAlive));
      return;
    }

    if (req.method === 'DELETE') {
      mcp.closeSessions().finally(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({}));
      });
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const run = postChain.then(async () => {
      let body = '';
      for await (const chunk of req) body += chunk;
      handleHttpPost(mcp, req, res, body, httpSessions);
    });
    postChain = run.catch(() => {});
  });

  server.listen(options.port, host, () => {
    // Logged to the mcp.log file (console was redirected in the constructor).
    console.log(`se-cli MCP server (streamable HTTP) listening on http://${host}:${options.port}${MCP_PATH}`);
  });

  // Bind failures (port already in use, permission denied) must not crash
  // the daemon with an unhandled 'error' event.
  server.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`se-cli MCP server: port ${options.port} is already in use. Use --port to pick another port.`);
    } else {
      console.error(`se-cli MCP server: ${err && err.message ? err.message : err}`);
    }
    mcp.closeSessions().finally(() => process.exit(1));
  });
  return server;
}

function handleHttpPost(
  mcp: McpServer,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  httpSessions: Set<string>,
): void {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  let msg: any;
  try {
    msg = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: PARSE_ERROR, message: 'Parse error: invalid JSON' },
      })
    );
    return;
  }

  if (!isJsonRpcMessage(msg)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: INVALID_REQUEST, message: 'Invalid Request' },
      })
    );
    return;
  }

  const isInitialize = msg.method === 'initialize';
  const accept = String(req.headers.accept || '');
  const wantsSse = accept.includes('text/event-stream') && !isInitialize;

  // Capture the response line instead of writing it to stdout.
  let captured: string | null = null;
  const prevWriter = (mcp as any).writeResponse;
  (mcp as any).writeResponse = (line: string) => { captured = line; };

  mcp
    .enqueueMessage(msg)
    .catch(() => {})
    .finally(() => {
      (mcp as any).writeResponse = prevWriter;

      if (!captured) {
        // Notification — Accepted, no body.
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end();
        return;
      }

      // Mint a session id on initialize; echo valid ids otherwise.
      let responseSessionId: string | undefined;
      if (isInitialize) {
        responseSessionId = crypto.randomUUID();
        httpSessions.add(responseSessionId);
      } else if (sessionId && httpSessions.has(sessionId)) {
        responseSessionId = sessionId;
      }

      const headers: Record<string, string> = {};
      if (responseSessionId) headers['Mcp-Session-Id'] = responseSessionId;

      if (wantsSse) {
        headers['Content-Type'] = 'text/event-stream';
        res.writeHead(200, headers);
        res.write(`event: message\ndata: ${captured}\n\n`);
        res.end();
      } else {
        headers['Content-Type'] = 'application/json';
        res.writeHead(200, headers);
        res.end(captured);
      }
    });
}

/**
 * Build the startDaemon options for `browser_open`.
 *
 * Auto-detects the browser (Edge → Chrome → Firefox) when neither `browser`
 * nor `cdp` is given. Returns an error message (not an exception) when no
 * browser is found, since the MCP server is a long-lived process — unlike the
 * CLI which exits with code 1 in that case.
 */
export function buildOpenOptions(
  args: any,
  workspaceDir: string,
  sessionName: string,
): { opts: any; error?: string } {
  const openOpts: any = {};
  if (args.browser) {
    openOpts.browserName = args.browser;
  } else if (!args.cdp) {
    const detected = detectBrowser();
    if (!detected) {
      return {
        opts: openOpts,
        error: 'Error starting browser: No browser detected. Install Edge, Chrome, or Firefox, or pass browser ("chrome"|"edge"|"firefox").',
      };
    }
    openOpts.browserName = detected;
  }
  if (args.headed) openOpts.headed = true;
  if (args.cdp) openOpts.cdpEndpoint = args.cdp;
  if (args.profile) openOpts.profilePath = args.profile;
  if (args.persistent) {
    openOpts.persistent = true;
    const wsHash = workspaceHash(workspaceDir);
    openOpts.profilePath = path.join(baseDaemonDir(), 'profiles', wsHash, sessionName);
  }
  return { opts: openOpts };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export function startMcpServer(workspaceDir?: string, options?: { http?: boolean; port?: number; host?: string }): void {
  const server = new McpServer(workspaceDir, options?.http ? 'http' : 'stdio');
  server.start(options?.http ? { port: options.port || 8931, host: options.host } : undefined);
}
