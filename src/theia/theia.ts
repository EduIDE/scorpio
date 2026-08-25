import * as vscode from "vscode";
import simpleGit, { GitConfigScope } from "simple-git";
import { hostname } from "os";
import { cloneByGivenURL } from "../participation/cloning.service";
import { createTheiaEnvStrategy, DEFAULT_GRADLE_PREWARM, TheiaEnv } from "./env-strategy";

// Mutable theiaEnv that gets populated after loading
export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_TOKEN: undefined,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  GIT_USER: undefined,
  GIT_MAIL: undefined,
  GIT_TOKEN: undefined,
  GRADLE_PREWARM: DEFAULT_GRADLE_PREWARM,
};

// Full untyped map of every variable that was provided (including arbitrary keys
// from external systems). Used by the generic terminal-environment sink.
export let rawEnv: Record<string, string> = {};

/**
 * Loads the theia environment using the configured credential strategy.
 * Must be called before accessing theiaEnv.
 */
export async function loadTheiaEnv(): Promise<void> {
  const strategy = await createTheiaEnvStrategy();
  const loaded = await strategy.load();
  theiaEnv = loaded.env;
  rawEnv = loaded.raw;
}

export function getWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.at(0)?.uri;
}

export async function initTheia() {
  if (theiaEnv.GIT_URI) {
    vscode.commands.executeCommand("setContext", "scorpio.theia.givenExercise", true);
  }

  // Materialize the repository directly into the existing Theia workspace.
  if (theiaEnv.GIT_URI) {
    const workspaceFolderUri = getWorkspaceFolder();
    if (!workspaceFolderUri) {
      vscode.window.showErrorMessage("No workspace folder available to clone repository");
      return;
    }

    // Gitea private-repo case: authenticate the clone with the OIDC access token via an HTTP
    // Bearer header. Only applies when a GIT_TOKEN is present and the Artemis path is not in
    // use. When GIT_TOKEN is absent, the clone stays a plain public clone (unchanged behavior).
    const useGiteaToken = Boolean(theiaEnv.GIT_TOKEN) && !theiaEnv.ARTEMIS_TOKEN;

    await cloneByGivenURL(theiaEnv.GIT_URI, workspaceFolderUri.fsPath, {
      mode: "workspace-root",
      httpExtraHeader: useGiteaToken
        ? `Authorization: Bearer ${theiaEnv.GIT_TOKEN}`
        : undefined,
    });
  }

  // set git config values
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
  // login should trigger workspace detection
}
