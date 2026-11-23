import * as vscode from "vscode";
import { GitConfigScope, simpleGit } from "simple-git";
import { hostname } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import {
  cloneByGivenURL,
  setOrigin,
  splitCredentials,
  storeCredentials,
  withCloneLock,
} from "../participation/cloning.service";
import {
  applyTemplate,
  DEFAULT_TEMPLATES_DIR,
  workspaceContent,
} from "../participation/template.service";
import { warmupGradleDaemon } from "../participation/gradle.service";
import { withWorkspaceProgress } from "./progress";
import { createTheiaEnvStrategy, DEFAULT_GRADLE_PREWARM, TheiaEnv } from "./env-strategy";

export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  GIT_REF: undefined,
  GIT_REF_INVALID: undefined,
  GIT_SOURCE: undefined,
  TEMPLATE: undefined,
  GIT_USER: undefined,
  GIT_MAIL: undefined,
  GRADLE_PREWARM: DEFAULT_GRADLE_PREWARM,
  GRADLE_PREWARM_AUTO_CONFIRM: false,
};

export async function loadTheiaEnv(): Promise<void> {
  const strategy = await createTheiaEnvStrategy();
  theiaEnv = await strategy.load();
}

export function getWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.at(0)?.uri;
}

// The ref comes from the environment, so keep markdown link syntax and long text out of a notification.
function refForDisplay(ref: string): string {
  return ref.replace(/[\[\]()`\r\n]/g, "").slice(0, 64);
}

function normalizeRepoUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // Host and path only: a changed scheme (ssh, http) or default port is still the same repository.
    let normalized = url.host.toLowerCase() + url.pathname;
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
    await fs.stat(gitPath);
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
    if (normalizeRepoUrl(origin.refs.fetch) !== normalizeRepoUrl(targetUri.toString())) {
      return false;
    }
  } catch {
    return false;
  }

  // Same repository, so take over the current URL (a rotated token must reach .git/config). Not worth failing the start over.
  try {
    await setOrigin(workspacePath, targetUri);
  } catch {
    console.warn("Could not refresh the origin URL");
  }
  return true;
}

// git's wording when a host wants credentials: no prompt in the pod, a rejected login, or GitHub/GitLab hiding a private repository.
const AUTH_FAILURE =
  /could not read Username|terminal prompts disabled|Authentication failed|Access denied|Repository not found|returned error: 40[13]/i;

// git's wording when the host cannot be reached at all.
const NETWORK_FAILURE =
  /Could not resolve host|Failed to connect|Connection (timed out|refused|reset)|Operation timed out|Network is unreachable/i;

export function cloneFailureMessage(
  repoUri: URL,
  error: string,
  source = theiaEnv.GIT_SOURCE,
): string {
  // Only a link from outside Artemis can point at a private repository; an Artemis link (with credentials, or from a
  // landing page that sets no GIT_SOURCE) failed for another reason, so the hint would mislead.
  if (source === "external" && !repoUri.username && !repoUri.password && AUTH_FAILURE.test(error)) {
    return (
      `Could not clone ${repoDisplayName(repoUri)}: it is private or does not exist. ` +
      // The Git extension would clone into a subfolder, where the repository's .vscode config is not found.
      `Private repositories do not open automatically. Use "Clone Repository" in the Source Control view ` +
      `(or the command "Scorpio: Clone Repository into Workspace") and enter an access token from your Git host as the password.`
    );
  }
  // Host and repository name only: the raw git error can contain the URL with its credentials.
  const name = repoDisplayName(repoUri);
  const again =
    source === "external" ? "open the link again" : "start the exercise again from Artemis";
  if (AUTH_FAILURE.test(error)) {
    return `Could not clone ${name}: ${repoUri.host} did not accept the access. Please ${again} to get a fresh link.`;
  }
  if (NETWORK_FAILURE.test(error)) {
    return `Could not clone ${name}: ${repoUri.host} is not reachable. Check your connection, then reload the window to try again.`;
  }
  return `Could not clone ${name}. Reload the window to try again; if it keeps failing, ${again}.`;
}

// Host and path only, so no credential from GIT_URI can reach a message.
function repoDisplayName(repoUri: URL): string {
  return path.basename(repoUri.pathname, ".git") || repoUri.host;
}

export function validateRepoUrl(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  try {
    const { protocol } = new URL(value.trim());
    return protocol === "https:" || protocol === "http:" ? undefined : "Enter an https or http URL";
  } catch {
    return "Enter an https or http URL";
  }
}

// credentialSchemes is a parameter only so tests can use a local http server; a token must not travel over plain http.
export async function cloneRepositoryIntoWorkspace(credentialSchemes = ["https:"]) {
  const workspaceFolderUri = getWorkspaceFolder();
  if (!workspaceFolderUri) {
    vscode.window.showErrorMessage("No workspace folder available to clone the repository into");
    return;
  }
  const workspacePath = workspaceFolderUri.fsPath;

  // After a failed private link the student lands here with the URL filled in (never with credentials).
  let prefill: string | undefined;
  if (theiaEnv.GIT_SOURCE === "external" && theiaEnv.GIT_URI) {
    prefill = splitCredentials(theiaEnv.GIT_URI).url;
  }
  const input = (
    await vscode.window.showInputBox({
      prompt: "Repository URL",
      placeHolder: "https://github.com/owner/repository.git",
      value: prefill,
      ignoreFocusOut: true,
      validateInput: validateRepoUrl,
    })
  )?.trim();
  if (!input) {
    return;
  }
  const repoUri = new URL(input);
  const name = repoDisplayName(repoUri);

  // One clone attempt under the lock. The emptiness check is repeated for every attempt, because the
  // student may have added files while a prompt was open and a clone clears the workspace.
  const attempt = async (uri: URL): Promise<"cloned" | "blocked" | "auth"> => {
    let outcome: "cloned" | "blocked" | "auth" = "blocked";
    const ranAlone = await withCloneLock(async () => {
      const content = await workspaceContent(workspacePath);
      if (content.length > 0) {
        vscode.window.showErrorMessage(
          `The workspace is not empty, so nothing was cloned. Remove or move these first: ${content.join(", ")}`,
        );
        return;
      }
      await withWorkspaceProgress(async (report) => {
        report(`Cloning ${name}`);
        try {
          await cloneByGivenURL(uri, workspacePath, {
            mode: "workspace-root",
            keepCredentialsInOrigin: false,
          });
          outcome = "cloned";
        } catch (e: any) {
          if (!AUTH_FAILURE.test(String(e?.message))) {
            throw e;
          }
          outcome = "auth";
        }
      });
    });
    if (!ranAlone) {
      vscode.window.showWarningMessage(
        "Another window is cloning a repository. Try again in a moment.",
      );
    }
    return outcome;
  };

  try {
    let result = await attempt(repoUri);
    if (result === "auth") {
      if (!credentialSchemes.includes(repoUri.protocol)) {
        vscode.window.showErrorMessage(
          `Could not clone ${name}: it needs credentials, which are only sent over https.`,
        );
        return;
      }
      // Asked outside the lock, so a slow student does not block other windows.
      const user = (
        await vscode.window.showInputBox({
          prompt: "Username for the repository",
          ignoreFocusOut: true,
        })
      )?.trim();
      const token = user
        ? (
            await vscode.window.showInputBox({
              prompt: "Access token",
              password: true,
              ignoreFocusOut: true,
            })
          )?.trim()
        : undefined;
      if (!user || !token) {
        vscode.window.showInformationMessage("Clone cancelled");
        return;
      }
      const withCredentials = new URL(repoUri);
      withCredentials.username = encodeURIComponent(user);
      withCredentials.password = encodeURIComponent(token);
      result = await attempt(withCredentials);
      if (result === "auth") {
        vscode.window.showErrorMessage(`Could not clone ${name}: the access was not accepted.`);
        return;
      }
      if (result === "cloned") {
        // Losing the cache only means git asks again on the first push.
        await storeCredentials(workspacePath, repoUri, user, token).catch((e) =>
          console.warn(`Could not cache the credentials: ${e?.message}`),
        );
      }
    }
    if (result === "cloned") {
      vscode.window.showInformationMessage(`Cloned ${name} into the workspace.`);
      // The Git extension watches the workspace; this only speeds up picking the repository up.
      await Promise.resolve(vscode.commands.executeCommand("git.refresh")).catch(() => {});
    }
  } catch (e: any) {
    // Host and name only: the raw git error can contain the URL with its credentials.
    console.error(e?.message);
    vscode.window.showErrorMessage(
      `Could not clone ${name}. Check the URL and your access token, then try again.`,
    );
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

    const repoUri = theiaEnv.GIT_URI;
    const workspacePath = workspaceFolderUri.fsPath;
    let skipPrewarm = false;
    await withWorkspaceProgress(async (report) => {
      report("Checking your workspace");
      try {
        // Check inside the lock: the window that held it may have just finished the same clone.
        const ranAlone = await withCloneLock(async () => {
          if (await isRepoAlreadyCloned(workspacePath, repoUri)) {
            console.log("Repository already present, skipping auto-clone");
          } else {
            const content = await workspaceContent(workspacePath);
            if (content.length === 0) {
              report(`Cloning ${repoDisplayName(repoUri)}`);
              if (theiaEnv.GIT_REF_INVALID) {
                vscode.window.showWarningMessage(
                  `GIT_REF "${refForDisplay(theiaEnv.GIT_REF_INVALID)}" is not a valid branch, tag or commit name. The default branch is checked out.`,
                );
              }
              await cloneByGivenURL(repoUri, workspacePath, {
                mode: "workspace-root",
                ref: theiaEnv.GIT_REF,
                onRefFailed: (ref) =>
                  vscode.window.showWarningMessage(
                    `Could not check out "${refForDisplay(ref)}". The default branch is checked out instead.`,
                  ),
              });
            } else {
              // Never clear files that might be the student's: the checkout may only look different (renamed remote, git error).
              skipPrewarm = true;
              console.warn(
                `Exercise not cloned, the workspace already contains: ${content.join(", ")}`,
              );
              vscode.window.showWarningMessage(
                "The exercise was not cloned because this workspace already contains files. " +
                  "Empty the workspace or start a new one to get the exercise.",
              );
            }
          }
        });
        if (!ranAlone) {
          console.log("Another window is cloning the repository, skipping auto-clone");
          // The lock does not wait, so this window carries on while the other one finishes.
          vscode.window.setStatusBarMessage("Another window is cloning the exercise", 10000);
        }
      } catch (e: any) {
        // Still write the git identity below, or a clone retried by hand commits as the wrong user.
        console.error(e.message);
        vscode.window.showErrorMessage(cloneFailureMessage(repoUri, String(e?.message ?? e)));
      }
    });

    // Pre-warm Gradle in the background every session so the student's build is faster,
    // even on restarts where the repo is already present but the daemon is cold.
    // Depth is controlled by GRADLE_PREWARM; warmupGradleDaemon skips non-Gradle repos.
    if (!skipPrewarm) {
      void warmupGradleDaemon(
        workspaceFolderUri.fsPath,
        theiaEnv.GRADLE_PREWARM,
        theiaEnv.GRADLE_PREWARM_AUTO_CONFIRM,
      );
    }
  }

  // GIT_URI wins: a template is never applied over a clone.
  if (!theiaEnv.GIT_URI && theiaEnv.TEMPLATE) {
    const workspaceFolderUri = getWorkspaceFolder();
    if (!workspaceFolderUri) {
      vscode.window.showErrorMessage("No workspace folder available to copy the template into");
      return;
    }
    const templatesDir = process.env["SCORPIO_TEMPLATES_DIR"] || DEFAULT_TEMPLATES_DIR;
    // The id comes from the environment, so keep markdown link syntax and long text out of the notification.
    const shownId = theiaEnv.TEMPLATE.replace(/[\[\]()`\r\n]/g, "").slice(0, 64);
    const template = theiaEnv.TEMPLATE;
    try {
      const result = await withWorkspaceProgress((report) => {
        report(`Applying template ${shownId}`);
        return applyTemplate(template, workspaceFolderUri.fsPath, templatesDir);
      });
      if (result === "not-found") {
        const message = `Template \`${shownId}\` not found, starting with an empty workspace`;
        console.warn(message);
        vscode.window.showWarningMessage(message);
      }
    } catch (e: any) {
      console.error(e.message);
      vscode.window.showErrorMessage("Could not copy the template into the workspace");
    }

    // Template code comes from the image or the student's own workspace, so no prompt.
    void warmupGradleDaemon(workspaceFolderUri.fsPath, theiaEnv.GRADLE_PREWARM, true);
  }

  if (theiaEnv.THEIA_FLAG) {
    try {
      const git = simpleGit();
      // A second window's data bridge can stay empty, so its fallback must not replace the identity.
      if (!theiaEnv.GIT_USER && (await git.getConfig("user.name", GitConfigScope.global)).value) {
        return;
      }
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
