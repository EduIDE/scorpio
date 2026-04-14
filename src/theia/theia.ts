import * as vscode from "vscode";
import simpleGit, { GitConfigScope } from "simple-git";
import { hostname } from "os";
import { cloneByGivenURL } from "../participation/cloning.service";
import { createTheiaEnvStrategy, TheiaEnv } from "./env-strategy";

// Mutable theiaEnv that gets populated after loading
export let theiaEnv: TheiaEnv = {
  THEIA_FLAG: false,
  ARTEMIS_TOKEN: undefined,
  ARTEMIS_URL: undefined,
  GIT_URI: undefined,
  GIT_USER: undefined,
  GIT_MAIL: undefined,
};

/**
 * Loads the theia environment using the configured credential strategy.
 * Must be called before accessing theiaEnv.
 */
export async function loadTheiaEnv(): Promise<void> {
  const strategy = await createTheiaEnvStrategy();
  theiaEnv = await strategy.load();
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

    await cloneByGivenURL(theiaEnv.GIT_URI, workspaceFolderUri.fsPath, {
      mode: "workspace-root",
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
