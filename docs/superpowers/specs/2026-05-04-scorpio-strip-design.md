# Scorpio Strip: Remove Feature Duplicates for Parallel Installation

**Date:** 2026-05-04
**Status:** Approved (codex-reviewed)
**PR Target:** `main` (scorpio has no `dev` branch)

## Problem

The scorpio VS Code extension and the artemis-extension (Iris Thaumantias) share many features: authentication, exercise browsing, sidebar UI, repository cloning, submission, WebSocket real-time sync, problem statement display, and UML rendering. Both extensions must be installable side-by-side in the same VS Code / Theia instance without runtime conflicts. Scorpio will be repurposed later for a different use case (TBD).

## Decision

Strip scorpio down to its unique features (things artemis-extension does not provide) plus authentication infrastructure. Everything else gets deleted.

## Features Retained

### 1. Workspace-Root Auto-Clone with Path Preservation

**Source:** `src/theia/theia.ts`, `src/participation/cloning.service.ts`

In Theia/EduIDE, the exercise repository must live at the workspace root (`/home/project`), not in a subdirectory. Artemis-extension clones into `workspaceRoot/repoName/`, which is wrong for Theia.

Scorpio's clone flow:
1. Backs up Theia-owned paths (`.vscode/settings.json`, `.theia`, `persisted`, `lost+found`) to a temp directory
2. Clears the workspace directory
3. Clones with `git clone <url> .` (repo becomes workspace root)
4. Restores backed-up paths only if the cloned repo does not provide them (repo content wins)
5. Adds restored paths to `.git/info/exclude`

**New: Idempotence guard.** Before cloning, check if `.git` already exists in the workspace and the normalized origin remote URL matches `GIT_URI`. If so, skip the clone. Only HTTPS URL forms are supported (Artemis/data-bridge only produces HTTPS URLs; SSH is out of scope). URL normalization:
- Strip userinfo (credentials)
- Remove `.git` suffix
- Remove trailing slashes
- Lowercase scheme and hostname
- Normalize default ports (remove `:443` for https, `:80` for http)

If `.git` exists as a file (worktree), treat it the same as a directory (read origin remote via simple-git). If no origin remote exists, proceed with clone. If URLs don't match, proceed with clone.

### 2. ProcessEnvStrategy (Env-Var Fallback)

**Source:** `src/theia/env-strategy.ts`

Reads Theia environment variables via two strategies:
- **DataBridgeStrategy:** Polls the `tum-aet.data-bridge` companion extension (500ms interval, 10s timeout). **Required keys:** `ARTEMIS_TOKEN`, `ARTEMIS_URL`, `GIT_URI`. **Optional keys:** `GIT_USER`, `GIT_MAIL` (hostname fallback exists). `THEIA` key: optional, but if the data-bridge strategy is active and returns required keys, `THEIA_FLAG` must be set to `true` regardless of whether the `THEIA` key was explicitly provided. Falls back to ProcessEnvStrategy on timeout or missing extension.
- **ProcessEnvStrategy:** Reads each variable via `exec("echo $VAR")`. Legacy fallback that artemis-extension deliberately does not implement (artemis-extension hard-fails when the bridge is unavailable).

Strategy selection via `SCORPIO_THEIA_ENV_STRATEGY` environment variable.

### 3. Settings Protection in Theia

**Source:** `src/shared/settings.ts`

In managed Theia environments, user-initiated config changes to `scorpio.artemis.apiBaseUrl` and `scorpio.defaults.repoPath` are reverted with a warning. Prevents students from accidentally breaking their environment.

### 4. Git Identity with Hostname Fallback

**Source:** `src/theia/theia.ts` (lines 48-65)

Sets global git `user.name` and `user.email` from environment variables. Falls back to `os.hostname()` for user name and `{hostname}@artemis-theia.de` for email. Artemis-extension sets per-repo config without fallback.

### 5. Authentication

**Source:** `src/authentication/authentication_provider.ts`, `src/artemis/authentication.client.ts`, `src/infra/http/artemis-http.client.ts`

VS Code Authentication Provider (ID: `"artemis"`). Login dialog for non-Theia, auto-session from `ARTEMIS_TOKEN` in Theia. SecretStorage persistence. Retained for potential future use when scorpio is repurposed.

**Known risk:** Auth provider ID `"artemis"` does not collide today (artemis-extension uses its own AuthManager, not the VS Code Auth API). If artemis-extension ever registers an `"artemis"` auth provider, this will need renaming.

## Files Retained (with changes)

### `src/extension.ts` (rewrite)

New activate() flow:
1. `loadTheiaEnv()` - load environment variables
2. `initTheia()` - auto-clone if GIT_URI set (with idempotence guard)
3. `initSettings()` - load configuration
4. Initialize auth provider, attempt silent session, create from token if in Theia
5. Register config change listener for base-URL changes: **skip if `theiaEnv.ARTEMIS_URL` is set** (Theia protection in settings.ts handles that case). Otherwise, invalidate auth session and trigger window reload.
6. Register commands: `scorpio.restart` (calls `workbench.action.reloadWindow`), `scorpio.login`, `scorpio.logout`

The `authenticationProvider` variable is no longer exported. Session invalidation on URL change moves from `settings.ts` into `extension.ts` (registered after auth init, guarded against Theia).

### `src/participation/cloning.service.ts` (edit)

Remove `cloneUserRepo()` and its imports (`settings`, `AUTH_ID`, `NotAuthenticatedError`, `getState`, `retrieveVcsAccessToken`, `addVcsTokenToUrl`). Keep `cloneByGivenURL()`, `cloneIntoWorkspaceRoot()`, and all helper functions (backup/restore/exclude/clear).

### `src/shared/settings.ts` (edit)

- Remove import of `authenticationProvider` from `extension.ts` (breaks circular dependency)
- Remove `easter_egg` field and `scorpio.?` handling
- Remove `authenticationProvider.removeSession()` call from URL-change handler (moved to extension.ts)
- Remove the `scorpio.restart` command execution from URL-change handler (extension.ts handles reload)
- Keep Theia protection logic (revert apiBaseUrl and repoPath changes)

### `src/theia/theia.ts` (edit)

Add idempotence guard in `initTheia()` before the clone call:
1. Check if workspace root contains `.git` (handle both directory and file/worktree)
2. If `.git` exists, read origin remote URL via `simple-git`
3. If no origin remote, proceed with clone
4. Normalize both `GIT_URI` and origin URL (HTTPS only, as specified above)
5. If normalized URLs match, skip clone and log "Repository already present, skipping auto-clone"
6. If no match, proceed with clone

### `src/theia/env-strategy.ts` (edit)

Modify `DataBridgeStrategy.pollForEnvironmentVariables()`:
- Change the completion condition: return as soon as required keys (`ARTEMIS_TOKEN`, `ARTEMIS_URL`, `GIT_URI`) are present. Do not wait for optional keys (`GIT_USER`, `GIT_MAIL`).
- In `parseTheiaEnv()`: if the strategy is DataBridge and required keys were received, set `THEIA_FLAG` to `true` even if the `THEIA` env var was not explicitly provided.

### `src/artemis/authentication.client.ts` (edit)

Remove `retrieveVcsAccessToken()` and `getVcsAccessToken()` (dead code after `cloneUserRepo` removal). Keep `authenticateToken()`.

### Files retained as-is

- `src/authentication/authentication_provider.ts`
- `src/authentication/not_authenticated.error.ts`
- `src/infra/http/artemis-http.client.ts`

## Files Deleted

### Entire directories
- `src/sidebar/` (sidebarProvider.ts, getNonce.ts, getUri.ts)
- `src/course/` (course.ts)
- `src/exercise/` (exercise.ts)
- `src/problemStatement/` (problem_statement.ts, uml.service.ts, uml.db.ts)
- `src/utils/` (filetree.ts)
- `src/test/` (extension.test.ts, index.ts)
- `webview/` (entire Angular sidebar app)

### Individual files
- `src/shared/state.ts` - in-memory state management (only used by removed features)
- `src/shared/repository.service.ts` - repo detection + submit
- `src/shared/websocket.ts` - STOMP WebSocket client
- `src/participation/realtime-sync.service.ts` - realtime sync + polling fallback
- `src/participation/realtime.handlers.ts` - result/submission message handlers
- `src/artemis/course.client.ts` - course API
- `src/artemis/exercise.client.ts` - exercise API
- `src/artemis/participation.client.ts` - participation API
- `src/artemis/problem-statement.client.ts` - problem statement API

### Shared models and webview protocol
- `shared/webview-commands.ts`
- `shared/models/course.model.ts`
- `shared/models/exercise.model.ts`
- `shared/models/feedback.model.ts`
- `shared/models/participation.model.ts`
- `shared/models/result.model.ts`
- `shared/models/submission.model.ts`
- `shared/models/testcase.model.ts`

(All shared model files are only imported by deleted source files. `authenticateToken` does not reference any shared models.)

### Media files
- `media/artemis_logo.png`
- `media/artemis_logo.svg`
- `media/icon2.png`
- `media/icon2.svg`

Keep `media/icon.png` and `media/icon.svg` (referenced by package.json).

## package.json Changes

### Added
- `"private": true` (prevent accidental publishing)

### Removed from contributes
- `viewsContainers` (entire section)
- `views` (entire section)
- `commands`: remove `scorpio.displayExercise`, `scorpio.displayedExercise.back`, `scorpio.displayedExercise.clone`, `scorpio.workspace.submit`, `scorpio.workspace.detectRepo`, `scorpio.workspace.sync`, `scorpio.sidebar.refresh`
- `menus`: remove all entries except login/logout in commandPalette. Remove `editor/title` and `view/title` sections entirely.
- `configuration.properties`: remove `scorpio.?`

### Removed from dependencies
- `@stomp/stompjs`, `sockjs-client`, `ws`, `fetch-cookie`, `markdown-it`, `uuid`, `os-browserify`, `path-browserify`
- `@vscode/vsce` (move to devDependencies)
- `ts-node` (move to devDependencies)

### Removed from devDependencies
- `@types/sockjs-client`, `@types/stompjs`, `@types/ws`, `@vscode/test-web`
- `@types/assert`, `@types/mocha`, `@types/webpack-env`
- `assert`, `process`, `html-loader`, `raw-loader`, `dotenv`, `mocha`

### Added to devDependencies
- `@types/node`
- `@vscode/vsce` (moved from dependencies)
- `ts-node` (moved from dependencies)

### Removed from extensionDependencies
- `vscode.git` (only `simple-git` is used, not the VS Code Git API)

### Other
- Remove `browser` field (no longer a web extension)
- Change `extensionKind` from `["ui", "workspace"]` to `["workspace"]`
- Remove scripts: `install:webview`, `build:webview`, `watch:webview`, `test`, `pretest`, `run-in-browser`, `open-in-browser`
- Update composite scripts: `install:all` becomes just `npm install --no-scripts`, `build` becomes just `webpack --mode production`, `watch` becomes just `webpack --watch`

## tsconfig.json Changes

- Remove `@shared/*` and `@shared/models/*` path aliases (all shared files deleted)
- Remove `"shared/**/*"` from `include`
- Change `lib` from `["ES2020", "WebWorker"]` to `["ES2020"]` (Node-only extension)
- Remove `"webview"` from `exclude` (webview deleted)

## webpack.config.js Changes

- Remove `"test/suite/index"` entry (test directory deleted)
- Remove entire `resolve.fallback` block (including `crypto: false`, `assert`, `path`, `os`)
- Change `resolve.mainFields` from `["main", "module", "browser"]` to `["main", "module"]`
- Remove `resolve.alias` for `@shared` (shared directory deleted)
- Remove `LimitChunkCountPlugin` (web-extension-specific, not needed for Node)
- Remove `ProvidePlugin` for `process` shim
- Remove `externals` for `bufferutil` and `utf-8-validate` (ws dependencies, ws removed)
- Keep only `vscode: "commonjs vscode"` in externals
- Fix comment: target is `"node"`, not webworker

## package-lock.json

Must be regenerated after dependency changes: `rm -rf node_modules package-lock.json && npm install`

## Verification

After all changes:
1. `rm -rf node_modules dist package-lock.json && npm install && npm run build:extension` (clean build from scratch)
2. `npm run lint`
3. Manual test in Theia: verify auto-clone still works with GIT_URI
4. Manual test: reload extension with existing repo, verify idempotence guard skips clone
5. Manual test in VS Code Desktop: verify login/logout commands work
6. Verify no runtime errors in extension host output

## Follow-up Items (not in this PR)

- `git ls-remote` pre-check before workspace clear (safety improvement)
- Settings scope limitation: Theia protection only reverts Global scope, not Workspace scope overrides
- Evaluate renaming auth provider ID from `"artemis"` to `"scorpio-artemis"` when scorpio's new purpose is defined
- Port workspace-root clone to artemis-extension (if desired, separate PR against `dev`)
- Node test infrastructure for stripped extension
- Docs/README cleanup (README.md, README_DEVELOPER.md, vsc-extension-quickstart.md still describe deleted functionality)
