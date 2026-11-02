/**
 * Private repositories: the token-less clone at startup fails at once, so the student is asked to sign in with the
 * `repo` scope, and the clone is repeated with the token handed to git through GIT_ASKPASS.
 */

import * as vscode from "vscode";
import { cloneByGivenURL } from "../participation/cloning.service";
import { warmupGradleDaemon } from "../participation/gradle.service";
import type { GitHubSession } from "./session";
import { withAskpass } from "./askpass";
import { showGitHubError } from "./errors";
import { setRepositoryIdentity } from "./identity";
import { gitHubIdentity, parseRepoFromUrl, type RepoRef } from "./repo";
import type { GradlePrewarmLevel } from "../theia/env-parsing";

/**
 * Called when cloning a GitHub repository failed. Returns true when this takes over (a private repository, or one
 * that does not exist), false when the failure has another cause and should be reported as such.
 */
export async function handleCloneFailure(
  session: GitHubSession,
  uri: URL,
  workspacePath: string,
  ref: string | undefined,
  prewarm: GradlePrewarmLevel,
): Promise<boolean> {
  const repo = parseRepoFromUrl(uri.toString(), session.config);
  if (!repo) {
    return false;
  }
  try {
    if (await session.anonymousApi().getRepo(repo)) {
      return false; // public: the clone failed for another reason
    }
  } catch {
    return false;
  }
  if (!session.config.allowPrivate) {
    vscode.window.showErrorMessage(
      `${repo.owner}/${repo.repo} is private or does not exist, and private repositories are not enabled on this EduIDE.`,
    );
    return true;
  }
  void offerPrivateClone(session, repo, uri, workspacePath, ref, prewarm);
  return true;
}

async function offerPrivateClone(
  session: GitHubSession,
  repo: RepoRef,
  uri: URL,
  workspacePath: string,
  ref: string | undefined,
  prewarm: GradlePrewarmLevel,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${repo.owner}/${repo.repo} is private or does not exist. Sign in to GitHub to clone it.`,
    "Sign in",
  );
  if (!choice || !(await session.ensureSignedIn("repo"))) {
    return;
  }
  await clonePrivate(session, repo, uri, workspacePath, ref, prewarm);
}

export async function clonePrivate(
  session: GitHubSession,
  repo: RepoRef,
  uri: URL,
  workspacePath: string,
  ref: string | undefined,
  prewarm: GradlePrewarmLevel,
): Promise<boolean> {
  try {
    if (!(await session.api().getRepo(repo))) {
      vscode.window.showErrorMessage(
        `${repo.owner}/${repo.repo} does not exist or you have no access to it.`,
      );
      return false;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cloning ${repo.owner}/${repo.repo}…`,
      },
      () =>
        withAskpass(session.user!.login, session.token!, (gitEnv) =>
          cloneByGivenURL(uri, workspacePath, { mode: "workspace-root", ref, gitEnv }),
        ),
    );
  } catch (error: any) {
    await showGitHubError(
      session.config,
      error,
      repo.owner,
      `Could not clone ${repo.owner}/${repo.repo}`,
    );
    return false;
  }
  await setRepositoryIdentity(workspacePath, gitHubIdentity(session.user!));
  warmupGradleDaemon(workspacePath, prewarm);
  return true;
}
