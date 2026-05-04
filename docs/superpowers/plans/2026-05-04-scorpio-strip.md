# Scorpio Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip scorpio to its unique Theia features (workspace-root auto-clone, env strategy, settings protection, git identity fallback) plus auth infrastructure, deleting all duplicate features.

**Architecture:** Delete all user-facing UI (sidebar, course/exercise pickers, submit, repo detection, websocket, UML, realtime sync), the webview app, shared models, and tests. Rewrite extension.ts to only wire up the kept services. Edit retained files to remove dead imports/functions. Update build config (package.json, tsconfig, webpack) for Node-only.

**Tech Stack:** TypeScript, VS Code Extension API, simple-git, webpack

**Spec:** `docs/superpowers/specs/2026-05-04-scorpio-strip-design.md`

---

### Task 1: Delete all removed source files and directories

**Files:**
- Delete: `src/sidebar/` (entire directory)
- Delete: `src/course/` (entire directory)
- Delete: `src/exercise/` (entire directory)
- Delete: `src/problemStatement/` (entire directory)
- Delete: `src/utils/` (entire directory)
- Delete: `src/test/` (entire directory)
- Delete: `webview/` (entire directory)
- Delete: `src/shared/state.ts`
- Delete: `src/shared/repository.service.ts`
- Delete: `src/shared/websocket.ts`
- Delete: `src/participation/realtime-sync.service.ts`
- Delete: `src/participation/realtime.handlers.ts`
- Delete: `src/artemis/course.client.ts`
- Delete: `src/artemis/exercise.client.ts`
- Delete: `src/artemis/participation.client.ts`
- Delete: `src/artemis/problem-statement.client.ts`
- Delete: `shared/webview-commands.ts`
- Delete: `shared/models/course.model.ts`
- Delete: `shared/models/exercise.model.ts`
- Delete: `shared/models/feedback.model.ts`
- Delete: `shared/models/participation.model.ts`
- Delete: `shared/models/result.model.ts`
- Delete: `shared/models/submission.model.ts`
- Delete: `shared/models/testcase.model.ts`
- Delete: `media/artemis_logo.png`
- Delete: `media/artemis_logo.svg`
- Delete: `media/icon2.png`
- Delete: `media/icon2.svg`

- [ ] **Step 1: Delete directories**

```bash
rm -rf src/sidebar src/course src/exercise src/problemStatement src/utils src/test webview
```

- [ ] **Step 2: Delete individual source files**

```bash
rm src/shared/state.ts src/shared/repository.service.ts src/shared/websocket.ts
rm src/participation/realtime-sync.service.ts src/participation/realtime.handlers.ts
rm src/artemis/course.client.ts src/artemis/exercise.client.ts src/artemis/participation.client.ts src/artemis/problem-statement.client.ts
```

- [ ] **Step 3: Delete shared models and webview protocol**

```bash
rm shared/webview-commands.ts
rm shared/models/course.model.ts shared/models/exercise.model.ts shared/models/feedback.model.ts shared/models/participation.model.ts shared/models/result.model.ts shared/models/submission.model.ts shared/models/testcase.model.ts
```

After deleting all model files, remove the now-empty directories:

```bash
rmdir shared/models shared
```

- [ ] **Step 4: Delete unused media files**

```bash
rm media/artemis_logo.png media/artemis_logo.svg media/icon2.png media/icon2.svg
```

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "Delete all stripped source files, shared models, webview, and unused media"
```

---

### Task 2: Rewrite extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Replace entire contents of `src/extension.ts`**

```typescript
import * as vscode from "vscode";
import { ArtemisAuthenticationProvider, AUTH_ID } from "./authentication/authentication_provider";
import { initTheia, loadTheiaEnv, theiaEnv } from "./theia/theia";
import { initSettings } from "./shared/settings";

export async function activate(context: vscode.ExtensionContext) {
  await loadTheiaEnv();
  await initTheia();
  initSettings();

  const authProvider = new ArtemisAuthenticationProvider(context.secrets);
  context.subscriptions.push(authProvider);

  let session = await vscode.authentication.getSession(AUTH_ID, [], { silent: true });
  if (!session && theiaEnv.ARTEMIS_TOKEN !== undefined) {
    session = await authProvider.createSession([]);
  }
  vscode.commands.executeCommand("setContext", "scorpio.authenticated", session !== undefined);

  authProvider.onAuthSessionsChange.event(({ added, removed }) => {
    if (added && added.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", true);
    }
    if (removed && removed.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", false);
    }
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("scorpio.artemis.apiBaseUrl")) {
        return;
      }
      if (theiaEnv.ARTEMIS_URL) {
        return;
      }
      await authProvider.removeSession();
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.login", async () => {
      try {
        const session = await vscode.authentication.getSession(AUTH_ID, [], {
          createIfNone: true,
        });
        if (!session) {
          vscode.window.showErrorMessage("Login failed");
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to login: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.logout", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Sign out from Artemis - Scorpio",
        { modal: true },
        "Sign out",
      );
      if (choice === "Sign out") {
        await authProvider.removeSession();
      }
    }),
  );
}

export function deactivate() {}
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "Rewrite extension.ts: keep only auth, theia init, and three commands"
```

---

### Task 3: Edit settings.ts (remove circular dep, easter egg, restart logic)

**Files:**
- Modify: `src/shared/settings.ts`

- [ ] **Step 1: Replace entire contents of `src/shared/settings.ts`**

```typescript
import * as vscode from "vscode";
import { theiaEnv } from "../theia/theia";

export type Settings = {
  base_url: string | undefined;
  default_repo_path: string | undefined;
};

export var settings: Settings;

export function initSettings() {
  settings = getSettings();

  vscode.workspace.onDidChangeConfiguration((e) => {
    handleSettingsChange(e);
  });
}

function getSettings(): Settings {
  let base_url = vscode.workspace.getConfiguration("scorpio").get<string>("artemis.apiBaseUrl");
  if (theiaEnv.ARTEMIS_URL) {
    const config = vscode.workspace.getConfiguration("scorpio");
    config.update("artemis.apiBaseUrl", theiaEnv.ARTEMIS_URL, vscode.ConfigurationTarget.Global);
    base_url = theiaEnv.ARTEMIS_URL;
  }

  if (!base_url) {
    vscode.window.showErrorMessage("Artemis Base URL not set. Please set it in the settings.");
  }

  const default_repo_path = vscode.workspace
    .getConfiguration("scorpio")
    .get<string>("defaults.repoPath");

  return {
    base_url: base_url,
    default_repo_path: default_repo_path,
  };
}

function handleSettingsChange(e: vscode.ConfigurationChangeEvent) {
  if (e.affectsConfiguration("scorpio.artemis.apiBaseUrl")) {
    if (theiaEnv.ARTEMIS_URL) {
      console.warn("Artemis URL can not be changed in theia environment");
      const config = vscode.workspace.getConfiguration("scorpio");
      config.update("artemis.apiBaseUrl", settings.base_url, vscode.ConfigurationTarget.Global);
      return;
    }

    const base_url = vscode.workspace.getConfiguration("scorpio").get<string>("artemis.apiBaseUrl");
    if (!base_url) {
      vscode.window.showErrorMessage("Artemis Base URL not set. Please set it in the settings.");
    }
    settings.base_url = base_url;
  }

  if (e.affectsConfiguration("scorpio.defaults.repoPath")) {
    if (theiaEnv.THEIA_FLAG) {
      console.warn("Default repository path can not be changed in theia environment");
      const config = vscode.workspace.getConfiguration("scorpio");
      config.update(
        "defaults.repoPath",
        settings.default_repo_path,
        vscode.ConfigurationTarget.Global,
      );
      return;
    }

    const default_repo_path = vscode.workspace
      .getConfiguration("scorpio")
      .get<string>("defaults.repoPath");
    settings.default_repo_path = default_repo_path;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/settings.ts
git commit -m "Strip settings.ts: remove circular dep, easter egg, and restart logic"
```

---

### Task 4: Edit cloning.service.ts (remove cloneUserRepo and dead imports)

**Files:**
- Modify: `src/participation/cloning.service.ts`

- [ ] **Step 1: Replace entire contents of `src/participation/cloning.service.ts`**

Keep only `cloneByGivenURL`, `cloneIntoWorkspaceRoot`, and all helpers. Remove `cloneUserRepo` and its imports.

```typescript
import simpleGit from "simple-git";
import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";

type CloneMode = "subdirectory" | "workspace-root";

type CloneOptions = {
  mode?: CloneMode;
  preservedPaths?: string[];
};

type PreservedWorkspaceEntry = {
  relativePath: string;
  backupPath: string;
  isDirectory: boolean;
};

const THEIA_PRESERVED_PATHS = [".vscode/settings.json", ".theia", "persisted", "lost+found"];

export async function cloneByGivenURL(
  cloneUrl: URL,
  destinationPath: string,
  options?: CloneOptions,
): Promise<string> {
  if (options?.mode === "workspace-root") {
    return cloneIntoWorkspaceRoot(
      cloneUrl,
      destinationPath,
      options.preservedPaths ?? THEIA_PRESERVED_PATHS,
    );
  }

  const repoName = path.basename(cloneUrl.pathname, ".git");
  const clonePath = path.join(destinationPath, repoName);

  const gitForClone = simpleGit(destinationPath);

  try {
    await gitForClone.clone(cloneUrl.toString(), clonePath);
  } catch (e: any) {
    throw new Error(`Error cloning repository: ${e.message}`);
  }

  return clonePath;
}

async function cloneIntoWorkspaceRoot(
  cloneUrl: URL,
  workspacePath: string,
  preservedPaths: string[] = [],
): Promise<string> {
  const backupRoot = await fs.mkdtemp(path.join(tmpdir(), "scorpio-workspace-clone-"));
  const preservedEntries = await movePreservedWorkspaceEntries(
    workspacePath,
    preservedPaths,
    backupRoot,
  );

  let cloneSucceeded = false;
  let restoredEntries: PreservedWorkspaceEntry[] = [];

  try {
    await clearDirectory(workspacePath);

    const gitForClone = simpleGit(workspacePath);
    await gitForClone.clone(cloneUrl.toString(), ".");
    cloneSucceeded = true;

    return workspacePath;
  } catch (e: any) {
    throw new Error(`Error cloning repository into workspace root: ${e.message}`);
  } finally {
    restoredEntries = await restorePreservedWorkspaceEntries(workspacePath, preservedEntries);

    if (cloneSucceeded) {
      await addEntriesToGitExclude(workspacePath, restoredEntries);
    }

    await fs.rm(backupRoot, { recursive: true, force: true });
  }
}

async function movePreservedWorkspaceEntries(
  workspacePath: string,
  preservedPaths: string[],
  backupRoot: string,
): Promise<PreservedWorkspaceEntry[]> {
  const preservedEntries: PreservedWorkspaceEntry[] = [];

  for (const relativePath of preservedPaths) {
    const sourcePath = path.join(workspacePath, relativePath);
    const sourceStats = await safeStat(sourcePath);
    if (!sourceStats) {
      continue;
    }

    const backupPath = path.join(backupRoot, relativePath);
    await ensureParentDirectory(backupPath);
    await copyPath(sourcePath, backupPath, sourceStats.isDirectory());
    await fs.rm(sourcePath, { recursive: true, force: true });

    preservedEntries.push({
      relativePath,
      backupPath,
      isDirectory: sourceStats.isDirectory(),
    });
  }

  return preservedEntries;
}

async function restorePreservedWorkspaceEntries(
  workspacePath: string,
  preservedEntries: PreservedWorkspaceEntry[],
): Promise<PreservedWorkspaceEntry[]> {
  const restoredEntries: PreservedWorkspaceEntry[] = [];

  for (const entry of preservedEntries) {
    const targetPath = path.join(workspacePath, entry.relativePath);
    const targetStats = await safeStat(targetPath);

    if (!targetStats) {
      await ensureParentDirectory(targetPath);
      await copyPath(entry.backupPath, targetPath, entry.isDirectory);
      restoredEntries.push(entry);
    }

    await fs.rm(entry.backupPath, { recursive: true, force: true });
  }

  return restoredEntries;
}

async function addEntriesToGitExclude(
  workspacePath: string,
  restoredEntries: PreservedWorkspaceEntry[],
): Promise<void> {
  if (restoredEntries.length === 0) {
    return;
  }

  const excludePath = path.join(workspacePath, ".git", "info", "exclude");
  const existingContent = await fs.readFile(excludePath, "utf8").catch(() => "");
  const existingEntries = new Set(existingContent.split(/\r?\n/).filter(Boolean));
  const newEntries = restoredEntries.map((entry) =>
    entry.isDirectory
      ? `${normalizeGitPath(entry.relativePath)}/`
      : normalizeGitPath(entry.relativePath),
  );

  let hasChanges = false;
  for (const entry of newEntries) {
    if (!existingEntries.has(entry)) {
      existingEntries.add(entry);
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return;
  }

  await ensureParentDirectory(excludePath);
  const nextContent = `${Array.from(existingEntries).join("\n")}\n`;
  await fs.writeFile(excludePath, nextContent, "utf8");
}

async function clearDirectory(directoryPath: string): Promise<void> {
  const entries = await fs.readdir(directoryPath);
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(directoryPath, entry), { recursive: true, force: true }),
    ),
  );
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyPath(
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
  } else {
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function safeStat(targetPath: string) {
  try {
    return await fs.lstat(targetPath);
  } catch {
    return undefined;
  }
}

function normalizeGitPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/participation/cloning.service.ts
git commit -m "Strip cloning.service.ts: remove cloneUserRepo and dead imports"
```

---

### Task 5: Add idempotence guard to theia.ts

**Files:**
- Modify: `src/theia/theia.ts`

- [ ] **Step 1: Replace entire contents of `src/theia/theia.ts`**

```typescript
import * as vscode from "vscode";
import simpleGit, { GitConfigScope } from "simple-git";
import { hostname } from "os";
import * as path from "path";
import { cloneByGivenURL } from "../participation/cloning.service";
import { createTheiaEnvStrategy, TheiaEnv } from "./env-strategy";

export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_TOKEN: undefined,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  GIT_USER: undefined,
  GIT_MAIL: undefined,
};

export async function loadTheiaEnv(): Promise<void> {
  const strategy = await createTheiaEnvStrategy();
  theiaEnv = await strategy.load();
}

export function getWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.at(0)?.uri;
}

function normalizeRepoUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    let normalized = url.origin.toLowerCase() + url.pathname;
    normalized = normalized.replace(/\.git\/?$/, "");
    normalized = normalized.replace(/\/+$/, "");
    return normalized;
  } catch {
    return raw;
  }
}

async function isRepoAlreadyCloned(workspacePath: string, targetUri: URL): Promise<boolean> {
  const gitPath = path.join(workspacePath, ".git");
  try {
    await import("fs/promises").then((fs) => fs.stat(gitPath));
  } catch {
    return false;
  }

  try {
    const git = simpleGit(workspacePath);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin?.refs.fetch) {
      return false;
    }
    return normalizeRepoUrl(origin.refs.fetch) === normalizeRepoUrl(targetUri.toString());
  } catch {
    return false;
  }
}

export async function initTheia() {
  if (theiaEnv.GIT_URI) {
    vscode.commands.executeCommand("setContext", "scorpio.theia.givenExercise", true);
  }

  if (theiaEnv.GIT_URI) {
    const workspaceFolderUri = getWorkspaceFolder();
    if (!workspaceFolderUri) {
      vscode.window.showErrorMessage("No workspace folder available to clone repository");
      return;
    }

    const alreadyCloned = await isRepoAlreadyCloned(
      workspaceFolderUri.fsPath,
      theiaEnv.GIT_URI,
    );
    if (alreadyCloned) {
      console.log("Repository already present, skipping auto-clone");
    } else {
      await cloneByGivenURL(theiaEnv.GIT_URI, workspaceFolderUri.fsPath, {
        mode: "workspace-root",
      });
    }
  }

  if (theiaEnv.THEIA_FLAG) {
    try {
      const git = simpleGit();
      const hostnameConst = hostname();
      theiaEnv.GIT_USER = theiaEnv.GIT_USER ? theiaEnv.GIT_USER : hostnameConst;
      theiaEnv.GIT_MAIL = theiaEnv.GIT_MAIL
        ? theiaEnv.GIT_MAIL
        : theiaEnv.GIT_USER
          ? theiaEnv.GIT_USER + "@artemis-theia.de"
          : hostnameConst + "@artemis-theia.de";

      await git.addConfig("user.name", theiaEnv.GIT_USER, undefined, GitConfigScope.global);
      await git.addConfig("user.email", theiaEnv.GIT_MAIL, undefined, GitConfigScope.global);
    } catch (e: any) {
      console.error(`Error setting git config: ${e.message}`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/theia/theia.ts
git commit -m "Add idempotence guard: skip auto-clone if repo already matches GIT_URI"
```

---

### Task 6: Edit env-strategy.ts (required vs optional keys, THEIA_FLAG auto-set)

**Files:**
- Modify: `src/theia/env-strategy.ts`

- [ ] **Step 1: Edit `parseTheiaEnv` to accept an optional `fromDataBridge` parameter**

Replace the `parseTheiaEnv` function (lines 26-36):

```typescript
function parseTheiaEnv(
  env: Record<string, string | undefined>,
  fromDataBridge: boolean = false,
): TheiaEnv {
  const gitUriString = env["GIT_URI"];
  const hasRequiredKeys = !!(env["ARTEMIS_TOKEN"] && env["ARTEMIS_URL"] && gitUriString);
  return {
    THEIA_FLAG: env["THEIA"] !== undefined || (fromDataBridge && hasRequiredKeys),
    ARTEMIS_TOKEN: env["ARTEMIS_TOKEN"],
    ARTEMIS_URL: env["ARTEMIS_URL"],
    GIT_URI: gitUriString ? new URL(gitUriString) : undefined,
    GIT_USER: env["GIT_USER"],
    GIT_MAIL: env["GIT_MAIL"],
  };
}
```

- [ ] **Step 2: Add required keys constant and update poll completion condition**

Add after `ENV_KEYS` (after line 20):

```typescript
const REQUIRED_ENV_KEYS = ["ARTEMIS_TOKEN", "ARTEMIS_URL", "GIT_URI"] as const;
```

Then replace the completion condition in `pollForEnvironmentVariables` (line 124):

Replace:
```typescript
      if (ENV_KEYS.every((key) => Boolean(env[key]))) {
        this.outputChannel.appendLine("Environment variables received from bridge");
        return parseTheiaEnv(env);
      }
```

With:
```typescript
      if (REQUIRED_ENV_KEYS.every((key) => Boolean(env[key]))) {
        this.outputChannel.appendLine("Environment variables received from bridge");
        return parseTheiaEnv(env, true);
      }
```

- [ ] **Step 3: Update the timeout fallback to also pass `fromDataBridge: false`**

The existing `return new ProcessEnvStrategy().load();` on line 138 is already correct (ProcessEnvStrategy calls `parseTheiaEnv(env)` which defaults `fromDataBridge` to `false`). No change needed.

- [ ] **Step 4: Commit**

```bash
git add src/theia/env-strategy.ts
git commit -m "DataBridge: only require ARTEMIS_TOKEN/URL/GIT_URI, auto-set THEIA_FLAG"
```

---

### Task 7: Edit authentication.client.ts (remove dead VCS token functions)

**Files:**
- Modify: `src/artemis/authentication.client.ts`

- [ ] **Step 1: Replace entire contents of `src/artemis/authentication.client.ts`**

```typescript
import { artemisRequest } from "../infra/http/artemis-http.client";

export async function authenticateToken(
  username: string,
  password: string,
): Promise<{ access_token: string }> {
  const response = await artemisRequest("/api/core/public/authenticate", {
    method: "POST",
    query: { tool: "SCORPIO" },
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
      rememberMe: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP error with status: ${response.status} ${errorText}`);
  }

  return response.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/artemis/authentication.client.ts
git commit -m "Remove dead retrieveVcsAccessToken from authentication client"
```

---

### Task 8: Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace entire contents of `package.json`**

```json
{
  "name": "artemis-scorpio",
  "displayName": "Artemis - Scorpio",
  "version": "0.0.0",
  "description": "",
  "private": true,
  "categories": [
    "Other"
  ],
  "bugs": {
    "url": "https://github.com/EduIDE/scorpio/issues"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/EduIDE/scorpio.git"
  },
  "publisher": "tum-aet",
  "main": "./dist/extension.js",
  "scripts": {
    "install:all": "npm install --no-scripts",
    "build": "webpack --mode production",
    "watch": "webpack --watch",
    "install:extension": "npm install --no-scripts",
    "build:extension": "webpack --mode production",
    "compile:extension": "webpack",
    "watch:extension": "webpack --watch",
    "lint": "eslint src",
    "package": "vsce package",
    "vscode:prepublish": "npm run build",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check"
  },
  "dependencies": {
    "simple-git": "^3.27.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.94.0",
    "@typescript-eslint/eslint-plugin": "^8.9.0",
    "@typescript-eslint/parser": "^8.9.0",
    "@vscode/vsce": "^3.1.1",
    "eslint": "^9.39.3",
    "oxfmt": "^0.31.0",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4",
    "webpack": "^5.93.0",
    "webpack-cli": "^5.1.4"
  },
  "contributes": {
    "authentication": [
      {
        "id": "artemis",
        "label": "Credentials"
      }
    ],
    "configuration": {
      "title": "Scorpio - Artemis",
      "properties": {
        "scorpio.artemis.apiBaseUrl": {
          "order": 1,
          "description": "The base URL of the Artemis Server",
          "type": "string",
          "format": "uri",
          "editPresentation": "singlelineText",
          "default": "https://artemis.cit.tum.de"
        },
        "scorpio.defaults.repoPath": {
          "order": 3,
          "description": "The default to search for and clone repositories into - has to be an absolute path",
          "editPresentation": "singlelineText",
          "type": "string",
          "format": "path"
        }
      }
    },
    "commands": [
      {
        "command": "scorpio.restart",
        "category": "Scorpio",
        "title": "Restart Extension"
      },
      {
        "command": "scorpio.login",
        "category": "Scorpio",
        "title": "Login"
      },
      {
        "command": "scorpio.logout",
        "category": "Scorpio",
        "title": "Logout"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "scorpio.login",
          "when": "!scorpio.authenticated"
        },
        {
          "command": "scorpio.logout",
          "when": "scorpio.authenticated"
        }
      ]
    }
  },
  "activationEvents": [
    "onStartupFinished"
  ],
  "extensionKind": [
    "workspace"
  ],
  "icon": "media/icon.png",
  "engines": {
    "vscode": "^1.95.0"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "Strip package.json: remove unused deps, views, commands, menus, browser config"
```

---

### Task 9: Update tsconfig.json

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Replace entire contents of `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2020",
    "outDir": "dist",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedParameters": true,
    "noUnusedLocals": true,
    "noImplicitThis": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "tsconfig: remove shared aliases, WebWorker lib, webview exclude"
```

---

### Task 10: Update webpack.config.js

**Files:**
- Modify: `webpack.config.js`

- [ ] **Step 1: Replace entire contents of `webpack.config.js`**

```javascript
//@ts-check
"use strict";

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require("path");

/** @type WebpackConfig */
const extensionConfig = {
  mode: "none",
  target: "node",
  entry: {
    extension: "./src/extension.ts",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "dist"),
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    mainFields: ["main", "module"],
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
  externals: {
    vscode: "commonjs vscode",
  },
  performance: {
    hints: false,
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [extensionConfig];
```

- [ ] **Step 2: Commit**

```bash
git add webpack.config.js
git commit -m "webpack: Node-only config, remove browser polyfills, test entry, plugins"
```

---

### Task 11: Clean install, build, lint

**Files:** None (verification only)

- [ ] **Step 1: Regenerate lockfile and install**

```bash
rm -rf node_modules dist package-lock.json && npm install
```

- [ ] **Step 2: Build**

```bash
npm run build:extension
```

Expected: successful webpack build with no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no errors. If there are warnings from naming conventions, fix them.

- [ ] **Step 4: Verify dist output**

```bash
ls -la dist/extension.js
```

Expected: single bundled file exists.

- [ ] **Step 5: Commit lockfile**

```bash
git add package-lock.json
git commit -m "Regenerate package-lock.json after dependency cleanup"
```

- [ ] **Step 6: Manual verification checklist**

These cannot be automated in this plan. Verify each manually:

1. **Theia auto-clone**: In a Theia/EduIDE environment with `GIT_URI` set, confirm the repository is cloned into the workspace root (not a subdirectory), `.theia`/`persisted`/`lost+found` are preserved, and `.git/info/exclude` contains restored entries.
2. **Idempotence guard**: Reload the extension (Cmd+Shift+P > "Developer: Reload Window") with an existing cloned repo. Confirm the extension host log shows "Repository already present, skipping auto-clone" and the workspace is NOT wiped.
3. **VS Code Desktop login/logout**: Open command palette, run "Scorpio: Login", enter credentials, confirm `scorpio.authenticated` context is set. Then run "Scorpio: Logout", confirm session is cleared.
4. **Extension host errors**: Open Output panel > "Extension Host" channel. Confirm no errors from scorpio on activation.
