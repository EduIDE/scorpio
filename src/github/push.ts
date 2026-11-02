/**
 * "Push to GitHub": push to the repository the workspace came from when the student may, otherwise to their fork or
 * another repository of theirs. Never a force push. Git itself gets the token through the credentials provider.
 */

import * as vscode from "vscode";
import type { RepoInfo } from "./api";
import { showGitHubError } from "./errors";
import { getGitApi, type Repository } from "./git-api";
import {
  listUnpushedCommits,
  reauthorUnpushedCommits,
  sessionAuthoredCommits,
  setRepositoryIdentity,
} from "./identity";
import {
  compareUrl,
  freeRemoteName,
  gitHubIdentity,
  parseRepoFromUrl,
  sameRepository,
  type RepoRef,
} from "./repo";
import type { GitHubSession } from "./session";
import type { GitSource } from "../theia/env-parsing";

export async function pushToGitHub(session: GitHubSession, source: GitSource): Promise<void> {
  const gitApi = await getGitApi();
  const workspace = vscode.workspace.workspaceFolders?.at(0)?.uri;
  const repository = workspace
    ? (gitApi?.getRepository(workspace) ?? gitApi?.repositories[0])
    : undefined;
  if (!gitApi || !repository) {
    vscode.window.showErrorMessage("No git repository is open in this workspace.");
    return;
  }
  const branch = repository.state.HEAD?.name;
  if (!branch) {
    vscode.window.showErrorMessage("Check out a branch before pushing (HEAD is detached).");
    return;
  }
  const origin = repository.state.remotes.find((remote) => remote.name === "origin");
  const upstream = parseRepoFromUrl(origin?.fetchUrl ?? origin?.pushUrl, session.config);
  if (!upstream) {
    vscode.window.showErrorMessage("This repository's origin is not on GitHub.");
    return;
  }

  if (!(await session.ensureSignedIn("public_repo"))) {
    return;
  }
  let info: RepoInfo | undefined;
  try {
    info = await session.api().getRepo(upstream);
    if (!info || info.private) {
      // Missing for a public_repo token, or private: only a repo token can push here.
      if (!(await session.ensureSignedIn("repo"))) {
        return;
      }
      info = await session.api().getRepo(upstream);
    }
  } catch (error: any) {
    await showGitHubError(session.config, error, upstream.owner);
    return;
  }
  if (!info) {
    vscode.window.showErrorMessage(
      `${upstream.owner}/${upstream.repo} does not exist or you have no access to it.`,
    );
    return;
  }

  if (source !== "artemis" && !(await offerAuthorFix(session, repository))) {
    return;
  }

  try {
    if (info.canPush) {
      await push(repository, "origin", branch);
      vscode.window.showInformationMessage(
        `Pushed ${branch} to ${upstream.owner}/${upstream.repo}.`,
      );
      return;
    }
    await pushElsewhere(session, repository, upstream, info, branch);
  } catch (error: any) {
    await showGitHubError(session.config, error, upstream.owner, "Push failed");
  }
}

async function push(repository: Repository, remote: string, branch: string): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Pushing ${branch} to ${remote}…` },
    () => repository.push(remote, branch, true),
  );
}

type Target = vscode.QuickPickItem & { action: "fork" | "other" };

async function pushElsewhere(
  session: GitHubSession,
  repository: Repository,
  upstream: RepoRef,
  info: RepoInfo,
  branch: string,
): Promise<void> {
  const items: Target[] = [];
  if (info.allowForking) {
    items.push({
      label: "$(repo-forked) Fork and push",
      detail: `Create your fork of ${upstream.owner}/${upstream.repo} (or reuse it), push there, then open a pull request.`,
      action: "fork",
    });
  }
  items.push({
    label: "$(repo) Push to another repository…",
    detail: "One of your repositories you can push to.",
    action: "other",
  });
  const choice = await vscode.window.showQuickPick(items, {
    title: `You cannot push to ${upstream.owner}/${upstream.repo}`,
    placeHolder: "Where should your commits go?",
  });
  if (!choice) {
    return;
  }

  const login = session.user!.login;
  let target: RepoInfo;
  if (choice.action === "fork") {
    target = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Forking ${upstream.owner}/${upstream.repo}…`,
      },
      () => forkAndWait(session, upstream),
    );
  } else {
    const repos = await session.api().listWritableRepos();
    const picked = await vscode.window.showQuickPick(
      repos.map((repo) => ({
        label: `${repo.owner}/${repo.repo}`,
        description: repo.private ? "private" : "",
        repo,
      })),
      { title: "Push to which repository?", matchOnDescription: true },
    );
    if (!picked) {
      return;
    }
    target = picked.repo;
  }

  const existing = repository.state.remotes.find((remote) =>
    sameRepository(remote.fetchUrl ?? remote.pushUrl, target.cloneUrl),
  );
  const remoteName =
    existing?.name ??
    freeRemoteName(
      choice.action === "fork" ? "fork" : target.owner,
      repository.state.remotes.map((remote) => remote.name),
    );
  if (!existing) {
    await repository.addRemote(remoteName, target.cloneUrl);
  }
  await push(repository, remoteName, branch);

  const done = `Pushed ${branch} to ${target.owner}/${target.repo}.`;
  if (choice.action === "fork" && target.owner === login) {
    const open = await vscode.window.showInformationMessage(done, "Open pull request");
    if (open) {
      await vscode.env.openExternal(
        vscode.Uri.parse(compareUrl(session.config, upstream, info.defaultBranch, login, branch)),
      );
    }
  } else {
    vscode.window.showInformationMessage(done);
  }
}

/** GitHub creates forks asynchronously; wait until the fork can be read. */
async function forkAndWait(session: GitHubSession, upstream: RepoRef): Promise<RepoInfo> {
  const fork = await session.api().createFork(upstream);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const ready = await session.api().getRepo(fork);
    if (ready) {
      return ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `GitHub did not finish creating ${fork.owner}/${fork.repo} in time. Please try again.`,
  );
}

/**
 * Commits made before signing in carry Scorpio's session identity (<pod>@artemis-theia.de). Offer to re-author the
 * unpushed ones with the student's GitHub identity. Returns false if the student cancelled the push.
 */
async function offerAuthorFix(session: GitHubSession, repository: Repository): Promise<boolean> {
  const repoPath = repository.rootUri.fsPath;
  const identity = gitHubIdentity(session.user!);
  await setRepositoryIdentity(repoPath, identity);
  const affected = sessionAuthoredCommits(await listUnpushedCommits(repoPath));
  if (affected.length === 0) {
    return true;
  }
  const choice = await vscode.window.showInformationMessage(
    `${affected.length} unpushed commit(s) are authored by this session's placeholder (${affected[0].email}). ` +
      `Use your GitHub identity (${identity.name} <${identity.email}>) for them?`,
    { modal: true },
    "Use GitHub identity",
    "Keep as is",
  );
  if (!choice) {
    return false;
  }
  if (choice === "Use GitHub identity") {
    try {
      await reauthorUnpushedCommits(repoPath);
    } catch (error: any) {
      vscode.window.showWarningMessage(`${error?.message ?? error}`);
    }
  }
  return true;
}
