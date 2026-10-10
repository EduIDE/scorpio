import * as vscode from "vscode";
import { authenticationProvider } from "../extension";
import { theiaEnv } from "../theia/theia";
import { resolveAllowedArtemisUrl } from "./artemis-url";

export type Settings = {
  base_url: string | undefined;
  default_repo_path: string | undefined;
  easter_egg: boolean;
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
    // Only honor the environment override when it points at the same origin the extension is
    // already configured for. An unvalidated ARTEMIS_URL could otherwise redirect every
    // authenticated request (and the Bearer token) to an attacker-controlled host.
    const trustedUrl = resolveAllowedArtemisUrl(theiaEnv.ARTEMIS_URL, base_url);
    if (trustedUrl) {
      const config = vscode.workspace.getConfiguration("scorpio");
      config.update("artemis.apiBaseUrl", trustedUrl, vscode.ConfigurationTarget.Global);
      base_url = trustedUrl;
    } else {
      vscode.window.showErrorMessage(
        `Ignoring ARTEMIS_URL "${theiaEnv.ARTEMIS_URL}": it does not match the configured Artemis origin${base_url ? ` (${base_url})` : ""}.`,
      );
    }
  }

  if (!base_url) {
    vscode.window.showErrorMessage("Artemis Base URL not set. Please set it in the settings.");
  }

  const default_repo_path = vscode.workspace
    .getConfiguration("scorpio")
    .get<string>("defaults.repoPath");

  const easter_egg = vscode.workspace.getConfiguration("scorpio").get<boolean>("?") ?? false;

  return {
    base_url: base_url,
    default_repo_path: default_repo_path,
    easter_egg: easter_egg,
  };
}

async function handleSettingsChange(e: vscode.ConfigurationChangeEvent) {
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

    await authenticationProvider.removeSession();
    console.warn("Restarting extension");
    vscode.commands.executeCommand("scorpio.restart");
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

  if (e.affectsConfiguration("scorpio.?")) {
    const easter_egg = vscode.workspace.getConfiguration("scorpio").get<boolean>("?") ?? false;
    settings.easter_egg = easter_egg;
  }
}
