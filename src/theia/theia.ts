import * as vscode from "vscode";
import { GitConfigScope, simpleGit } from "simple-git";
import { hostname } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { cloneByGivenURL, withCloneLock } from "../participation/cloning.service";
import { applyTemplate, DEFAULT_TEMPLATES_DIR } from "../participation/template.service";
import { warmupGradleDaemon } from "../participation/gradle.service";
import { createTheiaEnvStrategy, DEFAULT_GRADLE_PREWARM, TheiaEnv } from "./env-strategy";

export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  TEMPLATE: undefined,
  GIT_USER: undefined,
  GIT_MAIL: undefined,
  GRADLE_PREWARM: DEFAULT_GRADLE_PREWARM,
  GRADLE_PREWARM_AUTO_CONFIRM: true,
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

    const repoUri = theiaEnv.GIT_URI;
    const workspacePath = workspaceFolderUri.fsPath;
    try {
      // Check inside the lock: the window that held it may have just finished the same clone.
      const ranAlone = await withCloneLock(async () => {
        if (await isRepoAlreadyCloned(workspacePath, repoUri)) {
          console.log("Repository already present, skipping auto-clone");
        } else {
          await cloneByGivenURL(repoUri, workspacePath, { mode: "workspace-root" });
        }
      });
      if (!ranAlone) {
        console.log("Another window is cloning the repository, skipping auto-clone");
      }
    } catch (e: any) {
      // Still write the git identity below, or a clone retried by hand commits as the wrong user.
      console.error(e.message);
      vscode.window.showErrorMessage("Could not clone the exercise repository");
    }

    // Pre-warm Gradle in the background every session so the student's build is faster,
    // even on restarts where the repo is already present but the daemon is cold.
    // Depth is controlled by GRADLE_PREWARM; warmupGradleDaemon skips non-Gradle repos.
    void warmupGradleDaemon(
      workspaceFolderUri.fsPath,
      theiaEnv.GRADLE_PREWARM,
      theiaEnv.GRADLE_PREWARM_AUTO_CONFIRM,
    );
  }

  // GIT_URI wins: a template is never applied over a clone.
  if (!theiaEnv.GIT_URI && theiaEnv.TEMPLATE) {
    const workspaceFolderUri = getWorkspaceFolder();
    if (!workspaceFolderUri) {
      vscode.window.showErrorMessage("No workspace folder available to copy the template into");
      return;
    }
    const templatesDir = process.env["SCORPIO_TEMPLATES_DIR"] || DEFAULT_TEMPLATES_DIR;
    try {
      const result = await applyTemplate(
        theiaEnv.TEMPLATE,
        workspaceFolderUri.fsPath,
        templatesDir,
      );
      if (result === "not-found") {
        // The id comes from the environment, so keep markdown link syntax and long text out of the notification.
        const shownId = theiaEnv.TEMPLATE.replace(/[\[\]()`\r\n]/g, "").slice(0, 64);
        const message = `Template \`${shownId}\` not found, starting with an empty workspace`;
        console.warn(message);
        vscode.window.showWarningMessage(message);
      }
    } catch (e: any) {
      console.error(e.message);
      vscode.window.showErrorMessage("Could not copy the template into the workspace");
    }

    void warmupGradleDaemon(
      workspaceFolderUri.fsPath,
      theiaEnv.GRADLE_PREWARM,
      theiaEnv.GRADLE_PREWARM_AUTO_CONFIRM,
    );
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
