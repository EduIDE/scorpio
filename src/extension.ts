import * as vscode from "vscode";
import { initTheia, loadTheiaEnv } from "./theia/theia";
import { initSettings } from "./shared/settings";

export async function activate(context: vscode.ExtensionContext) {
  await loadTheiaEnv();
  await initTheia();
  context.subscriptions.push(initSettings());

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );
}

export function deactivate() {}
