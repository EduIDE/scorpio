/**
 * Error messages for GitHub failures. An organization that has not approved the OAuth App blocks its repositories
 * for the student's token, and GitHub's own message does not say what the student can do about it.
 */

import * as vscode from "vscode";
import type { GitHubConfig } from "./config";
import { appAuthorizationUrl, orgAccessRestriction } from "./repo";
import { redactUrlCredentials } from "../theia/env-parsing";

/**
 * Shows `error`, prefixed with `what` if given. For an organization's access restriction it explains instead who can
 * approve EduIDE and links to the page where the student requests approval. `owner` is the organization assumed when
 * GitHub's message does not name one.
 */
export async function showGitHubError(
  config: GitHubConfig,
  error: any,
  owner: string,
  what?: string,
): Promise<void> {
  const message = `${error?.message ?? error}`;
  // vscode.git's GitError keeps git's output, where GitHub's explanation is, in stderr.
  const restriction = orgAccessRestriction(`${message}\n${error?.stderr ?? ""}`);
  if (!restriction) {
    vscode.window.showErrorMessage(redactUrlCredentials(what ? `${what}: ${message}` : message));
    return;
  }
  const org = restriction.org ?? owner;
  const choice = await vscode.window.showErrorMessage(
    `The ${org} organization has not approved EduIDE yet, so GitHub does not let EduIDE access its repositories ` +
      `for you. Its owners (usually your instructors) can approve EduIDE, or you can request approval: on the page ` +
      `that opens, click "Request access" next to ${org}.`,
    "Request approval",
  );
  if (choice) {
    await vscode.env.openExternal(vscode.Uri.parse(appAuthorizationUrl(config)));
  }
}
