/**
 * Private repositories: the token-less clone at startup fails at once, so the student is asked to sign in with the
 * `repo` scope, and the clone is repeated with the token handed to git through GIT_ASKPASS.
 */

import * as vscode from "vscode";
import { cloneByGivenURL, withCloneLock } from "../participation/cloning.service";
import { isRepoAlreadyCloned } from "../theia/theia";
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
  prewarmAutoConfirm: boolean,
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
  void offerPrivateClone(session, repo, uri, workspacePath, ref, prewarm, prewarmAutoConfirm);
  return true;
}

async function offerPrivateClone(
  session: GitHubSession,
  repo: RepoRef,
  uri: URL,
  workspacePath: string,
  ref: string | undefined,
  prewarm: GradlePrewarmLevel,
  prewarmAutoConfirm: boolean,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${repo.owner}/${repo.repo} is private or does not exist. Sign in to GitHub to clone it.`,
    "Sign in",
  );
  if (!choice || !(await session.ensureSignedIn("repo"))) {
    return;
  }
  await clonePrivate(session, repo, uri, workspacePath, ref, prewarm, prewarmAutoConfirm);
}

export async function clonePrivate(
  session: GitHubSession,
  repo: RepoRef,
  uri: URL,
  workspacePath: string,
  ref: string | undefined,
  prewarm: GradlePrewarmLevel,
  prewarmAutoConfirm: boolean,
): Promise<boolean> {
  try {
    if (!(await session.api().getRepo(repo))) {
      vscode.window.showErrorMessage(
        `${repo.owner}/${repo.repo} does not exist or you have no access to it.`,
      );
      return false;
    }
    // The startup lock is long released by now, so take it again: another window may be cloning.
    const ranAlone = await withCloneLock(async () => {
      if (await isRepoAlreadyCloned(workspacePath, uri)) {
        return;
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
    });
    if (!ranAlone) {
      vscode.window.showWarningMessage(
        `Another window is cloning ${repo.owner}/${repo.repo}. Reload this window when it is done.`,
      );
      return false;
    }
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
  void warmupGradleDaemon(workspacePath, prewarm, prewarmAutoConfirm);
  return true;
}
