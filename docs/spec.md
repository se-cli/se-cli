# se-cli Design Specification

**Version**: v0.1.0 (MVP)
**Date**: 2026-07-28
**Status**: Brainstorming complete, pending implementation

## 1. Background & Goals

### 1.1 Background

Current Selenium MCP implementations consume too many tokens, mainly because:
- Tool schemas are large and loaded on every call
- Accessibility tree returns full page data
- No command-line interface; agents must interact via the MCP protocol

Microsoft's playwright-cli has proven that the "short-lived CLI + long-lived daemon + aria snapshot + ref reference" architecture effectively saves tokens. This project ports that approach to the Selenium ecosystem.

### 1.2 Goals

Build a `se-cli` command-line tool that provides:
- Short-lived CLI process + long-lived daemon process architecture; the daemon holds the WebDriver instance and keeps it alive across calls
- Named session management for parallel multi-browser isolation
- Aria snapshot + ref reference mechanism for token-efficient element location
- Code generation replay: each action emits the corresponding Selenium code
- General AI agent friendly (not bound to a specific agent; SKILL.md can be placed manually)

## 2. Project Structure

```
d:\code\opensource\se-cli\
├── src/
│   ├── cli.ts                  # Entry point (compiled to dist/cli.js)
│   ├── program.ts              # Command dispatch, argument parsing
│   ├── session.ts              # Daemon startup + socket RPC client
│   ├── registry.ts             # .session file registry
│   ├── output.ts               # TextOutput / JsonOutput / RawOutput
│   ├── protocol.ts             # Message type definitions
│   ├── config.ts               # Default configuration
│   ├── daemon/
│   │   ├── server.ts           # Daemon socket server
│   │   ├── backend.ts          # Tool dispatch (callTool)
│   │   └── tools/
│   │       ├── open.ts
│   │       ├── snapshot.ts
│   │       ├── click.ts
│   │       └── ...
│   └── snapshot/
│       └── aria-snapshot.ts    # Injected script
├── skill/
│   ├── SKILL.md
│   └── references/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

### Key Dependencies

- `selenium-webdriver`: official Node bindings
- `selenium-manager`: driver binary management (bundled with selenium-webdriver)
- TypeScript + Vitest

### Configuration Directories

- Registry: `<system cache>/ms-se-cli/daemon/<workspaceHash>/<name>.session`
- Output directory: `.se-cli/` (snapshot files, screenshots)

## 3. Command Set (MVP)

### 3.1 Session-level Commands (handled in the CLI process)

```bash
se-cli open [url]              # Start daemon + browser
se-cli close                   # Close browser + daemon
se-cli close --all             # Close every session across ALL workspaces
se-cli sessions                # List all sessions across all projects (live/dead)
se-cli list                    # List all sessions
se-cli close-all               # Close all sessions
se-cli kill-all                # Force-kill all processes
se-cli logs [--tail=N]         # Tail this session's daemon + CLI logs (default 50)
se-cli mcp-server [--http]     # Start MCP server (stdio default; Streamable HTTP with --http) (v0.9)
se-cli install --skills        # Install SKILL.md into agent skill directories (v0.2/v0.9 multi-target)
se-cli install-browser [name]  # Install/verify the driver for chrome|edge|firefox via Selenium Manager (spec §6.1)
se-cli -s=<name> <cmd>         # Named session
```

**Idle timeout**: daemons auto-close after 30 min without activity (configurable via
`--idle-timeout=<min>` or `SE_CLI_IDLE_TIMEOUT`; `0` disables it). The saved
`idleTimeout` in the session file is restored when the daemon restarts.

**Logging**: the daemon runs detached (its stdio is unref'd), so all diagnostics
land in `baseDaemonDir()/logs/`:
- `<wsHash>-<session>.daemon.log` — daemon lifecycle, driver builds/resets, per-command duration + result code
- `<wsHash>-<session>.cli.log` — CLI-side session events
- `mcp.log` — MCP server console/stderr (stdout stays reserved for JSON-RPC)

Files rotate at 2 MB (2 backups). `SE_CLI_LOG_LEVEL=debug|info|warn|error`
(default `info`) controls verbosity. Command summaries never include argument
values (e.g. `fill` passwords).

### 3.2 Tool Commands (forwarded to the daemon)

**Navigation**: `goto <url>` / `go-back` / `go-forward` / `reload`

**Interaction**: `click <ref|selector>` / `fill <ref|selector> <text>` / `type <text>` / `press <key>` / `select <ref> <value>` / `check <ref>` / `uncheck <ref>`

**Advanced interaction (v0.5)**: `hover <ref>` / `dblclick <ref>` / `drag <start> <end>` / `dialog-accept [text]` / `dialog-dismiss` / `upload <ref> <file>` / `resize <w> <h>` / `keydown <key>` / `keyup <key>` / `mousemove <x> <y>` / `mousedown [button]` / `mouseup [button]` / `mousewheel <dx> <dy>` / `actions-chain <json>`

**Snapshot & Search**: `snapshot` / `snapshot <ref>` / `snapshot --depth=N` / `snapshot --filename=f` / `find <text>` / `find --regex <pattern>`

**Save & Execute**: `screenshot [ref]` / `screenshot --filename=f` / `eval "<js>"` / `eval "<js>" <ref>` / `run-code "<snippet>"` (v0.9) / `generate-locator <ref>` (v0.9) / `title` / `url`

**Assertions (v0.6)**: `expect <ref|sel> visible|hidden|enabled|disabled|checked|unchecked` / `expect <ref> text|value|count|attribute ...` / `expect title|url "..."` / `--not` / `--exact`

**Network & Debug (v0.7)**: `route <pattern> --status=...` / `route-list` / `unroute <index>|--all` / `console [level] [--since=] [--clear]` / `requests [--filter=] [--status=] [--method=] [--clear]` / `request <index>` / `highlight [ref] [--style=] [--hide] [--all]`

**Emulation (v0.8)**: `device <name>` / `device-list` / `emulate [--offline] [--throttle-network=...] [--throttle-cpu=...] [--reset]` / `open --viewport= --user-agent= --locale= --color-scheme= --timezone= --geolocation= --permissions=`

**Storage (v0.2)**: `cookie-list|get|set <name> <value>|delete [name]` / `localstorage-get|set|delete|list` / `sessionstorage-get|set|delete|list` / `state-save [--filename=f]` / `state-load [--filename=f]`

**Tabs (v0.2)**: `tab-list` / `tab-new [url]` / `tab-close` / `tab-select <index>`

**Config (v0.4)**: `config get <key>` / `config set <key> <value>` / `config list` / `config init`

40+ commands in total (v0.1 through v0.9).

### 3.3 Global Flags

```bash
se-cli --raw <cmd>             # Output only the value
se-cli --json <cmd>            # Structured JSON output
se-cli -s=<name> <cmd>         # Specify session
se-cli open --browser=chrome   # chrome | edge | firefox (default: auto-detect Edge → Chrome → Firefox)
se-cli open --headed           # Default is headless
se-cli open --cdp=<url>        # Attach to a running Chrome
```

## 4. Process Architecture & Communication Protocol

### 4.1 Process Model

```
┌─────────────────┐  Unix socket / Win named pipe      ┌──────────────────────┐
│  se-cli   │ ───────── line-delimited JSON ───▶ │  se-cli daemon │
│  (short-lived   │ ◀──────── single response, close ── │  (holds WebDriver)   │
│   Node process) │                                    └──────────────────────┘
        │                                                          │
        │ spawn(detached:true) on first open ────────────────────▶│
        │                                                          │ W3C WebDriver HTTP
        │                                                          │ ─────────────────▶ ChromeDriver
        │                                                          │                          │
        │                                                          │                          ▼
        │                                                          │                       Browser
        ▼                                                          ▼
┌─────────────────┐                                       ┌──────────────────────┐
│  .session file  │                                       │  aria snapshot inject │
└─────────────────┘                                       └──────────────────────┘
```

### 4.2 Socket Path

- **Linux/macOS**: `$TMPDIR/se-cli/<userHash>/<workspaceHash>-<sessionName>.sock`
- **Windows**: `\\.\pipe\se-cli-<userHash>-<workspaceHash>-<sessionName>`
- `userHash = sha1(USERNAME||USER||"default").slice(0,8)`
- `workspaceHash = sha1(workspaceDir).slice(0,16)`

### 4.3 Message Protocol (line-delimited JSON)

**CLI → daemon**:
```typescript
interface ClientMessage {
  method: 'run' | 'stop' | 'ping';
  params: {
    args: string[];
    cwd: string;
    raw?: boolean;
    json?: boolean;
  };
}
```

**daemon → CLI**:
```typescript
interface ServerMessage {
  ok: boolean;
  text?: string;
  raw?: string;
  json?: SerializedResponse;
  error?: string;
  code?: string;  // ELEMENT_NOT_FOUND | DAEMON_DEAD | VERSION_MISMATCH
}
```

The CLI connects, sends one message, receives one response, then immediately closes the connection. On the daemon side, `net.createServer` handles one request per connection.

### 4.4 Daemon Startup Handshake

1. CLI runs `spawn(process.execPath, [dist/daemon/server.js, sessionName, socketPath, ...flags], { detached: true, stdio: ['ignore','pipe','pipe'] })`
2. Listens on daemon stdout, waits for the line `"Daemon listening on <socketPath>"`
3. Calls `child.unref()` to detach the daemon from the parent process
4. Daemon writes the `<name>.session` JSON file to disk

### 4.5 Response Serialization

Default output has 4 sections:
```
### Page
- Page URL: https://example.com/
- Page Title: Example Domain

### Snapshot
- e1 [heading "Welcome"]
- e2 [link "Learn more"]

### Ran Selenium code
await driver.findElement(By.css('[data-se-ref="e2"]')).click();

### Result
clicked
```

- `--raw` mode outputs only the Result value
- `--json` outputs a `{page, snapshot, code, result}` object

## 5. Aria Snapshot Injection Script (Core Challenge)

### 5.1 Algorithm Overview

Inject JS into the page, recursively walk the DOM, generate a simplified accessibility tree YAML per the W3C ARIA spec, and assign `data-se-ref="eN"` attributes to interactive elements.

### 5.2 Output Format

```yaml
- document:
  - heading "Welcome to Example" [level=1]
  - link "Learn more" [ref=e1]
  - textbox "Search" [ref=e2]
  - button "Submit" [ref=e3]
  - navigation:
    - link "Home" [ref=e4]
```

### 5.3 Role Determination Priority

```
a. Explicit role attribute: <div role="button">
b. ARIA implicit role: <button>→button, <a>→link, <input type=checkbox>→checkbox...
c. Fall back to tagName when no role: <nav>→navigation, <main>→main, <header>→banner
```

### 5.4 Interactive Element Detection (assign ref)

```javascript
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea',
  'summary', 'details', 'option', 'optgroup'
]);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'combobox',
  'option', 'searchbox', 'spinbutton', 'slider', 'switch'
]);
```

### 5.5 Text & Label Extraction Priority

`aria-label > aria-labelledby > <label for> > alt/title > textContent > placeholder`

Text is truncated to 80 characters to prevent token bloat.

### 5.6 Ref Resolution

```typescript
async function resolveTarget(driver: WebDriver, target: string) {
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return By.css(`[data-se-ref="${target}"]`);
  }
  return By.css(target);
}
```

### 5.7 Key Constraints

1. **Refs are valid only within a single snapshot**: after DOM rebuild, `data-se-ref` is lost; you must snapshot again
2. **iframe handling (MVP simplification)**: do not recurse into iframes; output `- iframe: <url>` placeholder
3. **Shadow DOM (MVP simplification)**: do not recurse into open shadow roots; output placeholder
4. **Token control**: long text truncated to 80 chars; `--depth=N` limits depth (default 50); `find` command greps instead of dumping everything
5. **Performance**: `getComputedStyle` is called only for suspected hidden elements

### 5.8 Code Generation Replay

Each interaction tool hard-codes `response.addCode(...)` when executing the action:
```typescript
response.addCode(`await driver.findElement(By.css('[data-se-ref="e15"]')).click();`);
```

### 5.9 Acknowledged Gap vs playwright-cli

| Aspect | playwright-cli | se-cli MVP |
|------|---------------|-----------------|
| Aria algorithm | Built-in mature implementation | Self-written simplified version, ~70-80% coverage |
| Ref engine | Built-in `aria-ref` selector engine | `data-se-ref` attribute + CSS selector |
| Snapshot stability | High | Medium (needs iteration on real sites) |
| iframe/shadow | Full support | MVP placeholder |

## 6. Error Handling

### 6.1 Error Classification

| Error Type | Example | Handling |
|---------|------|------|
| Startup failure | driver binary not installed, port in use | daemon exits immediately, CLI suggests `se-cli install-browser` (verifies/installs the driver via Selenium Manager) |
| Communication failure | socket connect timeout, daemon crash | CLI cleans up orphan `.session` files, suggests `open` |
| WebDriver error | NoSuchElementError, TimeoutError, StaleElementReferenceError | Returns `{ok:false, error, code}`, CLI shows friendly message |
| Injection script error | CSP blocks, Shadow DOM boundary | Returns partial snapshot + warning |
| Version mismatch | CLI 0.2 calling daemon 0.1 | `Session.startDaemon()` compares the daemon's saved version (from the `.session` file) with the CLI's own version on reuse; a mismatch emits a warning suggesting `close && open`. The `VERSION_MISMATCH` response code is defined in the protocol and rendered with the same hint |

### 6.2 Error Output Format

```
### Error
Element not found: [data-se-ref="e15"]
Hint: run `se-cli snapshot` to refresh refs.
```

### 6.3 Daemon Robustness

- `selfDestructOnIdle`: self-destruct after 30 minutes with no requests (configurable)
- `heartbeat`: driver periodically calls `getTitle()` for liveness check
- `gracefulShutdown`: SIGTERM/SIGINT → quit driver → delete `.session` → exit

## 7. Test Strategy & Implementation Path

### 7.1 Test Pyramid

- **Unit tests (Vitest)**: parseCommand, aria snapshot script, Response serialization, registry
- **Integration tests**: daemon + real driver + test pages
- **E2E tests**: use se-cli to test itself (dogfooding)

### 7.2 Implementation Path (6 steps)

**Step 1: Skeleton & Protocol** — project scaffold, protocol.ts, daemon/server.ts, session.ts, registry.ts, cli.ts. Verify: `open` starts the daemon, `list` shows the session, `close` cleans up.

**Step 2: Command Dispatch & Minimal Command Set** — program.ts, output.ts, backend.ts, commands `goto/title/url/close`. Verify: `open https://example.com && title` outputs "Example Domain".

**Step 3: Aria Snapshot Injection Script** — snapshot/aria-snapshot.ts, daemon/tools/snapshot.ts, find.ts. Verify: snapshot on todomvc, YAML contains `- textbox` `- button`.

**Step 4: Interaction Commands** — click/fill/type/press/select/check/uncheck + resolveTarget + code generation replay. Verify: todomvc full flow add todo → check → clear.

**Step 5: Save & Execute** — screenshot, eval, go-back/forward/reload. Verify: screenshot generates a PNG, eval returns the correct value.

**Step 6: Session Management Polish** — `-s=<name>`, list, close-all, kill-all, --browser, --headed, --cdp. Verify: parallel multi-session, CDP attach.

### 7.3 Acceptance Criteria

```bash
se-cli open https://demo.playwright.dev/todomvc/
se-cli snapshot
# Output contains - textbox [ref=e1] - button "Add" [ref=e2]

se-cli fill e1 "Buy groceries"
se-cli click e2
se-cli snapshot
# Output contains - listitem "Buy groceries" [ref=e3]

se-cli --raw eval "document.querySelectorAll('.todo-list li').length"
# Output: 1

se-cli screenshot --filename=todo.png
se-cli close
```

Each interaction command outputs the corresponding Selenium code:
```
### Ran Selenium code
await driver.findElement(By.css('[data-se-ref="e2"]')).click();
```

## 8. Roadmap (v0.4+)

Based on competitive analysis with Playwright CLI and Selenium WebDriver BiDi.
Features are classified as **Must-Have** (基础底座), **Core** (差异化), or **Marginal** (边际).

**Guiding principles (revised 2026-07-29)**:
1. Selenium-native strengths (wait/retry/timeout, Grid, custom browsers, real Safari, Edge IE mode) are prioritized as the defensive moat — Playwright will never match these.
2. Playwright-CLI features that are easy to port (auto-wait, retry-assertion, device emulation) are ranked by `complexity × importance` and front-loaded when high value.
3. CLI has no "code writing" — every Selenium capability that requires code (explicit waits, `ExpectedConditions`, Actions chains, `setScriptTimeout`) MUST be exposed via a 4-tier priority: **flag > ENV > config file > built-in default**.
4. Explicit "will never implement" boundary to avoid misplaced community expectations.

### v0.1: MVP Architecture ✅

- [x] CLI + Daemon process architecture (short-lived CLI via socket to long-lived daemon)
- [x] Basic commands: open, close, goto, click, fill, type, press, snapshot, screenshot, eval
- [x] Aria snapshot injection + ref reference mechanism
- [x] Named session management, multi-browser support (Chrome/Edge/Firefox)
- [x] Code generation replay

### v0.2: Practical Capability Completion ✅

- [x] **Storage management**: `cookie-list/get/set/delete`, `localstorage-*`, `sessionstorage-*`
- [x] **State save/load**: export cookies + storage to JSON, restore by loading in reverse
- [x] **Tab management**: `tab-list`, `tab-new`, `tab-close`, `tab-select`
- [x] **install --skills**: copy SKILL.md to `.claude/skills/se-cli/` or `.agents/skills/se-cli/`
- [x] **--profile=<path>**: persistent user data directory
- [x] **--persistent**: auto-assign userDataDir

### v0.3: iframe & Shadow DOM ✅

- [x] **iframe recursive snapshot**: cross-frame refs (e.g. `f3e15`)
- [x] **Shadow DOM recursion**: recursively traverse `el.shadowRoot` for open shadow roots
- [x] **find command enhancement**: support cross-frame and shadow DOM search

### v0.4: Wait & Retry Configuration Layer ✅

All subsequent commands depend on this layer. Surfaces Selenium's implicit/explicit wait,
pageLoad/script timeout, and `ExpectedConditions` as CLI-native configuration.

**Configuration priority (4 tiers, high → low)**: `--flag` > `ENV` > `.se-cli.json` > built-in default

**Flag layer (per-command override)**:
- `--timeout=<ms>` — per-command explicit-wait timeout (default 5000)
- `--wait=<state>` — wait condition: `visible|hidden|enabled|disabled|stable|attached|none|auto` (default `auto`: click/fill → `visible+enabled`, snapshot/eval → `none`)
- `--retry=<n>` — failure retry count (default 0; `-1` = until timeout)
- `--retry-interval=<ms>` — polling interval (default 100)
- `--implicit-wait=<ms>` — driver implicit wait (default 0, discouraged but compatible)
- `--page-load-timeout=<ms>` — `driver.manage().timeouts().pageLoadTimeout()`
- `--script-timeout=<ms>` — `setScriptTimeout` (affects async `eval`)
- `--no-wait` — shorthand for `--wait=none --timeout=0` (precise-timing scenarios)

**ENV layer**: `SE_CLI_TIMEOUT` / `SE_CLI_WAIT` / `SE_CLI_RETRY` / `SE_CLI_RETRY_INTERVAL` / `SE_CLI_IMPLICIT_WAIT` / `SE_CLI_PAGE_LOAD_TIMEOUT` / `SE_CLI_SCRIPT_TIMEOUT`

**Config file layer** (`.se-cli.json` or `~/.config/se-cli/config.json`):
```json
{
  "wait": { "timeout": 5000, "state": "auto", "retry": 0, "retryInterval": 100 },
  "timeouts": { "implicit": 0, "pageLoad": 30000, "script": 30000 },
  "perCommand": {
    "click":    { "wait": "visible+enabled" },
    "fill":     { "wait": "visible+enabled" },
    "snapshot": { "wait": "none" },
    "eval":     { "wait": "none", "scriptTimeout": 30000 }
  }
}
```

**New commands**:
- [x] `config get <key>` / `config set <key> <value>` / `config list` (list shows source per item: flag/env/file/default)
- [x] `config init` — generate template config file

**Code generation**: emitted code reflects the effective strategy
```js
await driver.wait(until.elementIsVisible(el), 5000);
await driver.wait(until.elementIsEnabled(el), 5000);
```

**Implementation status (v0.4)**:
- [x] 4-tier configuration resolver (`src/wait-config.ts`)
- [x] Flag layer: `--timeout`, `--wait`, `--retry`, `--retry-interval`, `--implicit-wait`, `--page-load-timeout`, `--script-timeout`, `--no-wait`
- [x] ENV layer: `SE_CLI_TIMEOUT` / `SE_CLI_WAIT` / `SE_CLI_RETRY` / `SE_CLI_RETRY_INTERVAL` / `SE_CLI_IMPLICIT_WAIT` / `SE_CLI_PAGE_LOAD_TIMEOUT` / `SE_CLI_SCRIPT_TIMEOUT`
- [x] Config file layer: `.se-cli.json` and `~/.config/se-cli/config.json`
- [x] `config get/set/list/init` commands
- [x] Wait-aware code generation for interactive tools (click, fill, check, uncheck, select)
- [x] Retry logic with configurable count and interval
- [x] Auto state resolution (interactive commands → visible, read-only commands → none)
- [x] Unit tests (`tests/unit/wait-config.test.ts`)
- [x] Integration tests (`tests/integration/fixtures/wait.html`)

### v0.5: Interaction Completion ✅

Close the gap on basic interaction capabilities missing vs Playwright CLI and Selenium.
All Actions commands automatically consume the v0.4 wait/retry configuration.

- [x] **hover <ref>**: mouse hover via `driver.actions().move()`
- [x] **dblclick <ref>**: double-click via `driver.actions().doubleClick()`
- [x] **drag <start> <end>**: drag and drop via `driver.actions().dragAndDrop()`
- [x] **dialog-accept [text]**: handle alert/confirm/prompt via `driver.switchTo().alert()`
- [x] **dialog-dismiss**: dismiss dialog
- [x] **upload <ref> <file>**: file upload via `driver.findElement().sendKeys(path)`
- [x] **resize <w> <h>**: viewport control via `driver.manage().window().setRect()`
- [x] **keydown / keyup <key>**: fine-grained keyboard control via Actions chain
- [x] **mousemove <x> <y>**: mouse position control
- [x] **mousedown / mouseup [button]**: mouse button control
- [x] **mousewheel <dx> <dy>**: scroll wheel control
- [x] **actions-chain <json>**: combine multiple actions into a single `driver.actions().move().down().up().perform()` to reduce round-trips

**Implementation status (v0.5)**:
- [x] `hover`, `dblclick`, `drag` tools (`src/daemon/tools/interactions.ts`)
- [x] `dialog-accept`, `dialog-dismiss` tools (`src/daemon/tools/dialog.ts`)
- [x] `upload <ref> <file>` tool via `element.sendKeys(absolutePath)` (`src/daemon/tools/upload.ts`)
- [x] `resize <w> <h>` tool via `driver.manage().window().setRect()` (`src/daemon/tools/resize.ts`)
- [x] Fine-grained keyboard control: `keydown`, `keyup` (`src/daemon/tools/advanced-input.ts`)
- [x] Fine-grained mouse control: `mousemove`, `mousedown`, `mouseup`, `mousewheel` (`src/daemon/tools/advanced-input.ts`)
- [x] `actions-chain <json>` for batched `perform()` to reduce round-trips (`src/daemon/tools/advanced-input.ts`)
- [x] All Actions commands consume v0.4 wait/retry configuration
- [x] Code generation for all new interaction tools
- [x] Unit tests for each tool
- [x] Integration tests (`tests/integration/fixtures/interactions.html`)

### v0.6: Web-First Assertions ✅

Playwright's `expect(locator).toBeVisible()` retry-until-timeout assertion is the key to CI-friendly
tests. se-cli ports this to a CLI-native `expect` command set with CI-friendly exit codes. All
assertions consume the v0.4 wait/retry configuration layer and reuse `driver.wait(until.condition, timeout)`
internally, so polling, timeout, and retry behavior stay consistent with the interactive commands.

**Command set**:

```
se-cli expect <ref|selector> visible | hidden     [--not] [--timeout=N]
se-cli expect <ref>           enabled | disabled  [--not] [--timeout=N]
se-cli expect <ref>           checked | unchecked [--not] [--timeout=N]
se-cli expect <ref>           text     "expected" [--exact] [--not] [--timeout=N]
se-cli expect <ref>           value    "expected" [--exact] [--not] [--timeout=N]
se-cli expect <ref>           count    N          [--not] [--timeout=N]
se-cli expect <ref>           attribute <name> <value> [--exact] [--not] [--timeout=N]
se-cli expect title "..."                          [--exact] [--not] [--timeout=N]
se-cli expect url    "..."                         [--exact] [--not] [--timeout=N]
```

**Key design decisions**:

- **Retry-until-timeout polling**: every assertion is evaluated by `driver.wait(until.condition, timeout)`,
  polling the page at a fixed interval until the condition holds or the timeout elapses. Defaults inherit
  from v0.4 (`--timeout=5000`, `--retry-interval=100`); override per-command with `--timeout=N`.
- **CI-friendly exit codes**: `0` = assertion passed, `1` = assertion failed. Shell scripts and CI
  pipelines can chain assertions with `&&` / `||` without parsing output:
  ```bash
  se-cli expect e1 visible && se-cli expect e1 text "Saved"
  ```
- **`ASSERTION_FAILED` error code**: failed assertions return `{ ok:false, code:"ASSERTION_FAILED", error:"<details>" }`
  through the protocol (see §4.3). The CLI renders a friendly message and exits `1`; `--json` surfaces the
  structured error for programmatic consumers.
- **`AssertionError` class**: a dedicated error class (`src/daemon/tools/expect.ts`) carries the expected
  vs. actual values, the matcher name, and the `--not` state, so error output can explain *why* the assertion
  failed (e.g. `expected text to equal "Saved", received "Saving..."`).
- **`--not` flag**: inverts the assertion. `expect e1 visible --not` asserts the element is *not* visible;
  internally the condition is wrapped with `until.not(...)` so polling semantics are unchanged.
- **`--exact` flag**: applies to `text`, `value`, `attribute`, `title`, and `url` matchers. Default matching
  is **substring** (Playwright-compatible); `--exact` switches to strict equality. `count` ignores `--exact`.
- **Integration with v0.4 wait configuration**: assertions resolve the same 4-tier config (`--flag` > `ENV` >
  `.se-cli.json` > built-in default). The default wait state for assertions is `attached` (the element must
  exist in the DOM before its visibility/state/text can be polled); visibility matchers additionally poll
  for `visible`/`hidden` themselves.

**Code generation**: emitted code reflects the effective matcher, flags, and timeout:
```js
await driver.wait(until.elementIsVisible(el), 5000);              // expect e1 visible
await driver.wait(until.elementTextContains(el, "Saved"), 5000);  // expect e1 text "Saved"
await driver.wait(until.elementTextIs(el, "Saved"), 5000);        // expect e1 text "Saved" --exact
await driver.wait(until.not(until.elementIsVisible(el)), 5000);   // expect e1 visible --not
```

**Implementation status (v0.6)**:
- [x] `expect <ref|selector> visible|hidden [--not] [--timeout=N]` (`src/daemon/tools/expect.ts`)
- [x] `expect <ref> enabled|disabled|checked|unchecked [--not] [--timeout=N]`
- [x] `expect <ref> text "expected" [--exact] [--not] [--timeout=N]`
- [x] `expect <ref> value "expected" [--exact] [--not] [--timeout=N]`
- [x] `expect <ref> count N [--not] [--timeout=N]`
- [x] `expect <ref> attribute <name> <value> [--exact] [--not] [--timeout=N]`
- [x] `expect title "..." [--exact] [--not] [--timeout=N]`
- [x] `expect url "..." [--exact] [--not] [--timeout=N]`
- [x] Retry-until-timeout polling (default 5000ms / 100ms interval) via `driver.wait()`
- [x] CI-friendly exit codes (0 = pass, 1 = fail)
- [x] `ASSERTION_FAILED` protocol error code
- [x] `AssertionError` class with expected/actual/matcher metadata
- [x] `--not` flag inverts the assertion
- [x] `--exact` flag switches substring → exact match
- [x] Integration with v0.4 wait configuration (default state: `attached`)
- [x] Code generation for all matchers
- [x] Unit tests (`tests/unit/v0.6-assertions.test.ts`)
- [x] Integration tests (`tests/integration/fixtures/assertions.html`)

### v0.7: Network & Debugging ✅

Leverage Selenium BiDi protocol (available in selenium-webdriver@4.46.0) for network
interception, console log capture, and request monitoring. BiDi works on Chrome/Edge/Firefox.

**Commands**:
```bash
se-cli highlight [ref] [--style="..."] [--hide] [--all]
se-cli console [level] [--since=5m] [--clear]
se-cli requests [--filter="api"] [--status=500] [--method=POST] [--clear]
se-cli request <index>
se-cli route <pattern> [--status=401] [--body="..."] [--headers='{"Content-Type":"application/json"}']
se-cli route-list
se-cli unroute <index> | --all
```

**Architecture**:
- **BiDi initialization**: Lazy on first network/debug command via `ensureBidiInitialized()` in
  `src/daemon/tools/network-state.ts`. Subsequent calls are no-ops.
- **Console capture**: Uses `selenium-webdriver/bidi/logInspector` to subscribe to
  `onConsoleEntry` and `onJavascriptException` events. Messages buffered in-memory (max 1000 entries).
- **Network monitoring**: Uses `selenium-webdriver/bidi/network` to subscribe to
  `beforeRequestSent`, `responseCompleted`, and `fetchError` events. Requests buffered
  in-memory (max 500 entries) with request/response headers, body, status, and duration.
- **Route interception**: Uses `network.addIntercept()` with `AddInterceptParameters` and
  `InterceptPhase.BEFORE_REQUEST_SENT`. Mock responses provided via `ProvideResponseParameters`.
- **Element highlighting**: Pure CSS injection via `driver.executeScript()` — no BiDi/CDP needed.
  Applies `outline` style and tracks highlights in a registry.

**Code generation**:
```javascript
// highlight e1
await driver.executeScript(
  "arguments[0].style.outline = arguments[1]; arguments[0].dataset.seHighlight = '1';",
  el, '3px solid red'
);
```

**Implementation status (v0.7)**:
- [x] `highlight [ref] [--style=] [--hide] [--all]` (`src/daemon/tools/highlight.ts`)
- [x] `console [level] [--since=] [--clear]` (`src/daemon/tools/console.ts`)
- [x] `requests [--filter=] [--status=] [--method=] [--clear]` (`src/daemon/tools/requests.ts`)
- [x] `request <index>` — show request details (`src/daemon/tools/requests.ts`)
- [x] `route <pattern> [--status=] [--body=] [--headers=]` (`src/daemon/tools/route.ts`)
- [x] `route-list` — list active routes (`src/daemon/tools/route.ts`)
- [x] `unroute <index> | --all` — remove route(s) (`src/daemon/tools/route.ts`)
- [x] BiDi state manager (`src/daemon/tools/network-state.ts`)
- [x] Console + JS exception capture via BiDi LogInspector
- [x] Network request/response capture via BiDi Network events
- [x] Route interception via BiDi addIntercept + provideResponse
- [x] In-memory buffers with truncation (1000 console entries, 500 network requests)
- [x] Code generation for all commands
- [x] Unit tests (`tests/unit/v0.7-network-debug.test.ts`)
- [x] Integration tests (`tests/integration/fixtures/network-debug.html`)

### v0.8: Device & Environment Emulation (Core, Playwright port: low complexity × medium importance) ✅

All capabilities via CDP `Emulation.*` / `Network.*` domains, BiDi as fallback.
Selenium has no native equivalent, but CDP makes this trivial to port.

- [x] `open --geolocation=lat,lng --timezone=America/Los_Angeles --locale=zh-CN --color-scheme=dark --viewport=WxH --user-agent="..." --permissions=geolocation,notifications`
- [x] `device "iPhone 13"` — apply preset (UA + viewport + touch + deviceScaleFactor)
- [x] `device-list` — list built-in device profiles (reference Playwright DeviceDescriptors)
- [x] `emulate --offline` — go offline
- [x] `emulate --throttle-network=slow3g` — `slow3g|fast3g|custom:--download=,--upload=,--latency=`
- [x] `emulate --throttle-cpu=4` — CPU slowdown rate
- [x] `emulate --reset` — restore all emulation
- [x] Emulation state integrated into `state-save` (persist emulate configuration)

### v0.9: MCP Server & AI Ecosystem (Must-Have) ✅ (implemented, v0.9)

Expose se-cli as an MCP Server for AI agent integration. Playwright already provides
`@playwright/mcp`; se-cli must follow to stay competitive. Dual-track strategy:
CLI+SKILLS (token-efficient for coding agents) and MCP Server (persistent state for
autonomous workflows). Both share the same underlying tool implementation.

**Implemented (early delivery — prioritized per user request)**:

- [x] **se-cli mcp-server**: start MCP Server using custom JSON-RPC 2.0 over stdio
  (no external SDK dependency — keeps bundle size minimal)
- [x] **MCP tool exposure**: all 40+ CLI tools wrapped as MCP tool definitions with
  JSON Schema input validation (`src/mcp-server.ts`)
- [x] **stdio transport** (default): local agent communication via line-delimited JSON-RPC
- [x] **VS Code workspace config**: `.vscode/mcp.json` for project-level MCP server registration
- [x] **VS Code extension**: published as a separate repo [`se-cli/se-extension-vscode`](https://github.com/se-cli/se-extension-vscode)
  with `contributes.mcpServers` for marketplace discovery (search `@mcp se-cli` in Extensions view)
- [x] **MCP server package**: published as a separate repo [`se-cli/se-mcp`](https://github.com/se-cli/se-mcp)
  (npm: `@browsers-cli/se-mcp`) — thin wrapper that re-exports the MCP server from `@browsers-cli/se-cli`,
  following the `playwright-mcp` pattern
- [x] **Tool-to-CLI mapping**: `mapToolToCliArgs()` translates MCP tool calls to daemon CLI args
- [x] **Session sharing**: MCP server delegates to the same daemon architecture as CLI,
  so browser state persists across both interaction modes
- [x] **Protocol compliance**: `initialize` / `tools/list` / `tools/call` methods,
  `notifications/initialized` handshake, MCP protocol version `2025-06-18`
- [x] **Unit tests**: 105 test cases covering tool definitions, CLI mapping, and edge cases
  (`tests/unit/mcp-server.test.ts`)

**Remaining (future enhancement)**:

- [x] **Streamable HTTP transport** (optional): remote agent communication
  (`se-cli mcp-server --http [--port=8931] [--host=127.0.0.1]`; `POST|GET|DELETE /mcp`,
  `Mcp-Session-Id`, JSON or SSE responses per the 2025-06-18 spec)
- [x] **run-code "async driver => ..."**: execute arbitrary Selenium code snippets
  (`src/daemon/tools/run-code.ts`; returned `WebElement`s become fresh refs `e<N>`)
- [x] **generate-locator <ref>**: generate best locator expression (By.role/By.css)
  (`src/daemon/tools/generate-locator.ts` + `src/daemon/tools/locator.ts`; candidates with
  match counts, stability scoring role > id > css > xpath, `--all` / `--style` / `--raw` / `--json`)
- [x] **Role-based locator code generation**: enhance codegen with `By.role()` output
  (interaction commands emit `new By('role', { role, name })` by default; `--locator-style=role|css|ref`)
- [x] **SKILL.md frontmatter compliance**: add `name`, `description`, `license`, `compatibility` metadata per Agent Skills spec
- [x] **install --skills enhancement**: multi-target discovery (Claude Code, Cursor, Copilot, generic)
  (`src/install.ts`; `--agent=a,b,c` multi-target, auto-detect, `--path`, `--force`, `--list-agents`)

### v0.10: Remote, Grid & Custom Browsers (Core, Selenium moat)

Extend browser coverage and connection capabilities. This is the area Playwright will
never match — emphasized as a differentiated stronghold rather than a passing "Core" note.

- [x] **--browser=safari**: real Safari via `safaridriver` (macOS only, no headless/BiDi/CDP)
- [x] **--endpoint=<url>**: connect to Selenium Grid 4 or remote WebDriver
- [x] **--browser-binary=<path>**: custom browser binary (360, UC, QQ, Brave, Electron-embedded, QtWebEngine, domestic browsers)
- [x] **--browser=electron --app-binary=<path>**: Electron app testing via ChromeDriver with Electron binary (issue #73)
- [x] **--driver-binary=<path>**: custom driver binary (bypass selenium-manager)
- [x] **--browser-args="<args>"**: pass-through browser launch arguments
- [ ] **--browser-prefs=<json>**: Chromium prefs injection
- [x] **--capabilities=<json>**: pass-through arbitrary W3C capabilities (cover all WebDriver protocol endpoints)
- [ ] **Cloud browser integration**: Browserbase, Sauce Labs, BrowserStack
- [x] **grid status / grid attach / grid distribute --shard=x/y**: Grid management and distributed sharding
- [x] **pdf --filename=f**: via W3C WebDriver print endpoint (`driver.printPage()`), Chromium + Firefox
- [ ] **--browser=edge-ie** (Edge IE mode, recommended path for legacy IE scenarios)
  - Requires Windows Edge Enterprise + IE-mode policy configuration (group policy / registry) — deferred until an environment with Edge Enterprise is available for verification
  - msedgedriver + Edge IE mode loads the IE engine
  - Auto-configure Edge IE mode policy (group policy / registry / `--ie-mode-tab`)
  - Platform: Windows Edge Enterprise only
  - Capability matrix:
    - ✅ navigate / interaction / screenshot / cookie / storage / state-save / tabs
    - ✅ basic iframe (`switchTo().frame()`)
    - ✅ partial CDP: console / basic network monitoring (no interception)
    - ⚠️ Actions chain degraded (some actions execute as single steps)
    - ❌ BiDi network interception (route/unroute)
    - ❌ Shadow DOM (IE engine does not support it)
    - ❌ emulate / device / throttle
    - ❌ tracing / video
  - aria snapshot: uses main injection script (Edge shell supports modern JS), but IE-engine-rendered DOM may have role calculation drift; output header annotated `[browser=edge-ie, capabilities=limited]`
  - codegen: disable `By.role()`, keep `By.css()` / `By.xpath()`
  - Startup detects IE mode availability; if unconfigured, returns clear setup guidance (registry / group policy steps)

> **Safari limitations**: safaridriver has no headless mode, no BiDi/CDP support, macOS only.
> Basic navigation/interaction/screenshot/storage commands work; network interception,
> console logs, and BiDi features are unavailable.
>
> **Edge IE mode limitations**: Windows Edge Enterprise only; IE mode must be enabled via
> policy. Network interception, Shadow DOM, emulation, and recording unavailable.

### v0.11: Recording & Visualization (Marginal)

Recording and visualization capabilities for development and debugging workflows.
High implementation complexity but significant differentiation potential.

- [ ] **se-cli record**: recording mode — user actions generate a complete test file
- [ ] **export --format=pytest|junit5|mocha**: multi-framework test code export from recorded sessions (issue #75)
- [ ] **--report=junit|allure|html**: built-in test report generation for CI integration (issue #74)
- [ ] **tracing-start / tracing-stop**: operation tracing and storage (simplified; see "Will Never Implement")
- [ ] **video-start / video-stop**: video recording via CDP or ffmpeg frame capture
- [ ] **video-chapter <title>**: mark chapters in recordings
- [ ] **show**: visualization dashboard for multi-session monitoring
- [ ] **show --annotate**: page annotation for design feedback

### v0.12: VSCode Extension (Marginal)

Develop VSCode extension as a separate GitHub repo ([`se-cli/se-extension-vscode`](https://github.com/se-cli/se-extension-vscode)),
following the `playwright-vscode` pattern. Depends on se-cli CLI being globally installed.

**Initial implementation (delivered)**:

- [x] **MCP Server registration**: `contributes.mcpServers` auto-registers se-cli as MCP server
- [x] **Commands**: open/close browser, navigate, snapshot, screenshot, click, fill, run command
- [x] **Webview panel**: snapshot tree, screenshot preview, command history, quick actions
- [x] **Status bar**: daemon status display with quick-pick menu
- [x] **Configuration**: browser, headless, session, auto-snapshot, CLI path settings

**Future enhancements**:

- [ ] **Task Provider**: register se-cli commands as VSCode custom tasks
- [ ] **attach --extension**: connect to real browser via extension
- [ ] **Marketplace publishing**: package and publish to VS Code Marketplace

### v0.13: BiDi Expansion & Hardening (Core)

Expand WebDriver BiDi protocol coverage and harden the daemon for production reliability.
After all feature releases (v0.8–v0.12) are shipped, this version focuses on deepening
BiDi integration and optimizing performance/stability.

**BiDi Protocol Expansion** (issue #76):

- [ ] **browsingContext module**: `captureScreenshot` (cross-browser), `print` (print-to-PDF
  via BiDi, not CDP), `setViewport`, `setBypassCSP`, `handleUserPrompt`, download tracking
  (`downloadWillBegin`/`downloadEnd` events)
- [ ] **input module**: `setFiles` and `fileDialogOpened` for reliable file upload handling
  without CDP
- [ ] **script module**: `addPreloadScript`/`removePreloadScript` — inject scripts before
  page scripts run, `getRealms` for sandboxed execution
- [ ] **emulation module**: BiDi-native geolocation/locale/timezone/network conditions
  (cross-browser alternative to CDP `Emulation.*`); migrate v0.8 from CDP-first to BiDi-first
- [ ] **browser module**: `createUserContext`/`removeUserContext` for container/cookie
  isolation (like Chrome profiles), `setDownloadBehavior`
- [ ] **storage module**: cookie management with `PartitionKey` support
- [ ] New CLI commands: `preload add/remove/list`, `download-list`, `context-new/close/list`

**Performance Optimization** (issue #77):

- [ ] **Daemon startup**: lazy-load driver on first command, cache compiled TypeScript,
  parallelize selenium-manager with session init
- [ ] **Snapshot efficiency**: optimize for large DOMs (>5000 elements), incremental
  snapshots (`snapshot --diff`), Web Worker serialization
- [ ] **Memory management**: circular buffers for console/network, LRU eviction,
  `--max-buffer=<n>` flag, stale element ref GC
- [ ] **Response optimization**: gzip compression for >4KB payloads, batched element queries

**Stability Hardening** (issue #78):

- [x] **Startup cleanup**: daemon startup garbage-collects orphaned session
  files (dead pid + old), old rotated log backups, and opt-in old
  screenshots (issue #115)
- [ ] **Error recovery**: driver crash detection with auto-restart, stale element ref
  auto-refresh, BiDi WebSocket auto-reconnect
- [ ] **Session resilience**: session file validation, zombie process cleanup,
  port/pipe conflict resolution, graceful BiDi/CDP degradation
- [ ] **Retry enhancement**: circuit breaker pattern, exponential backoff
  (`--retry-backoff=exponential`), idempotent retry, per-tool retry policy
- [ ] **CI hardening**: standardized exit codes (0/1/2/3/4), structured error JSON
  with remediation hints, `--ci` flag for minimal timestamped logging

### Long-term Goals (no version commitment)

- [ ] **Multi-language SDK**: Python/Java client bindings (CLI stays Node)
- [ ] **Simplified Trace Viewer**: GUI playback for recorded traces (aligned with issue #24)
- [ ] **DOM mutation listener**: via BiDi DOM mutation events (investigated in v0.13, issue #76)
- [ ] **Script preload**: BiDi script pinning and preloading (investigated in v0.13, issue #76)
- [ ] **Multi-language SKILL.md**: localized skill files
- [ ] **pytest-selenium / JUnit5 hooks**: test framework integration (attach to test pause points, issue #22)
- [ ] **Appium mobile testing completion**: iOS/Android bidirectional, Appium Grid (issue #79)
- [ ] **Selenium Grid 4 hub/node management CLI**: deploy, autoscale, node health check

### Will Never Implement (explicitly abandoned)

- ❌ **Native aria ref engine**: cannot match the stability of Playwright's `aria-ref` selector engine; will always rely on the `data-se-ref` attribute
- ❌ **Playwright-level full tracing parity**: Selenium BiDi event stream quality is insufficient for timeline + DOM snapshot + network + console + source map integration; only a simplified version is pursued
- ❌ **Real IE 11 (IEDriverServer) support**: IE 11 is EOL; replaced by Edge IE mode (v0.10) to avoid maintaining an ES5 injection script and Windows-only CI. Users who need true IE11 should use legacy Selenium bindings directly.

## 9. Risks & Mitigation

| Risk | Impact | Mitigation |
|------|------|------|
| Aria snapshot coverage insufficient | agent misidentifies elements → high failure rate | iterate the script on common sites (todomvc/login/forms/navigation), target 80% scenario coverage |
| Refs invalid after DOM rebuild | agent skips snapshot and acts directly | enforce workflow: check ref existence before acting; if missing, prompt snapshot |
| BiDi stability (v0.4+) | network handler silently fails | prefer CDP (Chromium only), BiDi as Firefox fallback |
| Daemon orphan processes | resource leak | selfDestructOnIdle + heartbeat + liveness cleanup during list |
| Selenium driver version drift | driver mismatch after browser update | rely on selenium-manager auto-management; on startup failure suggest install-browser |

## 10. MCP Server Integration

The MCP (Model Context Protocol) server provides an alternative interface to se-cli's
browser automation capabilities, optimized for IDE-integrated AI agents like VS Code Copilot.

### 10.1 Architecture

The MCP server shares the same daemon process as the CLI interface, allowing state
persistence across both interaction modes:

```
┌─────────────────┐     stdio (JSON-RPC)      ┌──────────────────────┐
│  VS Code /      │ ─── line-delimited JSON ─▶ │  se-cli MCP Server   │
│  Copilot /      │ ◀── JSON-RPC response ──── │  (long-lived stdio)  │
│  MCP Client     │                            └──────────┬───────────┘
└─────────────────┘                                       │
                                                          │ Session.run()
                                                          ▼
┌─────────────────┐     Unix socket / pipe   ┌──────────────────────┐
│  se-cli CLI     │ ─── line-delimited JSON ─▶│  se-cli daemon       │
│  (short-lived)  │ ◀── single response ───── │  (holds WebDriver)   │
└─────────────────┘                           └──────────┬───────────┘
                                                          │ W3C WebDriver HTTP
                                                          ▼
                                                    ┌──────────┐
                                                    │ Browser  │
                                                    │(Chrome/  │
                                                    │ Edge/FF) │
                                                    └──────────┘
```

- **MCP Server Process**: Long-lived stdio process implementing JSON-RPC 2.0
- **Communication**: Line-delimited JSON over stdio (stdin/stdout)
- **Tool Definitions**: 40+ browser automation commands exposed as MCP tools
- **Session Management**: Shares daemon state with CLI commands via `Session.run()`

### 10.2 Implementation Details

The MCP server is implemented in `src/mcp-server.ts` with key components:

- **`McpServer` class**: Handles JSON-RPC communication, readline-based stdin parsing,
  session lifecycle, and tool dispatch
- **`mapToolToCliArgs()`**: Converts MCP tool calls (e.g. `browser_click`) to CLI command
  args (e.g. `['click', 'e1', '-s', 'mySession']`) that are forwarded to the daemon
- **`toolDefinitions`**: JSON Schema for all 40+ exposed MCP tools, covering session
  management, navigation, interaction, assertions, network/debugging, storage, tabs, and state
- **Protocol compliance**: `initialize` / `tools/list` / `tools/call` methods,
  `notifications/initialized` handshake, MCP protocol version `2025-06-18`

### 10.3 Multi-Repo Architecture

Following the Playwright ecosystem pattern (`microsoft/playwright`, `microsoft/playwright-mcp`,
`microsoft/playwright-vscode`), se-cli is organized as three independent GitHub repositories:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    se-cli Ecosystem (GitHub org: se-cli)            │
├───────────────────┬───────────────────┬────────────────────────────┤
│  se-cli/se-cli    │  se-cli/se-mcp    │  se-cli/se-extension-vscode│
│  (core)           │  (MCP wrapper)    │  (VS Code extension)       │
├───────────────────┼───────────────────┼────────────────────────────┤
│ npm:              │ npm:              │ Publisher: se-cli           │
│ @browsers-cli/    │ @browsers-cli/    │ VS Code Marketplace         │
│   se-cli          │   se-mcp          │                              │
├───────────────────┼───────────────────┼────────────────────────────┤
│ • CLI + daemon    │ • Thin wrapper    │ • contributes.mcpServers    │
│ • 40+ tools       │   re-exports      │ • Commands (open, snap,     │
│ • MCP server      │   MCP server      │   screenshot, click, etc.)  │
│   (src/mcp-       │   from se-cli     │ • Webview panel             │
│    server.ts)     │ • Standalone CLI  │ • Status bar                │
│ • Aria snapshot   │   (npx se-mcp)    │ • Configuration settings    │
│ • Session mgmt    │ • server.json     │                              │
└───────────────────┴───────────────────┴────────────────────────────┘
         │                    │                      │
         └───── depends on ───┘                      │
                               └── registers ───────┘
```

| Repo | npm / Publisher | Purpose |
|------|----------------|---------|
| [`se-cli/se-cli`](https://github.com/se-cli/se-cli) | `@browsers-cli/se-cli` | Core CLI + daemon + MCP server implementation (`src/mcp-server.ts`) |
| [`se-cli/se-mcp`](https://github.com/se-cli/se-mcp) | `@browsers-cli/se-mcp` | Thin wrapper package — standalone MCP server entry point for MCP clients |
| [`se-cli/se-extension-vscode`](https://github.com/se-cli/se-extension-vscode) | VS Code Marketplace | VS Code extension — MCP registration, commands, webview, status bar |

**Design rationale** (aligned with Playwright's approach):

- **Separation of concerns**: core automation logic, MCP protocol layer, and IDE integration
  evolve independently
- **Standalone MCP installation**: users who only need MCP (not the full CLI experience) can
  install `@browsers-cli/se-mcp` alone
- **IDE-specific code isolation**: VS Code API dependencies don't bloat the core package
- **Independent release cadence**: extension and MCP wrapper can ship bug fixes without
  cutting a full se-cli release

### 10.4 VS Code Integration

Three installation paths for VS Code users:

**Option 1: Workspace `.vscode/mcp.json`** (recommended for projects)
```json
{
  "servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-cli", "mcp-server"]
    }
  }
}
```

**Option 2: User `settings.json`** (global, all workspaces)
```json
{
  "mcp.servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-cli", "mcp-server"]
    }
  }
}
```

**Option 3: VS Code Extension** (marketplace discovery)

The [`se-cli/se-extension-vscode`](https://github.com/se-cli/se-extension-vscode) repo provides a
VS Code extension with `contributes.mcpServers` that enables discovery via the Extensions view
(`Ctrl+Shift+X`, search `@mcp se-cli`). It also provides commands, a webview panel for snapshot/screenshot
preview, and a status bar indicator.

### 10.5 Tool Catalog

All 40+ MCP tools map 1:1 to se-cli CLI commands:

| Category | MCP Tools | CLI Commands |
|----------|-----------|-------------|
| Session | `browser_open`, `browser_close`, `browser_list_sessions`, `browser_close_all` | `open`, `close`, `list`, `close-all` |
| Navigation | `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_get_title`, `browser_get_url` | `goto`, `go-back`, `go-forward`, `reload`, `title`, `url` |
| Interaction | `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_select`, `browser_check`, `browser_uncheck` | `click`, `fill`, `type`, `press`, `select`, `check`, `uncheck` |
| Advanced Interaction | `browser_hover`, `browser_dblclick`, `browser_drag`, `browser_upload`, `browser_resize` | `hover`, `dblclick`, `drag`, `upload`, `resize` |
| Assertions | `browser_expect` | `expect` |
| Snapshot | `browser_snapshot`, `browser_find` | `snapshot`, `find` |
| Save & Execute | `browser_screenshot`, `browser_eval` | `screenshot`, `eval` |
| Storage | `browser_cookie_*`, `browser_*storage_*` | `cookie-*`, `*storage-*` |
| Tabs | `browser_tab_*` | `tab-*` |
| State | `browser_state_save`, `browser_state_load` | `state-save`, `state-load` |
| Network & Debug | `browser_highlight`, `browser_console`, `browser_requests`, `browser_request`, `browser_route`, `browser_route_list`, `browser_unroute` | `highlight`, `console`, `requests`, `request`, `route`, `route-list`, `unroute` |

### 10.6 Design Decision: Custom JSON-RPC vs `@modelcontextprotocol/sdk`

se-cli implements JSON-RPC 2.0 directly instead of depending on `@modelcontextprotocol/sdk`:

- **Zero extra dependency**: keeps npm install fast and bundle size small
- **Full control**: custom readline-based stdio parsing with `StringDecoder` for UTF-8 safety
  (consistent with the daemon's socket protocol in §4.3)
- **Protocol compliance**: implements the same MCP protocol version (`2025-06-18`) and methods
- **Test coverage**: 105 unit tests validate tool definitions and CLI argument mapping

## 11. References

- playwright-cli source (d:\code\opensource\playwright-cli) — architecture reference
- [Playwright aria snapshot algorithm](https://playwright.dev/docs/aria-snapshots) — algorithm inspiration
- [Selenium 4 WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/) — foundation for v0.4+ network capabilities
- [W3C ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — role determination spec
- [MCP Protocol Specification](https://modelcontextprotocol.io/specification) — MCP protocol reference
