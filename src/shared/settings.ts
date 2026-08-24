import * as vscode from "vscode";
import { theiaEnv } from "../theia/theia";

export type Settings = {
  base_url: string | undefined;
  default_repo_path: string | undefined;
};

export var settings: Settings;

export function initSettings(): vscode.Disposable {
  settings = getSettings();

  return vscode.workspace.onDidChangeConfiguration((e) => {
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
