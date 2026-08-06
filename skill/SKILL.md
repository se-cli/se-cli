---
name: se-cli
description: Automate browser interactions and test web pages using Selenium.
license: Apache-2.0
compatibility:
  - claude-code
  - cursor
  - copilot-cli
  - generic
allowed-tools: Bash(se-cli:*) Bash(npx:*)
---

# Browser Automation with se-cli

## Quick start

```bash
se-cli open
se-cli goto https://example.com
se-cli snapshot
se-cli click e3
se-cli expect e3 visible
se-cli close
```

## Commands

### Core
```bash
se-cli open [url]
se-cli goto <url>
se-cli close
se-cli snapshot [ref] [--depth=N]
se-cli find <text>
se-cli find --regex <pattern>
se-cli click <ref|selector>
se-cli fill <ref|selector> <text>
se-cli type <text>
se-cli press <key>
se-cli select <ref> <value>
se-cli check <ref>
se-cli uncheck <ref>
se-cli screenshot [ref] [--filename=f]
se-cli eval "<js>" [ref]
se-cli run-code "<snippet>"   # arbitrary Selenium code; receives `driver`
se-cli generate-locator <ref>  # recommended locator for a ref (role-based by default)
se-cli title
se-cli url
```

### Navigation
```bash
se-cli go-back
se-cli go-forward
se-cli reload
```

### Advanced Interaction (v0.5)

Mouse and keyboard control via the Selenium Actions API. All commands consume
the v0.4 wait/retry configuration and emit the equivalent Selenium code.

```bash
# Mouse actions
se-cli hover <ref>                    # Mouse hover over element
se-cli dblclick <ref>                 # Double-click element
se-cli drag <start-ref> <end-ref>     # Drag and drop from one element to another
se-cli mousemove <x> <y>             # Move mouse to absolute viewport coordinates
se-cli mousedown [button]            # Press mouse button (left|right|middle, default: left)
se-cli mouseup [button]              # Release mouse button (left|right|middle, default: left)
se-cli mousewheel <dx> <dy>          # Scroll wheel by horizontal/vertical offsets

# Keyboard actions
se-cli keydown <key>                 # Press and hold a key (e.g. Shift, Control)
se-cli keyup <key>                   # Release a held key

# Dialog handling
se-cli dialog-accept [text]          # Accept alert/confirm/prompt; optional text for prompt
se-cli dialog-dismiss                # Dismiss alert/confirm/prompt

# File upload
se-cli upload <ref> <file>           # Send file path to <input type="file"> element

# Viewport control
se-cli resize <width> <height>       # Set browser window size in pixels

# Actions chain — combine multiple actions into one perform() call
se-cli actions-chain <json-array>
```

#### actions-chain

The `actions-chain` command accepts a JSON array of action steps executed in a
single `perform()` call, reducing daemon round-trips. Supported step types:
`move`, `press`, `release`, `keydown`, `keyup`, `click`, `doubleClick`,
`scroll`, `pause`.

```bash
# Drag via manual move + press + release
se-cli actions-chain '[{"type":"move","target":"e1"},{"type":"press"},{"type":"move","x":200,"y":200},{"type":"release"}]'

# Key chord: Ctrl+Shift+A
se-cli actions-chain '[{"type":"keydown","key":"Control"},{"type":"keydown","key":"Shift"},{"type":"keydown","key":"a"},{"type":"keyup","key":"a"},{"type":"keyup","key":"Shift"},{"type":"keyup","key":"Control"}]'

# Click + pause + scroll
se-cli actions-chain '[{"type":"click","target":"e2"},{"type":"pause","duration":500},{"type":"scroll","x":0,"y":300}]'
```

### Web-First Assertions (v0.6)

Playwright-style retry-until-timeout assertions with CI-friendly exit codes
(0 = pass, 1 = fail).

```bash
# Visibility assertions
se-cli expect <ref> visible          # Assert element is visible
se-cli expect <ref> hidden           # Assert element is hidden

# State assertions
se-cli expect <ref> enabled           # Assert element is enabled
se-cli expect <ref> disabled          # Assert element is disabled
se-cli expect <ref> checked           # Assert checkbox is checked
se-cli expect <ref> unchecked         # Assert checkbox is unchecked

# Content assertions
se-cli expect <ref> text "Expected"       # Assert text contains (substring)
se-cli expect <ref> text "Exact" --exact  # Assert exact text match
se-cli expect <ref> value "Expected"       # Assert input value contains
se-cli expect <ref> attribute href "https://example.com"  # Assert attribute

# Count assertion
se-cli expect <selector> count 3    # Assert N matching elements

# Page-level assertions
se-cli expect title "My Page"       # Assert page title
se-cli expect url "example.com"     # Assert URL contains

# Inversion with --not
se-cli expect <ref> visible --not   # Assert element is NOT visible
se-cli expect <ref> text "error" --not  # Assert text does NOT contain "error"

# Timeout for async assertions (default 5000ms)
se-cli expect <ref> visible --timeout=10000  # Wait up to 10s for element to appear
```

Assertion failures exit with code 1 (CI-friendly). Assertion success exits with
code 0.

Assertions poll the condition until it passes or the timeout expires (default
5s). Use `--timeout=0` or `--no-wait` for a single check without polling.

### Network & Debugging (v0.7)

Console capture, network monitoring, route mocking, and element highlighting
via Selenium BiDi protocol.

```bash
# Element highlighting
se-cli highlight e1              # Outline element (default: 3px solid red)
se-cli highlight e1 --style="2px solid blue"  # Custom style
se-cli highlight                 # List active highlights
se-cli highlight e1 --hide       # Remove single highlight
se-cli highlight --hide --all    # Remove all highlights

# Console capture
se-cli console                   # All buffered messages
se-cli console error             # Error-level only
se-cli console js-error          # JS exceptions only
se-cli console --since=5m        # Messages from last 5 minutes
se-cli console --clear           # Clear buffer after output

# Network request monitoring
se-cli requests                  # List all network requests
se-cli requests --filter="api"   # Filter by URL substring
se-cli requests --status=500     # Filter by status code
se-cli requests --method=POST    # Filter by HTTP method
se-cli requests --clear          # Clear request buffer
se-cli request 0                 # Show details of request #0

# Route mocking
se-cli route "**/api/**" --status=401 --body='{"error":"invalid"}'
se-cli route-list                # List active routes
se-cli unroute 0                 # Remove route by index
se-cli unroute --all             # Remove all routes
```

### Storage
```bash
se-cli cookie-list
se-cli cookie-get <name>
se-cli cookie-set <name> <value>
se-cli cookie-delete [name]
se-cli localstorage-get <key>
se-cli localstorage-set <key> <value>
se-cli localstorage-delete [key]
se-cli localstorage-list
se-cli sessionstorage-get <key>
se-cli sessionstorage-set <key> <value>
se-cli sessionstorage-delete [key]
se-cli sessionstorage-list
```

### Tabs
```bash
se-cli tab-list
se-cli tab-new [url]
se-cli tab-close
se-cli tab-select <index>
```

### State
```bash
se-cli state-save [--filename=f.json]
se-cli state-load [--filename=f.json]
```

### Configuration
```bash
se-cli config get <key>
se-cli config set <key> <value>
se-cli config list
se-cli config init
```

### Flags
```bash
se-cli --raw <cmd>              # Output only the value
se-cli --json <cmd>             # Structured JSON output
se-cli -s=<name> <cmd>          # Use named session
se-cli click e1 --timeout=10000      # Per-command explicit-wait timeout
se-cli click e1 --wait=visible        # Wait condition: visible|hidden|enabled|disabled|stable|attached|none|auto
se-cli click e1 --retry=3             # Retry count (-1 = until timeout)
se-cli click e1 --retry-interval=200  # Polling interval
se-cli click e1 --implicit-wait=1000 # Driver implicit wait
se-cli click e1 --page-load-timeout=30000
se-cli eval "js" --script-timeout=30000
se-cli click e1 --no-wait             # Skip waiting (--wait=none --timeout=0)
```

### Advanced: arbitrary Selenium code (v0.9)
```bash
# run-code executes a Selenium snippet inside the daemon. The snippet is the
# body of an async function receiving the live `driver` (selenium-webdriver).
# Prefer dedicated commands (click/fill/snapshot/...) whenever possible —
# run-code runs with FULL driver privileges (navigation, clicks, JS execution).
se-cli run-code "async driver => { return await driver.getTitle(); }"

# Returned elements become refs for subsequent commands:
REF=$(se-cli --raw run-code "async driver => driver.findElement({css: 'h1'})")
se-cli click "$REF"

### Advanced: locator inspection & role-based codegen (v0.9)
```bash
# generate-locator reports the recommended locator for a ref (match count 1,
# stability role > id > css > xpath). Role locators use the W3C accessibility
# strategy: new By('role', { role, name }) — works in Chrome/Edge/Firefox; on
# drivers that reject the role strategy, codegen falls back to CSS.
se-cli generate-locator e7
se-cli generate-locator e7 --all          # all candidates with match counts
se-cli generate-locator e7 --style=id     # force a locator type
se-cli --raw generate-locator e7          # only the recommended expression

# Interaction commands emit role-based code by default (works on production
# pages); --locator-style=ref keeps the in-session data-se-ref style.
se-cli click e2                            # await driver.findElement(new By('role', ...))
se-cli click e2 --locator-style=ref        # By.css('[data-se-ref="e2"]')
se-cli click e2 --locator-style=css        # stable CSS selector
```

### Sessions
```bash
se-cli -s=<name> <cmd>
se-cli open --idle-timeout=10    # Auto-close idle daemon after 10 min (0 = never)
se-cli sessions                  # All sessions across all projects (live/dead)
se-cli list
se-cli close                     # Close current session
se-cli close --all               # Close every session across all projects
se-cli close-all
```

### Logs
The daemon runs detached, so diagnostics go to file logs:
`%LOCALAPPDATA%\ms-se-cli\daemon\logs\` (Windows) or `~/.cache/ms-se-cli/daemon/logs/`.

```bash
se-cli logs                      # Tail current session's daemon + CLI logs (50 lines)
se-cli logs --tail=200           # More lines
SE_CLI_LOG_LEVEL=debug se-cli ...  # Raise verbosity (debug|info|warn|error, default info)
```

Log files rotate at 2 MB (2 backups). Command summaries record tool name, duration, and result code — never argument values (e.g. `fill` passwords).

### Startup Cleanup (issue #115)
Each daemon startup garbage-collects stale temporary files (best-effort, never blocks startup):
- Orphaned session files from crashed daemons (pid dead + older than 7 days, `SE_CLI_CLEANUP_MAX_AGE_DAYS`)
- Old rotated log backups (7 days, `SE_CLI_CLEANUP_LOG_MAX_AGE_DAYS`)
- Opt-in old screenshots in `<project>/.se-cli/` (disabled by default; enable with `SE_CLI_CLEANUP_SCREENSHOT_DAYS`)

## Snapshots

After each command, se-cli provides an aria snapshot of the page.
Each interactive element has a `[ref=eN]` attribute. Use the ref to interact:
```bash
se-cli snapshot
# Output: - link "Home" [ref=e1]
se-cli click e1
```

Refs are valid only until the page changes. Re-run `snapshot` after navigation or DOM updates.

### iframe Elements

The snapshot recurses into same-origin iframes. Elements inside an iframe get cross-frame refs in the format `f<index>e<ref>`:
```bash
se-cli snapshot
# Output:
# - iframe "Content":
#   - textbox "Name" [ref=f0e1]
#   - button "Submit" [ref=f0e2]

se-cli fill f0e1 "hello"
se-cli click f0e2
```

Cross-origin iframes appear as placeholders and cannot be interacted with.

### Shadow DOM

The snapshot traverses open shadow roots. Elements inside shadow DOM use regular refs (`e1`, `e2`) — se-cli automatically searches shadow roots when resolving refs:
```bash
se-cli snapshot
# Output:
# - textbox "Shadow Input" [ref=e5]
# - button "Shadow Button" [ref=e6]

se-cli fill e5 "test"
se-cli click e6
```

## Example: Form submission

```bash
se-cli open https://example.com/login
se-cli snapshot
se-cli fill e1 "user@example.com"
se-cli fill e2 "password"
se-cli click e3
se-cli snapshot
se-cli close
```

## Example: Save and restore state

```bash
se-cli open https://example.com
se-cli cookie-set auth_token secret123
se-cli localstorage-set theme dark
se-cli state-save --filename=session.json
se-cli close

# Later: restore in a new session
se-cli open
se-cli state-load --filename=session.json
se-cli cookie-get auth_token
```

## Example: Advanced interactions (v0.5)

```bash
# Hover over a menu item to reveal a submenu
se-cli open https://example.com
se-cli snapshot
se-cli hover e3
se-cli snapshot

# Double-click to select a word
se-cli dblclick e5

# Drag an element to a new position
se-cli drag e1 e2

# Handle a JavaScript confirm dialog
se-cli click e4          # triggers window.confirm()
se-cli dialog-accept

# Upload a file
se-cli upload e1 /path/to/document.pdf

# Resize viewport for responsive testing
se-cli resize 375 812    # iPhone 13 viewport

# Fine-grained mouse control
se-cli mousemove 100 200
se-cli mousedown left
se-cli mousemove 300 400
se-cli mouseup left

# Scroll down 500px
se-cli mousewheel 0 500

# Hold Shift and press a key
se-cli keydown Shift
se-cli press a
se-cli keyup Shift

# Chain multiple actions into one round-trip
se-cli actions-chain '[{"type":"move","target":"e1"},{"type":"press"},{"type":"move","x":200,"y":200},{"type":"release"}]'
```

## Wait & Retry Configuration (v0.4)

Control element wait conditions, timeouts, and retry behavior. Configuration is resolved
via a 4-tier priority: **flag > ENV > config file > built-in default**.

```bash
# Wait for element to be visible before clicking
se-cli click e1 --wait=visible --timeout=10000

# Retry failed commands
se-cli click e1 --retry=3 --retry-interval=200

# Skip waiting entirely (precise-timing scenarios)
se-cli click e1 --no-wait

# Configure via environment variables
SE_CLI_TIMEOUT=10000 se-cli click e1
SE_CLI_WAIT=visible se-cli click e1
SE_CLI_RETRY=3 se-cli click e1

# Config file (.se-cli.json or ~/.config/se-cli/config.json)
se-cli config init     # generate template config file
se-cli config list     # show all settings with source per item
se-cli config set wait.timeout 8000
se-cli config get wait.timeout
```

By default, interactive commands (click, fill, check, uncheck, select) wait for elements
to be visible, while read-only commands (snapshot, eval, title) skip waiting. The emitted
Selenium code reflects the effective strategy:

```js
await driver.wait(until.elementIsVisible(el), 5000);
await driver.wait(until.elementIsEnabled(el), 5000);
```

## Emulation (v0.8)

Emulate device and environment characteristics at session open. Chrome/Edge support
everything via CDP; Firefox supports viewport only.

```bash
# Open with a custom viewport (all browsers)
se-cli open https://example.com --viewport=390x844

# Emulate a mobile device environment (Chrome/Edge)
se-cli open https://example.com --user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" --viewport=390x844 --color-scheme=dark

# Emulate locale, timezone, geolocation (Chrome/Edge)
se-cli open https://example.com --locale=zh-CN --timezone=Asia/Shanghai --geolocation=39.9,116.4 --permissions=geolocation

# Device presets (Playwright DeviceDescriptors subset)
se-cli device-list                # list presets
se-cli device "iPhone 13"         # apply preset (viewport + UA + scale + touch)
se-cli device                     # show current emulation state

# Runtime network/CPU emulation (Chrome/Edge)
se-cli emulate --offline                     # go offline
se-cli emulate --throttle-network=slow3g     # slow3g | fast3g | gprs | custom:download=,upload=,latency=
se-cli emulate --throttle-cpu=4              # CPU slowdown 4x
se-cli emulate --reset                       # restore runtime emulation (keeps open flags)

# After opening, emulation state is replayed automatically if the driver rebuilds.
```

## MCP Server Mode

se-cli can run as an MCP (Model Context Protocol) server, exposing all browser automation
commands as MCP tools for VS Code Copilot and other MCP-aware AI agents.

### Quick Setup

**Workspace config (`.vscode/mcp.json`):**

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

> `@browsers-cli/se-mcp` is a thin wrapper that delegates to `@browsers-cli/se-cli mcp-server`.
> You can also use `"args": ["-y", "@browsers-cli/se-cli", "mcp-server"]` directly.
> A VS Code extension ([`se-extension-vscode`](https://github.com/se-cli/se-extension-vscode)) is also available
> for marketplace discovery, commands, and webview preview.

**Or start manually for debugging (v0.9: stdio or Streamable HTTP):**

```bash
se-cli mcp-server                    # stdio (VS Code / desktop agents)
se-cli mcp-server --http             # Streamable HTTP on http://127.0.0.1:8931/mcp
se-cli mcp-server --http --port=9000 --host=0.0.0.0
```

HTTP endpoints: `POST /mcp` (JSON-RPC; JSON or SSE response), `GET /mcp`
(SSE keep-alive stream), `DELETE /mcp` (close sessions). Session tracking
via the `Mcp-Session-Id` header.

### Available MCP Tools

All 62 CLI commands are exposed as MCP tools with `browser_` prefix:

- `browser_open` / `browser_close` / `browser_list_sessions`
- `browser_navigate` / `browser_go_back` / `browser_go_forward` / `browser_reload`
- `browser_click` / `browser_fill` / `browser_type` / `browser_press`
- `browser_snapshot` / `browser_find` / `browser_screenshot` / `browser_eval`
- `browser_expect` (assertions) / `browser_highlight` / `browser_console`
- `browser_requests` / `browser_route` / `browser_unroute`
- `browser_cookie_*` / `browser_*storage_*` / `browser_tab_*` / `browser_state_*`

Each tool accepts a `session` parameter for named session isolation.
