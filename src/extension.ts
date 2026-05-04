import * as vscode from "vscode";
import { ArtemisAuthenticationProvider, AUTH_ID } from "./authentication/authentication_provider";
import { initTheia, loadTheiaEnv, theiaEnv } from "./theia/theia";
import { initSettings } from "./shared/settings";

export async function activate(context: vscode.ExtensionContext) {
  await loadTheiaEnv();
  await initTheia();
  initSettings();

  const authProvider = new ArtemisAuthenticationProvider(context.secrets);
  context.subscriptions.push(authProvider);

  let session = await vscode.authentication.getSession(AUTH_ID, [], { silent: true });
  if (!session && theiaEnv.ARTEMIS_TOKEN !== undefined) {
    session = await authProvider.createSession([]);
  }
  vscode.commands.executeCommand("setContext", "scorpio.authenticated", session !== undefined);

  authProvider.onAuthSessionsChange.event(({ added, removed }) => {
    if (added && added.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", true);
    }
    if (removed && removed.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", false);
    }
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("scorpio.artemis.apiBaseUrl")) {
        return;
      }
      if (theiaEnv.ARTEMIS_URL) {
        return;
      }
      await authProvider.removeSession();
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.login", async () => {
      try {
        const session = await vscode.authentication.getSession(AUTH_ID, [], {
          createIfNone: true,
        });
        if (!session) {
          vscode.window.showErrorMessage("Login failed");
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to login: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.logout", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Sign out from Artemis - Scorpio",
        { modal: true },
        "Sign out",
      );
      if (choice === "Sign out") {
        await authProvider.removeSession();
      }
    }),
  );
}

export function deactivate() {}
