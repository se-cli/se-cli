# AGENTS.md

Guidelines for AI agents and human contributors working on the se-cli codebase.

## Canonical Repository

- **Organization**: `se-cli`
- **Repository**: `se-cli/se-cli`
- **GitHub URL**: `https://github.com/se-cli/se-cli`
- **GitHub Pages**: `https://se-cli.github.io/se-site/`
- **npm package**: `@browsers-cli/se-cli`
- **npm URL**: `https://www.npmjs.com/package/@browsers-cli/se-cli`

### Ecosystem Repositories

The se-cli ecosystem consists of three independent repositories (following the Playwright pattern), plus the unified documentation site:

| Repo | npm Package | Purpose |
|------|------------|---------|
| [`se-cli/se-cli`](https://github.com/se-cli/se-cli) | `@browsers-cli/se-cli` | Core CLI + daemon + MCP server implementation |
| [`se-cli/se-mcp`](https://github.com/se-cli/se-mcp) | `@browsers-cli/se-mcp` | Thin MCP server wrapper package for MCP clients |
| [`se-cli/se-extension-vscode`](https://github.com/se-cli/se-extension-vscode) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=se-cli.se-extension-vscode) | VS Code extension — MCP registration, commands, webview |
| [`se-cli/se-site`](https://github.com/se-cli/se-site) | - | Unified Markdown-based documentation site (Docusaurus) |

### URL Reference Rules (CRITICAL)

All GitHub URLs in documentation, source code, configuration, and website content **MUST** point to the organization repository `se-cli/se-cli`. Never use personal or fork usernames (e.g., `alaahong`) in any committed file.

**Correct patterns:**

```
https://github.com/se-cli/se-cli
https://github.com/se-cli/se-cli/issues
https://github.com/se-cli/se-cli/blob/main/docs/spec.md
https://se-cli.github.io/se-site/
https://www.npmjs.com/package/@browsers-cli/se-cli
```

**Incorrect patterns (NEVER commit these):**

```
https://github.com/alaahong/se-cli          # personal fork
https://alaahong.github.io/se-cli/          # personal GitHub Pages
```

When creating PRs from a fork, ensure the branch is rebased onto `upstream/main` before pushing. This prevents stale fork URLs from leaking into the PR diff. See the [PR Workflow](#pr-workflow) section for details.

## Project Overview

se-cli is a token-efficient Selenium browser automation CLI for AI agents and humans. It uses a short-lived CLI + long-lived daemon architecture: the CLI sends one JSON line per command to a daemon process that holds the WebDriver instance.

- **Language**: TypeScript (Node.js >= 18)
- **Browser automation**: selenium-webdriver
- **Test framework**: Vitest
- **Module system**: CommonJS

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── program.ts          # Command routing
├── session.ts          # Daemon spawn + RPC client (socket communication)
├── registry.ts         # Session file management
├── output.ts           # Output formatting
├── protocol.ts         # Message types
├── minimist.ts         # Argv parser
├── config.ts           # Paths and session config
├── response.ts         # Response serialization
├── snapshot/
│   └── aria-snapshot.ts  # Aria snapshot injection script
└── daemon/
    ├── server.ts       # Daemon socket server (net.createServer)
    ├── backend.ts      # Tool dispatcher
    └── tools/          # One file per tool (click.ts, fill.ts, etc.)
```

### Key Design Decisions

- **Socket communication**: Line-delimited JSON over Unix socket (Linux/macOS) or Windows named pipe. Uses `StringDecoder('utf8')` to correctly handle multi-byte UTF-8 characters split across TCP chunks.
- **Element references**: `data-se-ref` attribute on elements, referenced as `e1`, `e2`, etc. in CLI commands. Cross-frame refs use `f<frameIndex>e<ref>` format (e.g., `f2e5`).
- **Driver management**: `driver` is a module-level variable in `server.ts`. On `DRIVER_ERROR` or `TIMEOUT`, the driver is reset (not cached permanently). `driverInitError` is cleared on each retry.
- **Session config**: `SessionConfig` in `config.ts` supports `persistent` field for `--persistent` flag (syntax sugar for `--profile=<auto-path>`).
- **Startup cleanup**: `src/cleanup.ts` runs a best-effort GC pass on every daemon startup (before the daemon writes its own session file). It removes orphaned `*.session` files whose recorded daemon `pid` is dead AND older than `SE_CLI_CLEANUP_MAX_AGE_DAYS` (default 7), old rotated log backups (`SE_CLI_CLEANUP_LOG_MAX_AGE_DAYS`), and opt-in old screenshots (`SE_CLI_CLEANUP_SCREENSHOT_DAYS`, default 0 = disabled). Active sessions are never touched; cleanup failures are logged and never block startup. Unit tests: `tests/unit/cleanup.test.ts`; integration: `tests/integration/cleanup.test.ts` (isolated `LOCALAPPDATA`).

## CI/CD

### CI Configuration

- CI config: `.github/workflows/ci.yml`
- **Node.js version**: 22 (required)
- **Test runner**: Vitest with path-based filtering (`npm run test:coverage`), NOT Jest `--filter`
- **Coverage**: Enforced at 95% statements/lines/functions and 90% branches via `vitest.config.ts` thresholds
- **Test timeout**: 120000ms (integration tests start browser daemons)
- **Integration tests**: Must use HTTP server (`tests/integration/test-server.ts`), not `file://` protocol
- **Test pages (dual mirror)**: Integration-test pages exist in **two** places and MUST stay in sync:
  - **Local (source of truth)**: `tests/integration/fixtures/` — served by `tests/integration/test-server.ts` during integration tests. Run `npm run test-pages:serve` to serve them locally (default `http://127.0.0.1:8930/`) for manual testing with `se-cli open`.
  - **Site mirror**: mirrored to the unified site's `static/test-pages/` (see `se-cli/se-site`) for GitHub Pages access. After adding/changing a fixture, run `npm run test-pages:sync` (resolves `../se-site` or `SE_SITE_DIR`). The site's `test-pages/index.html` is site-managed and never overwritten by the sync.
- **Upload coverage**: Include `if-no-files-found: ignore` to suppress warnings
- **Flaky test mitigation**: CI retries failed integration tests automatically. Chrome jobs may fail with `0xC0000142` (STATUS_DLL_INIT_FAILED) — re-running typically resolves it.

### Timeouts

| Setting | Value | Location |
|---------|-------|----------|
| `sendAndClose` | 60s | `src/session.ts` |
| `startDaemon` | 120s | `src/session.ts` |
| `testTimeout` | 120000ms | `vitest.config.ts` |

### Release Workflow

**Branch convention**: Every release MUST be conducted on a dedicated `release/v<x.y.z>` branch (e.g., `release/v0.4.0`). Do NOT use `chore/bump-version-*` or `main` directly for releases.

**Release steps**:

1. **Create release branch** from latest `upstream/main`:
   ```bash
   git fetch upstream
   git checkout -b release/v<x.y.z> upstream/main
   ```
2. **Bump version** in `package.json` to `<x.y.z>` on the release branch
3. **Push and create PR** targeting `main`:
   ```bash
   git push origin release/v<x.y.z>
   # Create PR titled: "chore: release v<x.y.z>"
   ```
4. **Wait for CI** — all checks (lint, type check, unit tests, integration tests across Chrome/Edge/Firefox) must pass
5. **Trigger `create-release.yml`** via `workflow_dispatch` with `version: "<x.y.z>"` — it checks out the **release branch** (not `main`), verifies `package.json` version matches, runs quality gates, creates tag `v<x.y.z>`, and creates a draft GitHub Release targeting the release branch
6. **Publish the Release** on GitHub — this triggers `publish.yml` which publishes to npm as `@browsers-cli/se-cli` with provenance
7. **Merge the PR** (squash merge) into `main` — done **after** the release so no post-release merge/PR is needed; the release branch becomes the baseline for the next release
8. **Register the release** in the [Release Log](#release-log) table below (commit the row to the release branch **before** merging, so it lands with the release merge — no separate follow-up PR)

**CRITICAL**: The `package.json` version on the `release/v<x.y.z>` **branch** (not `main`) must match the release version before triggering `create-release.yml`. The release PR is merged into `main` **after** the release is published, avoiding extra merge commits/PRs after publish.

### Release Log

| Version | Release Branch | PR | Release URL | npm | Date |
|---------|---------------|-----|-------------|-----|------|
| 0.1.1 | `release/v0.1.1` | — | [v0.1.1](https://github.com/se-cli/se-cli/releases/tag/v0.1.1) | `@browsers-cli/se-cli@0.1.1` | 2026-07-29 |
| 0.2.0 | `release/v0.2.0` | — | [v0.2.0](https://github.com/se-cli/se-cli/releases/tag/v0.2.0) | `@browsers-cli/se-cli@0.2.0` | 2026-07-29 |
| 0.3.0 | `release/v0.3.0` | — | [v0.3.0](https://github.com/se-cli/se-cli/releases/tag/v0.3.0) | `@browsers-cli/se-cli@0.3.0` | 2026-07-30 |
| 0.4.0 | `release/v0.4.0` | [#62](https://github.com/se-cli/se-cli/pull/62) | [v0.4.0](https://github.com/se-cli/se-cli/releases/tag/v0.4.0) | `@browsers-cli/se-cli@0.4.0` | 2026-07-31 |
| 0.5.0 | `release/v0.5.0` | [#65](https://github.com/se-cli/se-cli/pull/65) | [v0.5.0](https://github.com/se-cli/se-cli/releases/tag/v0.5.0) | `@browsers-cli/se-cli@0.5.0` | 2026-07-31 |
| 0.6.0 | `release/v0.6.0` | [#67](https://github.com/se-cli/se-cli/pull/67) | [v0.6.0](https://github.com/se-cli/se-cli/releases/tag/v0.6.0) | `@browsers-cli/se-cli@0.6.0` | 2026-07-31 |
| 0.7.0 | `release/v0.7.0` | [#70](https://github.com/se-cli/se-cli/pull/70) | [v0.7.0](https://github.com/se-cli/se-cli/releases/tag/v0.7.0) | `@browsers-cli/se-cli@0.7.0` | 2026-08-01 |
| 0.7.1 | `release/v0.7.1` | [#83](https://github.com/se-cli/se-cli/pull/83) | [v0.7.1](https://github.com/se-cli/se-cli/releases/tag/v0.7.1) | `@browsers-cli/se-cli@0.7.1` | 2026-08-01 |
| 0.7.2 | `release/v0.7.2` | [#92](https://github.com/se-cli/se-cli/pull/92) | [v0.7.2](https://github.com/se-cli/se-cli/releases/tag/v0.7.2) | `@browsers-cli/se-cli@0.7.2` | 2026-08-02 |
| 0.8.0 | `release/v0.8.0` | [#101](https://github.com/se-cli/se-cli/pull/101) | [v0.8.0](https://github.com/se-cli/se-cli/releases/tag/v0.8.0) | `@browsers-cli/se-cli@0.8.0` | 2026-08-03 |
| 0.9.0 | `release/v0.9.0` | [#110](https://github.com/se-cli/se-cli/pull/110) | [v0.9.0](https://github.com/se-cli/se-cli/releases/tag/v0.9.0) | `@browsers-cli/se-cli@0.9.0` | 2026-08-04 |
| 0.9.1 | `release/v0.9.1` | [#112](https://github.com/se-cli/se-cli/pull/112) | [v0.9.1](https://github.com/se-cli/se-cli/releases/tag/v0.9.1) | `@browsers-cli/se-cli@0.9.1` | 2026-08-04 |
| 0.9.2 | `release/v0.9.2` | [#113](https://github.com/se-cli/se-cli/pull/113) | [v0.9.2](https://github.com/se-cli/se-cli/releases/tag/v0.9.2) | `@browsers-cli/se-cli@0.9.2` | 2026-08-06 |

### Dependency Update Workflow

- `dep-update.yml` pushes a branch (e.g., `deps/selenium-webdriver-4.46.0`) and creates an Issue — it does NOT create PRs (GitHub Actions lacks permission)
- Uses `git push --force` and `git checkout -B` to reset existing branches
- Checks for existing open Issues with the same title before creating new ones

## Coding Conventions

### File Organization

- **Tool modules**: One file per functionality in `src/daemon/tools/` (e.g., `storage.ts`, `tab.ts`, `state.ts`)
- **Command routing**: Add new commands via the routing pattern in `program.ts`
- **Test files**: Unit tests in `tests/unit/`, integration tests in `tests/integration/`
- **Test fixtures (dual mirror)**: HTML pages live in `tests/integration/fixtures/` (local source, served by `test-server.ts`); mirror them to the unified site's `static/test-pages/` (see `se-cli/se-site`) with `npm run test-pages:sync`. For manual/local runs use `npm run test-pages:serve`.
- **Documentation**: Markdown-based docs live in the unified site repo `se-cli/se-site` (Docusaurus). This repo keeps only `README.md`, `docs/spec.md`, and `docs/plan.md`.

### Testing

- **Unit tests**: Use Vitest. Mock external dependencies (WebDriver, filesystem).
- **Integration tests**: Require `SE_CLI_E2E=1` environment variable. Start a daemon, send commands, verify behavior.
- **Test cleanup**: Integration tests must clean up daemon processes. Use 15s timeout with `kill-all` fallback.
- **When adding a new feature**: Add unit tests, integration tests, test pages (fixture + site mirror via `npm run test-pages:sync`), and update documentation (`README.md`, `skill/SKILL.md`, `docs/spec.md`, and the unified site `se-cli/se-site`).

### Test Coverage

Code coverage is enforced via thresholds in `vitest.config.ts`. PRs will fail CI if thresholds are not met.

- **Minimum thresholds**:

  | Metric | Threshold |
  |--------|-----------|
  | Statements | 95% |
  | Branches | 90% |
  | Functions | 95% |
  | Lines | 95% |

- **Run coverage locally**: `npm run test:coverage` (alias: `npx vitest run tests/unit --coverage`)
- **Coverage reports**: Generated in `coverage/` directory (text, html, lcov formats)
- **Excluded from coverage** (not counted toward thresholds):
  - `src/**/*.d.ts` — type declarations
  - `src/snapshot/aria-snapshot.ts` — injected browser script
  - `src/cli.ts` — CLI entry point, thin wrapper
  - `src/protocol.ts` — type definitions only
  - `src/daemon/server.ts` — socket server, covered by integration tests
- **When adding new code**: Ensure new source files have corresponding unit tests. Run `npm run test:coverage` before submitting a PR to verify thresholds are met.

### npm Package

- Published as `@browsers-cli/se-cli` with provenance enabled
- **npm URL**: `https://www.npmjs.com/package/@browsers-cli/se-cli`
- Install: `npm install -g @browsers-cli/se-cli`
- `package.json` `files` array must include `skill/` directory (ensures `SKILL.md` is available after npm install)
- Binary names: `se-cli`, `se`, `selenium-cli` (all point to `dist/cli.js`)

## PR Workflow

### Fork-based PRs

When contributing from a fork:

1. **Always rebase onto `upstream/main`** before pushing your branch:
   ```bash
   git fetch upstream
   git rebase --onto upstream/main <old-base-commit> <your-branch>
   ```
2. **Verify no fork URLs in diff** before pushing:
   ```bash
   git diff upstream/main..HEAD | grep -i "alaahong\|<your-fork-name>"
   # This should return nothing
   ```
3. **Force push** after rebasing:
   ```bash
   git push origin <your-branch> --force
   ```

### Commit Messages

Follow conventional commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or correcting tests
- `ci:` CI configuration changes
- `chore:` maintenance tasks

### Before Submitting

- Run `npx tsc --noEmit` (type check)
- Run `npm run test:coverage` (unit tests + coverage — must meet 95% thresholds)
- Ensure no personal fork URLs in any changed file
- Ensure `package.json` version is not accidentally changed (unless intentional)

## Lessons Learned

- **Jest vs Vitest**: Using Jest-specific options (like `--filter`) with Vitest causes CACError failures. Always use Vitest's path-based filtering.
- **execFileSync deadlock**: `execFileSync` blocks the event loop, causing deadlocks in daemon scenarios. Use asynchronous `execFile` (promisified) instead.
- **Firefox session files**: Firefox CI jobs must not delete session files during `shutdown()` to prevent race conditions with new daemon sessions.
- **Firefox cookies**: Firefox requires `secure=true` for `SameSite=None` cookies during state load.
- **Chrome CI DLL errors**: Windows Chrome CI jobs may fail with `0xC0000142` (STATUS_DLL_INIT_FAILED) due to chromedriver DLL initialization. Re-running the job typically resolves it.
- **koa-connect wrapper**: Caused `ctx` leaks. Use native Koa middleware instead of wrapping Express middleware.
- **dep-update.yml**: Pushing to an existing remote branch causes non-fast-forward errors. Use `git push --force` and `git checkout -B`. Check for existing open Issues before creating new ones.
