<div align="center">
  <img src="https://se-cli.github.io/se-site/img/logo.svg" alt="se-cli" width="280" />
</div>

<p align="center">
  Token-efficient Selenium browser automation CLI for AI agents and humans.<br/>
  Inspired by <a href="https://github.com/microsoft/playwright-cli">playwright-cli</a>, ported to the Selenium ecosystem.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@browsers-cli/se-cli"><img src="https://img.shields.io/npm/v/@browsers-cli/se-cli?color=22C55E&label=npm" alt="npm version" /></a>
  <a href="https://github.com/se-cli/se-cli/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/se-cli/se-cli/ci.yml?branch=main&label=CI&color=22C55E" alt="CI" /></a>
  <a href="#"><img src="https://img.shields.io/badge/coverage-95%25%2B-22C55E" alt="Coverage" /></a>
  <a href="https://github.com/se-cli/se-cli/blob/main/LICENSE"><img src="https://img.shields.io/github/license/se-cli/se-cli?color=22C55E" alt="License" /></a>
  <a href="https://github.com/se-cli/se-cli"><img src="https://img.shields.io/github/stars/se-cli/se-cli?style=social" alt="Stars" /></a>
  <a href="https://www.npmjs.com/package/@browsers-cli/se-cli"><img src="https://img.shields.io/npm/dm/@browsers-cli/se-cli?color=22C55E&label=downloads" alt="npm downloads" /></a>
  <a href="https://se-cli.github.io/se-site/"><img src="https://img.shields.io/badge/docs-site-22C55E" alt="Docs" /></a>
</p>

---

## Documentation

Full documentation is available on the **se-cli website**: [https://se-cli.github.io/se-site/](https://se-cli.github.io/se-site/)

- [Getting Started](https://se-cli.github.io/se-site/docs/getting-started)
- [Command Reference](https://se-cli.github.io/se-site/docs/commands)
- [Configuration](https://se-cli.github.io/se-site/docs/configuration)
- [Test Pages](https://se-cli.github.io/se-site/test-pages/)

## Why se-cli?

Current Selenium MCP implementations consume too many tokens — large tool schemas loaded on every call, full accessibility tree dumps, and no command-line interface. **se-cli** solves this with a CLI + daemon architecture that minimizes token usage while maximizing agent productivity.

### The Problem

| Approach | Token Cost | Why |
|----------|-----------|-----|
| Selenium MCP | High | Tool schemas (~5KB) loaded per call; verbose JSON-RPC envelope |
| Selenium scripts | N/A | Can't be driven by AI agents |
| Raw WebDriver API | N/A | No CLI, no session persistence |

### The Solution

**se-cli** uses a short-lived CLI + long-lived daemon architecture:

- **Short-lived CLI**: each `se-cli <cmd>` is a stateless process — just sends one JSON line to the daemon, gets one line back, exits. Zero schema overhead.
- **Long-lived daemon**: holds the WebDriver instance across calls. No reconnection cost, no driver restart overhead.
- **Aria snapshot + refs**: page state captured as compact YAML with element refs (`e1`, `e2`). Interact by ref instead of verbose selectors.
- **Code generation**: every action emits the equivalent Selenium code — copy directly into test files.

### Advantages

- **10x fewer tokens** than MCP for typical agent workflows (measured via aria snapshot vs full a11y tree)
- **Multi-browser**: Chrome, Edge, and Firefox support out of the box
- **Session persistence**: daemon survives across CLI invocations — no browser restart per command
- **Named sessions**: run multiple browsers in parallel with `-s=name`
- **Agent-agnostic**: works with any AI agent that can run shell commands (Claude Code, Cursor, Copilot CLI, etc.)
- **Familiar API**: commands mirror playwright-cli for easy migration
- **Code generation**: every action produces runnable Selenium code for test files

## Installation

```bash
npm install -g @browsers-cli/se-cli
```

Or use directly with npx:

```bash
npx @browsers-cli/se-cli open https://example.com
```

After installation, the following commands are available (all aliased to the same binary):

| Command | Description |
|---------|-------------|
| `se-cli` | Primary command name |
| `se` | Short alias |
| `selenium-cli` | Legacy alias for backward compatibility |

### Prerequisites

- Node.js 18+
- One or more browsers installed:
  - Google Chrome
  - Microsoft Edge
  - Mozilla Firefox

`selenium-manager` (bundled with `selenium-webdriver`) automatically downloads the correct driver binary.

## Quick Start

```bash
# Start a session and navigate
se-cli open https://example.com

# Take a snapshot to see the page structure
se-cli snapshot
# Output:
# - document:
#   - heading "Example Domain" [level=1]
#   - paragraph: "This domain is for use in illustrative examples..."
#   - link "More information..." [ref=e1]

# Interact by ref
se-cli click e1

# Get page info
se-cli title
se-cli url

# Close the session
se-cli close
```

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `open [url]` | Start daemon + browser, optionally navigate to URL |
| `close` | Close browser and daemon |
| `close --all` | Close every session across all projects (multiple workspaces) |
| `sessions` | List all sessions across all projects with live/dead status |
| `list` | List all sessions |
| `close-all` | Close all sessions gracefully |
| `kill-all` | Force-kill all sessions |
| `logs [--tail=N]` | Show recent daemon + CLI log lines for this session (default tail 50) |
| `mcp-server` | Start MCP server in stdio mode (for VS Code / AI agents) |
| `install --skills` | Install `SKILL.md` into agent skill directories (Claude Code, Cursor, Copilot, custom) |
| `install-browser [chrome\|edge\|firefox]` | Install/verify the browser driver via Selenium Manager (auto-detects if omitted) |
| `grid status <url>` | Query a Selenium Grid 4 hub status (nodes, slots, browsers) |
| `grid attach --endpoint=<url>` | Attach to a Grid / remote WebDriver (alias for `open --endpoint`) |
| `grid distribute --shard=x/y` | Compute a round-robin shard plan for parallel CI runs |
| `pdf [--filename=f]` | Save the current page as a PDF (W3C print endpoint) |

### Navigation

| Command | Description |
|---------|-------------|
| `goto <url>` | Navigate to URL |
| `go-back` | Browser back |
| `go-forward` | Browser forward |
| `reload` | Reload page |

### Interaction

| Command | Description |
|---------|-------------|
| `click <ref\|selector>` | Click element |
| `fill <ref\|selector> <text>` | Clear and fill input |
| `type <text>` | Type into focused element |
| `press <key>` | Press keyboard key (Enter, Tab, Escape, ArrowDown, ...) |
| `select <ref> <value>` | Select dropdown option |
| `check <ref>` | Check checkbox |
| `uncheck <ref>` | Uncheck checkbox |
| `hover <ref>` | Mouse hover over element (v0.5) |
| `dblclick <ref>` | Double-click element (v0.5) |
| `drag <start> <end>` | Drag and drop element (v0.5) |
| `dialog-accept [text]` | Accept alert/confirm/prompt dialog (v0.5) |
| `dialog-dismiss` | Dismiss dialog (v0.5) |
| `upload <ref> <file>` | Upload file to input element (v0.5) |
| `resize <w> <h>` | Set viewport size (v0.5) |
| `keydown <key>` | Press and hold key (v0.5) |
| `keyup <key>` | Release held key (v0.5) |
| `mousemove <x> <y>` | Move mouse to coordinates (v0.5) |
| `mousedown [button]` | Press mouse button (left/right/middle) (v0.5) |
| `mouseup [button]` | Release mouse button (v0.5) |
| `mousewheel <dx> <dy>` | Scroll wheel by offsets (v0.5) |
| `actions-chain <json>` | Chain multiple actions in one perform() (v0.5) |

### Emulation (v0.8)

Device & environment emulation via CDP (`Emulation.*` / `Network.*` / `Browser.*`) on Chrome/Edge, with viewport support on Firefox via WebDriver BiDi. Emulation flags set at `open` are persisted and replayed automatically if the driver rebuilds.

| Command | Description |
|---------|-------------|
| `device <name>` | Apply a device preset (viewport + UA + deviceScaleFactor + touch) (v0.8) |
| `device-list` | List all built-in device presets (v0.8) |
| `emulate` | Show current emulation state (v0.8) |
| `emulate --offline` | Go offline (v0.8, Chrome/Edge) |
| `emulate --throttle-network=<profile>` | Throttle network: `slow3g`\|`fast3g`\|`gprs`\|`custom:download=,upload=,latency=` (v0.8, Chrome/Edge) |
| `emulate --throttle-cpu=<rate>` | CPU slowdown rate, e.g. `4` (v0.8, Chrome/Edge) |
| `emulate --reset` | Restore runtime emulation (keeps open-time flags) (v0.8) |
| `open --viewport=<WxH>` | Page viewport size, e.g. `1280x720` (v0.8) |
| `open --user-agent=<ua>` | Override the browser user agent (v0.8, Chrome/Edge) |
| `open --locale=<tag>` | Override page locale, e.g. `zh-CN` (v0.8, Chrome/Edge) |
| `open --color-scheme=<light\|dark>` | Emulate `prefers-color-scheme` (v0.8, Chrome/Edge) |
| `open --timezone=<id>` | Override timezone, e.g. `America/New_York` (v0.8, Chrome/Edge) |
| `open --geolocation=<lat,lon[,accuracy]>` | Override geolocation (v0.8, Chrome/Edge) |
| `open --permissions=<list>` | Grant permissions, e.g. `geolocation,camera` (v0.8, Chrome/Edge) |

Built-in presets reference Playwright DeviceDescriptors: `Desktop Chrome`, `iPhone 13/14/15/15 Pro`, `iPad Pro 11`, `Pixel 7/8`, `Galaxy S23/S24`. Chrome/Edge apply the full preset via CDP (including `mobile`/`hasTouch`); Firefox applies the viewport via BiDi.

```bash
se-cli open https://example.com --viewport=390x844 --color-scheme=dark
se-cli device "iPhone 13"          # full device emulation (Chrome/Edge)
se-cli device-list                 # list presets
se-cli emulate --throttle-network=slow3g   # network throttling (Chrome/Edge)
se-cli emulate --offline                    # go offline (Chrome/Edge)
se-cli emulate --reset                      # restore runtime emulation
```

### Assertions (v0.6)

Web-First assertions inspired by Playwright. Each `expect` command polls the page until the condition is met (or the timeout expires), then exits with code `0` (pass) or `1` (fail) — ideal for CI pipelines and agent verification flows.

| Command | Description |
|---------|-------------|
| `expect <ref> visible` | Assert element is visible (exit 0/1) (v0.6) |
| `expect <ref> hidden` | Assert element is hidden (v0.6) |
| `expect <ref> enabled` | Assert element is enabled (v0.6) |
| `expect <ref> disabled` | Assert element is disabled (v0.6) |
| `expect <ref> checked` | Assert checkbox is checked (v0.6) |
| `expect <ref> unchecked` | Assert checkbox is unchecked (v0.6) |
| `expect <ref> text "..."` | Assert element text contains/exact match (v0.6) |
| `expect <ref> value "..."` | Assert input value (v0.6) |
| `expect <ref> count N` | Assert matching element count (v0.6) |
| `expect <ref> attribute <name> <value>` | Assert attribute value (v0.6) |
| `expect title "..."` | Assert page title (v0.6) |
| `expect url "..."` | Assert page URL (v0.6) |

**Assertion flags:**

| Flag | Description |
|------|-------------|
| `--not` | Invert the assertion — pass when the condition is false (v0.6) |
| `--exact` | Require strict/exact match instead of substring containment (v0.6) |
| `--timeout=<ms>` | Polling timeout before the assertion fails (default uses `--timeout` config) (v0.6) |

### Network & Debugging (v0.7)

Network interception, console capture, and visual debugging tools powered by Selenium BiDi protocol.

| Command | Description |
|---------|-------------|
| `highlight [ref]` | Outline element with CSS (default: 3px solid red) (v0.7) |
| `highlight <ref> --style="..."` | Custom CSS outline style (v0.7) |
| `highlight <ref> --hide` | Remove highlight from element (v0.7) |
| `highlight --hide --all` | Remove all highlights (v0.7) |
| `console` | All buffered console messages (v0.7) |
| `console error` | Error-level messages only (v0.7) |
| `console js-error` | JavaScript exceptions only (v0.7) |
| `console --since=5m` | Messages from last 5 minutes (v0.7) |
| `console --clear` | Clear console buffer (v0.7) |
| `requests` | List all network requests (v0.7) |
| `requests --filter="api"` | Filter by URL substring (v0.7) |
| `requests --status=500` | Filter by status code (v0.7) |
| `requests --method=POST` | Filter by HTTP method (v0.7) |
| `request <index>` | Show request details (headers, body, response) (v0.7) |
| `route <pattern> --status=401 --body="..."` | Mock API response (v0.7) |
| `route-list` | List active route mocks (v0.7) |
| `unroute <index>` | Remove specific route (v0.7) |
| `unroute --all` | Remove all routes (v0.7) |

### Snapshot & Discovery

| Command | Description |
|---------|-------------|
| `snapshot [ref]` | Aria snapshot of page or element subtree |
| `snapshot --depth=N` | Limit snapshot depth |
| `snapshot --filename=f.yml` | Save snapshot to file |
| `find <text>` | Search snapshot for text |
| `find --regex <pattern>` | Search snapshot with regex |

### Save & Execute

| Command | Description |
|---------|-------------|
| `screenshot [ref]` | Take screenshot (full page or element) |
| `screenshot --filename=f.png` | Save screenshot to file |
| `eval "<js>"` | Execute JavaScript, return result |
| `eval "<js>" <ref>` | Execute JavaScript on element |
| `run-code "<snippet>"` | Execute arbitrary Selenium snippet (receives `driver`, v0.9) |
| `generate-locator <ref>` | Show recommended locator for a ref (v0.9) |
| `title` | Get page title |
| `url` | Get current URL |

### Storage Management

| Command | Description |
|---------|-------------|
| `cookie-list` | List all cookies |
| `cookie-get <name>` | Get a specific cookie |
| `cookie-set <name> <value>` | Set a cookie |
| `cookie-delete [name]` | Delete a cookie (or all if name omitted) |
| `localstorage-get <key>` | Get a localStorage item |
| `localstorage-set <key> <value>` | Set a localStorage item |
| `localstorage-delete [key]` | Delete a localStorage item (or clear all) |
| `localstorage-list` | List all localStorage items |
| `sessionstorage-get <key>` | Get a sessionStorage item |
| `sessionstorage-set <key> <value>` | Set a sessionStorage item |
| `sessionstorage-delete [key]` | Delete a sessionStorage item (or clear all) |
| `sessionstorage-list` | List all sessionStorage items |

### Tab Management

| Command | Description |
|---------|-------------|
| `tab-list` | List all open tabs (handle, title, url) |
| `tab-new [url]` | Open a new tab (optionally navigate to url) |
| `tab-close` | Close current tab and switch to remaining |
| `tab-select <index>` | Switch to tab by index (0-based) |

### State Management

| Command | Description |
|---------|-------------|
| `state-save [--filename=f.json]` | Save cookies, localStorage, sessionStorage to file |
| `state-load [--filename=f.json]` | Load state from file (restores all storage) |

### Configuration

| Command | Description |
|---------|-------------|
| `config get <key>` | Show a config value and its source |
| `config set <key> <value>` | Write a value to the config file |
| `config list` | List all settings with source (flag/env/file/default) |
| `config init` | Generate a template config file (.se-cli.json) |

### Flags

| Flag | Description |
|------|-------------|
| `--raw` | Output only the result value (for scripting) |
| `--json` | Structured JSON output |
| `-s=<name>` | Use named session |
| `--browser=chrome\|edge\|firefox\|safari` | Browser selection (default: auto-detect Edge → Chrome → Firefox; safari macOS-only) |
| `--headed` | Show browser window (default: headless) |
| `--cdp=<url>` | Attach to running Chrome via CDP |
| `--endpoint=<url>` | Connect to Selenium Grid 4 / remote WebDriver (v0.10) |
| `--browser-args="<args>"` | Pass-through browser launch arguments, e.g. `--disable-gpu --lang=zh-CN` (v0.10) |
| `--capabilities=<json>` | Pass-through W3C capabilities, e.g. `--capabilities='{"acceptInsecureCerts":true}'` (v0.10) |
| `--browser-binary=<path>` | Custom browser executable (360, UC, Brave, Electron-embedded…) (v0.10) |
| `--driver-binary=<path>` | Custom driver executable, bypasses selenium-manager (v0.10) |
| `--profile=<path>` | Use a persistent browser profile directory |
| `--persistent` | Keep browser profile across sessions (auto-assigns path) |
| `--idle-timeout=<min>` | Auto-close idle daemon after N minutes (default 30; 0 = never) |
| `--timeout=<ms>` | Per-command explicit-wait timeout (v0.4) |
| `--wait=<state>` | Wait condition: visible\|hidden\|enabled\|disabled\|stable\|attached\|none\|auto (v0.4) |
| `--retry=<n>` | Failure retry count, -1 = until timeout (v0.4) |
| `--retry-interval=<ms>` | Polling interval for retries (v0.4) |
| `--implicit-wait=<ms>` | Driver implicit wait (v0.4) |
| `--page-load-timeout=<ms>` | Page load timeout (v0.4) |
| `--script-timeout=<ms>` | Script timeout for async eval (v0.4) |
| `--no-wait` | Shorthand for --wait=none --timeout=0 (v0.4) |
| `--viewport=<WxH>` | Page viewport size, e.g. 1280x720 (v0.8) |
| `--user-agent=<ua>` | Override the browser user agent (v0.8, Chrome/Edge) |
| `--locale=<tag>` | Override page locale, e.g. zh-CN (v0.8, Chrome/Edge) |
| `--color-scheme=<light\|dark>` | Emulate prefers-color-scheme (v0.8, Chrome/Edge) |
| `--timezone=<id>` | Override timezone, e.g. America/New_York (v0.8, Chrome/Edge) |
| `--geolocation=<lat,lon[,accuracy]>` | Override geolocation (v0.8, Chrome/Edge) |
| `--permissions=<list>` | Grant permissions, e.g. geolocation,camera (v0.8, Chrome/Edge) |

### Logging

The daemon runs detached (its stdio is unreachable from the CLI), so se-cli writes everything to file logs under `baseDaemonDir()/logs` — `%LOCALAPPDATA%\ms-se-cli\daemon\logs\` on Windows, `~/.cache/ms-se-cli/daemon/logs/` elsewhere:

| File | Content |
|------|---------|
| `<wsHash>-<session>.daemon.log` | Daemon lifecycle, driver builds/resets, per-command duration + result code |
| `<wsHash>-<session>.cli.log` | CLI-side events (session started/reused/stopped, connection retries) |
| `mcp.log` | MCP server console/stderr output (stdout stays reserved for JSON-RPC) |

- Files rotate at 2 MB keeping 2 backups. Command summaries never include argument values (e.g. `fill` passwords).
- `SE_CLI_LOG_LEVEL=debug\|info\|warn\|error` controls verbosity (default `info`).
- `se-cli logs [--tail=N]` prints the tail of the current session's logs.

### Startup Cleanup (issue #115)

Every daemon startup runs a best-effort garbage-collection pass so temporary
files do not accumulate indefinitely (Playwright-style GC — only sessions
whose daemon pid is dead AND older than the retention window are swept):

| What | Retention | Default |
|------|-----------|---------|
| Orphaned `*.session` files (daemon pid dead + older than window) | `SE_CLI_CLEANUP_MAX_AGE_DAYS` | 7 days |
| Rotated log backups (`*.log.1`, `*.log.2`, …) | `SE_CLI_CLEANUP_LOG_MAX_AGE_DAYS` | 7 days |
| Old screenshots in `<project>/.se-cli/` | `SE_CLI_CLEANUP_SCREENSHOT_DAYS` | 0 (disabled) |

Cleanup runs **before** the daemon writes its own session file, so an active
session is never swept. Screenshot cleanup is opt-in — set
`SE_CLI_CLEANUP_SCREENSHOT_DAYS` to enable. Cleanup failures are logged as
warnings and never block daemon startup.

## Usage Examples

### Basic Form Submission

```bash
se-cli open https://example.com/login
se-cli snapshot
# - textbox "Email" [ref=e1]
# - textbox "Password" [ref=e2]
# - button "Sign in" [ref=e3]

se-cli fill e1 "user@example.com"
se-cli fill e2 "password123"
se-cli click e3
se-cli snapshot
se-cli close
```

### Multi-Session (Parallel Browsers)

```bash
se-cli -s=chrome open https://example.com --browser=chrome
se-cli -s=firefox open https://example.com --browser=firefox

se-cli -s=chrome title
se-cli -s=firefox title

se-cli -s=chrome close
se-cli -s=firefox close
```

### Attach to Running Chrome

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Attach
se-cli open --cdp=http://localhost:9222
```

### Scripting with --raw

```bash
# Get title for use in shell scripts
TITLE=$(se-cli --raw title)

# Count elements
COUNT=$(se-cli --raw eval "document.querySelectorAll('.item').length")
echo "Found $COUNT items"
```

### Selenium snippets with run-code (v0.9)

`run-code` executes arbitrary Selenium code inside the daemon process. The snippet
is the body of an async function that receives the live `driver`
(selenium-webdriver), and its return value is serialized: primitives as-is,
returned `WebElement`s as fresh refs (`e100`, `e101`, ...) usable by later commands.

```bash
# Aggregate attributes from multiple elements
se-cli run-code "async driver => {
  const items = await driver.findElements({css: '.item'});
  const names = [];
  for (const item of items) names.push(await item.getAttribute('data-name'));
  return names;
}"
# ["Item A", "Item B", "Item C", ...]

# Returned elements become refs for subsequent commands
REF=$(se-cli --raw run-code "async driver => driver.findElement({css: 'h1'})")
se-cli click "$REF"
```

> **Security**: `run-code` runs with full driver privileges — it can navigate,
> click, read page data, and execute JavaScript. Agents should prefer dedicated
> commands (`click`, `fill`, `snapshot`, ...) whenever possible.

### Locators with generate-locator (v0.9)

`generate-locator` inspects the best locator for a snapshot ref without performing
an action. The recommended locator has match count 1 and the highest stability
(role > id > css > xpath); role locators use the W3C accessibility-attributes
strategy, which the selenium-webdriver JS binding exposes as
`new By('role', { role, name })`. On drivers that reject the role strategy (no
accessibility extension), codegen automatically falls back to a stable CSS
selector with an explanatory note.

```bash
se-cli snapshot
# - button "Save Draft" [ref=e7]

se-cli generate-locator e7
# Recommended: new By('role', { role: 'button', name: 'Save Draft' })
# Alternatives:
#   By.id('save-draft-btn') (1 match)
#   By.css('#save-draft-btn') (1 match)

se-cli generate-locator e7 --all          # all candidates with match counts
se-cli generate-locator e7 --style=id     # force a locator type
se-cli --raw generate-locator e7          # only the recommended expression
se-cli --json generate-locator e7         # structured [{type, locator, matchCount, recommended}]
```

### Role-based code generation (v0.9)

Interaction commands (`click`, `fill`, `check`, `uncheck`, `select`, `hover`,
`dblclick`) now emit role-based locators by default instead of runtime-injected
`data-se-ref` attributes, so the emitted code works against production pages:

```bash
se-cli click e2
# ### Ran Selenium code
# await driver.findElement(new By('role', { role: 'button', name: 'Submit' })).click();

se-cli click e2 --locator-style=ref        # MVP behavior: By.css('[data-se-ref="e2"]')
se-cli click e2 --locator-style=css        # stable CSS selector (#id > tag.class > nth-of-type)
```

When the role locator matches multiple elements, the daemon falls back to a
stable CSS selector and emits a comment explaining the fallback.

### Storage Management

```bash
# Set and verify a cookie
se-cli open https://example.com
se-cli cookie-set session_token abc123
se-cli cookie-get session_token

# Work with localStorage
se-cli localstorage-set theme dark
se-cli localstorage-get theme
se-cli localstorage-list

# Clear all cookies
se-cli cookie-delete
```

### Tab Management

```bash
# Open multiple tabs
se-cli open https://example.com
se-cli tab-new https://example.com/login

# List all tabs
se-cli tab-list

# Switch between tabs
se-cli tab-select 0
se-cli tab-select 1

# Close current tab
se-cli tab-close
```

### State Save & Restore

```bash
# Save browser state (cookies + storage)
se-cli open https://example.com
se-cli cookie-set auth_token secret123
se-cli localstorage-set pref_theme dark
se-cli state-save --filename=session.json

# Later: restore state in a new session
se-cli open
se-cli state-load --filename=session.json
se-cli cookie-get auth_token  # → secret123
```

### Code Generation

Every interaction command outputs the equivalent Selenium code. Since v0.9 the
default is a role-based locator that also works on production pages:

```
$ se-cli click e1

### Ran Selenium code
```js
await driver.findElement(new By('role', { role: 'button', name: 'Save Draft' })).click();
```

To replay the in-session `data-se-ref` style instead, pass `--locator-style=ref`:

```
$ se-cli click e1 --locator-style=ref

### Ran Selenium code
```js
await driver.findElement(By.css('[data-se-ref="e1"]')).click();
```

Copy this directly into your test files.

## AI Agent Integration

### With Claude Code / Cursor / Copilot CLI

Place `skill/SKILL.md` into your agent's skills directory:

```bash
# For Claude Code
mkdir -p .claude/skills/se-cli
cp skill/SKILL.md .claude/skills/se-cli/
```

The agent can then use `se-cli` commands directly:

```
User: "Check that the login page works"
Agent: I'll navigate to the login page and test it.
  $ se-cli open https://app.example.com/login
  $ se-cli snapshot
  $ se-cli fill e1 "test@example.com"
  $ se-cli fill e2 "password"
  $ se-cli click e3
  $ se-cli snapshot
  The login succeeded — I can see the dashboard.
```

### With VS Code MCP Server

se-cli can be used as an MCP (Model Context Protocol) server, allowing VS Code Copilot and other MCP-aware AI tools to use browser automation directly — no shell commands needed.

**Option 1: Workspace `.vscode/mcp.json` (recommended for projects)**

```json
{
  "servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-mcp"]
    }
  }
}
```

> **Tip**: `@browsers-cli/se-mcp` is a thin wrapper that delegates to `@browsers-cli/se-cli mcp-server`.
> You can also use `"args": ["-y", "@browsers-cli/se-cli", "mcp-server"]` directly.

**Option 2: User settings (`settings.json`)**

```json
{
  "mcp.servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-mcp"]
    }
  }
}
```

**Option 3: VS Code Extension (marketplace discovery)**

Install the [se-cli VS Code extension](https://github.com/se-cli/se-extension-vscode) — search `@mcp se-cli`
in VS Code Extensions view (`Ctrl+Shift+X`). The extension auto-registers the MCP server, provides
commands, a webview panel for snapshot/screenshot preview, and a status bar indicator.

Once enabled, all 62 browser automation commands are available as MCP tools:
- `browser_open`, `browser_close`, `browser_navigate`
- `browser_click`, `browser_fill`, `browser_type`, `browser_press`
- `browser_snapshot`, `browser_find`, `browser_screenshot`, `browser_eval`
- `browser_expect` (assertions), `browser_console`, `browser_requests`, `browser_route`
- And more — see `se-cli mcp-server` for the full tool list

```bash
# Start MCP server manually (for debugging)
se-cli mcp-server

# Start MCP server with the Streamable HTTP transport (v0.9)
se-cli mcp-server --http                    # http://127.0.0.1:8931/mcp
se-cli mcp-server --http --port=9000 --host=0.0.0.0
```

The HTTP transport follows the MCP Streamable HTTP spec (`2025-06-18`):
`POST /mcp` for JSON-RPC (JSON or `text/event-stream` responses),
`GET /mcp` for the server-initiated SSE stream, `DELETE /mcp` to terminate
the session and close managed browsers. Sessions are tracked via the
`Mcp-Session-Id` header.

### Skills for AI agents (v0.9)

`se-cli install` copies `skill/SKILL.md` (plus `skill/references/`) into the
skill directories of your AI agent(s). SKILL.md carries spec-compliant
frontmatter (`name`, `description`, `license: Apache-2.0`, `compatibility`).

```bash
# Auto-detect: install into every agent directory present in the project
# (.claude/, .cursor/, .github/copilot/)
se-cli install --skills

# Explicit agents (comma-separated multi-target)
se-cli install --agent=claude,cursor,copilot
# Installed SKILL.md to .claude/skills/se-cli/SKILL.md
# Installed SKILL.md to .cursor/skills/se-cli/SKILL.md
# Installed SKILL.md to .github/copilot/skills/se-cli/SKILL.md

# Custom location (mutually exclusive with --agent)
se-cli install --path=./my-agent/skills/

# Overwrite existing files / list supported agents
se-cli install --force
se-cli install --list-agents
# claude    .claude/skills/se-cli
# cursor    .cursor/skills/se-cli
# copilot   .github/copilot/skills/se-cli
# generic   .agents/skills/se-cli
```

Agent targets: `claude` → `.claude/skills/se-cli/`, `cursor` → `.cursor/skills/se-cli/`,
`copilot` → `.github/copilot/skills/se-cli/`, `generic` → `.agents/skills/se-cli/`,
`custom` → requires `--path=<dir>`.

### Why CLI over MCP for agents?

se-cli supports both modes — CLI for token-critical workflows, MCP for IDE-integrated workflows:

| Aspect | MCP | CLI |
|--------|-----|-----|
| Token cost per call | ~500-1000 (schema) | ~50-100 (command + output) |
| Context pollution | Tool schemas fill context | No schemas in context |
| State persistence | Per-session overhead | Daemon holds state |
| Agent compatibility | MCP-compatible only | Any agent that runs shell |
| IDE integration | Native VS Code / Copilot | Requires terminal access |

## Architecture

```
┌─────────────────┐  Unix socket / Win pipe  ┌──────────────────────┐
│  se-cli         │ ─── line-delimited JSON ─▶ │  se-cli daemon       │
│  (short-lived)  │ ◀── single response ───── │  (holds WebDriver)   │
│  CLI process    │                            └──────────────────────┘
└─────────────────┘                                      │
                                                          │ W3C WebDriver HTTP
                                                          ▼
┌─────────────────┐                               ┌──────────┐
│  MCP Server     │  (same daemon,                │ Browser  │
│  (stdio JSON-   │   long-lived)                 │(Chrome/  │
│   RPC process)  │                               │ Edge/FF) │
└─────────────────┘                               └──────────┘

CLI mode:     se-cli <cmd> → daemon → browser
MCP mode:     AI agent → MCP server (stdio) → daemon → browser
```

- **CLI process**: spawned per command, sends one JSON line, receives one response, exits
- **Daemon process**: spawned on first `open`, persists across CLI calls, holds WebDriver
- **Communication**: line-delimited JSON over Unix socket (Linux/macOS) or Windows named pipe
- **Session registry**: `.session` JSON files in `<cache>/ms-se-cli/daemon/`

### Aria Snapshot & Refs

The `snapshot` command injects a JavaScript script that:
1. Walks the DOM tree following ARIA roles
2. Generates compact YAML representation
3. Assigns `data-se-ref="eN"` attributes to interactive elements
4. Returns YAML for the agent to read

Refs are valid only within the current snapshot. After navigation or DOM changes, run `snapshot` again.

## Development

```bash
# Clone
git clone https://github.com/se-cli/se-cli.git
cd se-cli

# Install
npm install

# Build
npx tsc

# Run unit tests
npm run test:unit

# Run integration tests (auto-detects installed browsers: Edge → Chrome → Firefox)
npm run test:integration

# Serve the integration-test fixture pages locally for manual testing
npm run test-pages:serve          # http://127.0.0.1:8930/forms.html
se-cli open http://127.0.0.1:8930/forms.html

# Mirror fixture pages to the unified site (se-cli/se-site) static/test-pages/
npm run test-pages:sync

# Or explicitly select browsers (same syntax CI uses)
SE_CLI_E2E=1 SE_CLI_TEST_CHROME=1 SE_CLI_TEST_EDGE=1 npx vitest run tests/integration/
```

### Project Structure

```
src/
├── cli.ts                  # CLI entry point
├── program.ts              # Command routing
├── session.ts              # Daemon spawn + RPC client
├── registry.ts             # Session file management
├── output.ts               # Output formatting
├── protocol.ts             # Message types
├── minimist.ts             # Argv parser
├── config.ts               # Paths and hashing
├── response.ts             # Response serialization
├── snapshot/
│   └── aria-snapshot.ts    # Injected JS script
└── daemon/
    ├── server.ts           # Daemon socket server
    ├── backend.ts          # Tool dispatcher
    └── tools/              # Tool handlers (62 tools)
```

## Browser Support

| Browser | Headless | Headed | CDP Attach |
|---------|----------|--------|------------|
| Chrome  | ✅       | ✅     | ✅         |
| Edge    | ✅       | ✅     | ✅         |
| Firefox | ✅       | ✅     | ❌         |

## Comparison with playwright-cli

| Feature | playwright-cli | se-cli |
|---------|---------------|--------------|
| Aria snapshot | Built-in mature | Self-written ~80% coverage |
| Ref engine | Native `aria-ref` selector | `data-se-ref` attribute |
| iframe support | Full | Recursive (same-origin) |
| Shadow DOM | Full | Open shadow roots |
| Test runner attach | Yes (Playwright test) | No (long-term goal) |
| Tracing | Full | Not planned |
| Multi-browser | Chromium only | Chrome + Edge + Firefox |
| Real Safari | No | Possible via Safari driver |

## Roadmap

Based on competitive analysis with Playwright CLI and Selenium WebDriver BiDi.
Features are classified as **Must-Have** (基础底座), **Core** (差异化), or **Marginal** (边际).

**Guiding principles**:

1. Selenium-native strengths (wait/retry/timeout, Grid, custom browsers, real Safari, Edge IE mode) are prioritized as the defensive moat — Playwright will never match these.
2. Playwright-CLI features that are easy to port (auto-wait, retry-assertion, device emulation) are ranked by `complexity × importance` and front-loaded when high value.
3. CLI has no "code writing" — every Selenium capability that requires code (explicit waits, `ExpectedConditions`, Actions chains, `setScriptTimeout`) is exposed via a 4-tier priority: **flag > ENV > config file > built-in default**.
4. Explicit "will never implement" boundary to avoid misplaced community expectations.

- **v0.1** ✅: CLI + Daemon architecture, aria snapshot + ref mechanism, basic commands, multi-browser support
- **v0.2** ✅: Storage management, tab management, state save/load, `install --skills`, `--profile`, `--persistent`
- **v0.3** ✅: iframe recursive snapshot, Shadow DOM recursion, cross-frame `find`
- **v0.4** ✅: Wait & Retry configuration layer — `--timeout`/`--wait`/`--retry`/`--page-load-timeout`/`--script-timeout` flags, `SE_CLI_*` ENV vars, `.se-cli.json` config file, `config get/set/list/init` commands
- **v0.5** ✅: Interaction completion — `hover`, `dblclick`, `drag`, `dialog-accept/dismiss`, `upload`, `resize`, `keydown/keyup`, `mousemove`, `mousedown/mouseup`, `mousewheel`, `actions-chain`
- **v0.6** ✅: Web-First Assertions — `expect <ref> visible|hidden|enabled|disabled|checked|unchecked|text|value|count|attribute`, `expect title|url`, `--not` inversion, `--exact` strict match, `--timeout` polling, CI-friendly exit codes
- **v0.7** ✅: Network & debugging — BiDi `route`/`unroute`/`route-list`, `console`, `requests`/`request`, `highlight` with `--style`/`--hide`/`--all`
- **v0.8** ✅: Device & environment emulation — `open --viewport/--user-agent/--locale/--color-scheme/--timezone/--geolocation/--permissions`, `device`/`device-list` presets (Playwright DeviceDescriptors), `emulate --throttle-network/--throttle-cpu/--offline/--reset`, emulation state in `state-save`
- **v0.9** ✅: MCP Server & AI ecosystem — `se-cli mcp-server` with 62 tools (stdio + Streamable HTTP `--http`), `run-code` for arbitrary Selenium snippets, `generate-locator` + role-based codegen (`--locator-style=role|css|ref`), SKILL.md frontmatter compliance, multi-target `install --skills`, VS Code `.vscode/mcp.json` config, separate [`se-mcp`](https://github.com/se-cli/se-mcp) wrapper package
- **v0.10** (Core, Selenium moat): Remote, Grid & custom browsers — `--browser=safari`, `--endpoint`, `--browser-binary`, `--driver-binary`, `--capabilities`, cloud browser integration, `pdf`, `--browser=edge-ie` for legacy IE scenarios
- **v0.11** (Marginal): Recording & visualization — `record`, `tracing-start/stop`, `video-start/stop`, `show` dashboard, `--annotate`
- **v0.12** (Marginal, initial impl ✅): VSCode extension — [`se-extension-vscode`](https://github.com/se-cli/se-extension-vscode) with MCP registration, commands, webview, status bar. Remaining: Task Provider, `attach --extension`

**Will never implement**: native aria ref engine (staying on `data-se-ref`), Playwright-level full tracing parity, real IE 11 (replaced by Edge IE mode in v0.10).

See [docs/spec.md](docs/spec.md) for the original MVP design specification. The live roadmap and configuration reference live on the [se-cli website](https://se-cli.github.io/se-site/).

## Wait & Retry Configuration (v0.4)

Control element wait conditions, timeouts, and retry behavior:

```bash
# Wait for element to be visible before clicking
se-cli click e1 --wait=visible --timeout=10000

# Retry failed commands
se-cli click e1 --retry=3 --retry-interval=200

# Skip waiting entirely
se-cli click e1 --no-wait

# Configure via environment variables
SE_CLI_TIMEOUT=10000 se-cli click e1

# Config file (.se-cli.json)
se-cli config init     # generate template
se-cli config list     # show all settings
se-cli config set wait.timeout 8000
se-cli config get wait.timeout
```

## License

[Apache License 2.0](LICENSE) - Copyright 2026 se-cli
