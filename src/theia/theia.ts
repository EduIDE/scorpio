import * as vscode from "vscode";
import simpleGit, { GitConfigScope } from "simple-git";
import { hostname } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { cloneByGivenURL } from "../participation/cloning.service";
import { warmupGradleDaemon } from "../participation/gradle.service";
import { createTheiaEnvStrategy, DEFAULT_GRADLE_PREWARM, TheiaEnv } from "./env-strategy";
import { redactUrlCredentials } from "./env-parsing";
import type { GitHubIntegration } from "../github";

export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  GIT_REF: undefined,
  GIT_SOURCE: "other",
  GIT_USER: undefined,
  GIT_MAIL: undefined,
  GRADLE_PREWARM: DEFAULT_GRADLE_PREWARM,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_PRIVATE_REPOS: undefined,
  GITHUB_HOST: undefined,
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

export async function initTheia(github?: GitHubIntegration) {
  if (theiaEnv.GIT_URI) {
    vscode.commands.executeCommand("setContext", "scorpio.theia.givenExercise", true);
  }

  if (theiaEnv.GIT_URI) {
    const workspaceFolderUri = getWorkspaceFolder();
    if (!workspaceFolderUri) {
      vscode.window.showErrorMessage("No workspace folder available to clone repository");
      return;
    }

    const alreadyCloned = await isRepoAlreadyCloned(workspaceFolderUri.fsPath, theiaEnv.GIT_URI);
    let cloned = true;
    if (alreadyCloned) {
      console.log("Repository already present, skipping auto-clone");
    } else {
      try {
        await cloneByGivenURL(theiaEnv.GIT_URI, workspaceFolderUri.fsPath, {
          mode: "workspace-root",
          ref: theiaEnv.GIT_REF,
        });
      } catch (e: any) {
        cloned = false;
        // Without this the student just sees an empty workspace. Artemis URLs carry a token, so
        // neither the URL nor git's message is shown unredacted.
        const message = redactUrlCredentials(`${e?.message ?? e}`);
        console.error(message);
        // A private GitHub repository fails here too; the GitHub module then offers to sign in.
        const handled =
          theiaEnv.GIT_SOURCE === "github" &&
          github !== undefined &&
          (await github.handleCloneFailure(theiaEnv.GIT_URI, workspaceFolderUri.fsPath));
        if (!handled) {
          vscode.window.showErrorMessage(
            `Could not clone ${redactUrlCredentials(theiaEnv.GIT_URI.toString())}: ${message}`,
          );
        }
      }
    }

    // Pre-warm Gradle in the background every session so the student's build is faster,
    // even on restarts where the repo is already present but the daemon is cold.
    // Depth is controlled by GRADLE_PREWARM (off by default outside Artemis); warmupGradleDaemon
    // skips non-Gradle repos.
    if (cloned) {
      warmupGradleDaemon(workspaceFolderUri.fsPath, theiaEnv.GRADLE_PREWARM);
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
