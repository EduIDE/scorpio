/**
 * GitHub support for sessions opened from GitHub: sign-in with the device flow, credentials for git, push to the
 * repository or a fork, private repositories. Off unless an OAuth App client ID is configured.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { resolveGitHubConfig } from "./config";
import { getGitApi } from "./git-api";
import { setRepositoryIdentity } from "./identity";
import { handleCloneFailure } from "./private-clone";
import { pushToGitHub } from "./push";
import { gitHubIdentity } from "./repo";
import { GitHubSession } from "./session";
import type { TheiaEnv } from "../theia/env-parsing";

export type GitHubIntegration = {
  /** See handleCloneFailure: true when the failure is a private (or missing) repository and is taken care of. */
  handleCloneFailure(uri: URL, workspacePath: string): Promise<boolean>;
};

const NOT_CONFIGURED =
  "GitHub sign-in is not configured for this EduIDE (setting scorpio.github.clientId or SCORPIO_GITHUB_CLIENT_ID).";

export function activateGitHub(
  context: vscode.ExtensionContext,
  env: TheiaEnv,
): GitHubIntegration | undefined {
  const settings = vscode.workspace.getConfiguration("scorpio.github");
  const config = resolveGitHubConfig(
    {
      clientId: settings.get<string>("clientId"),
      allowPrivateRepositories: settings.get<boolean>("allowPrivateRepositories"),
      host: settings.get<string>("host"),
    },
    env,
  );

  if (!config.enabled) {
    for (const command of ["scorpio.github.signIn", "scorpio.github.push", "scorpio.github.menu"]) {
      context.subscriptions.push(
        vscode.commands.registerCommand(command, () =>
          vscode.window.showInformationMessage(NOT_CONFIGURED),
        ),
      );
    }
    context.subscriptions.push(
      vscode.commands.registerCommand("scorpio.github.signOut", () => undefined),
    );
    return undefined;
  }

  vscode.commands.executeCommand("setContext", "scorpio.github.enabled", true);
  const session = new GitHubSession(config);
  context.subscriptions.push(session);

  // Repositories opened from GitHub commit as the signed-in student, not as the session placeholder.
  context.subscriptions.push(
    session.onDidChange(async (user) => {
      const workspace = vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath;
      if (
        user &&
        workspace &&
        env.GIT_SOURCE !== "artemis" &&
        fs.existsSync(path.join(workspace, ".git"))
      ) {
        await setRepositoryIdentity(workspace, gitHubIdentity(user)).catch((error) =>
          console.warn(`Could not set the git identity: ${error?.message ?? error}`),
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.github.signIn", () =>
      session.ensureSignedIn("public_repo"),
    ),
    vscode.commands.registerCommand("scorpio.github.signOut", () => session.signOut()),
    vscode.commands.registerCommand("scorpio.github.push", () =>
      pushToGitHub(session, env.GIT_SOURCE),
    ),
    vscode.commands.registerCommand("scorpio.github.menu", async () => {
      if (!session.user) {
        await session.ensureSignedIn("public_repo");
        return;
      }
      const choice = await vscode.window.showQuickPick(["Push to GitHub", "Sign out of GitHub"], {
        title: `GitHub: ${session.user.login}`,
      });
      if (choice === "Push to GitHub") {
        await pushToGitHub(session, env.GIT_SOURCE);
      } else if (choice) {
        session.signOut();
      }
    }),
  );

  // Pushes from the Source Control view, the terminal or Scorpio ask the built-in Git extension for credentials,
  // which asks its credentials providers. The token is only handed out here, to git, for the GitHub host.
  void getGitApi()
    .then((gitApi) => {
      if (!gitApi) {
        console.warn("vscode.git is not available; pushes will not get GitHub credentials.");
        return;
      }
      context.subscriptions.push(
        gitApi.registerCredentialsProvider({
          async getCredentials(host: vscode.Uri) {
            if (host.authority.toLowerCase() !== config.host) {
              return undefined;
            }
            if (!(await session.ensureSignedIn("public_repo"))) {
              return undefined;
            }
            return { username: session.user!.login, password: session.token! };
          },
        }),
      );
    })
    .catch((error) =>
      console.warn(`Could not register GitHub credentials: ${error?.message ?? error}`),
    );

  return {
    handleCloneFailure: (uri, workspacePath) =>
      handleCloneFailure(session, uri, workspacePath, env.GIT_REF, env.GRADLE_PREWARM),
  };
}
