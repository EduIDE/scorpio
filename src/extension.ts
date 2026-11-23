import * as vscode from "vscode";
import { cloneRepositoryIntoWorkspace, initTheia, loadTheiaEnv } from "./theia/theia";
import { initSettings } from "./shared/settings";

export async function activate(context: vscode.ExtensionContext) {
  // Registered first, so the Source Control button never hits "command not found" if the startup below throws.
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
    vscode.commands.registerCommand("scorpio.workspace.cloneRepository", () =>
      cloneRepositoryIntoWorkspace(),
    ),
  );

  await loadTheiaEnv();
  await initTheia();
  context.subscriptions.push(initSettings());
}

export function deactivate() {}
