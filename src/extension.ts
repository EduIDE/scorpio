import * as vscode from "vscode";
import { initTheia, loadTheiaEnv, theiaEnv } from "./theia/theia";
import { activateGitHub } from "./github";
import { initSettings } from "./shared/settings";

export async function activate(context: vscode.ExtensionContext) {
  await loadTheiaEnv();
  const github = activateGitHub(context, theiaEnv);
  await initTheia(github);
  context.subscriptions.push(initSettings());

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );
}

export function deactivate() {}
