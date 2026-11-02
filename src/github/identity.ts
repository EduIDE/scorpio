/**
 * The commit identity for repositories opened from GitHub: repository-local, so Scorpio's global identity (and an
 * Artemis identity) stay untouched.
 */

import simpleGit from "simple-git";
import { isSessionIdentity } from "./repo";

export type UnpushedCommit = { hash: string; parents: string[]; email: string };

export async function setRepositoryIdentity(
  repoPath: string,
  identity: { name: string; email: string },
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.addConfig("user.name", identity.name, false, "local");
  await git.addConfig("user.email", identity.email, false, "local");
}

/** Commits on HEAD that no remote-tracking branch contains, oldest first. */
export async function listUnpushedCommits(repoPath: string): Promise<UnpushedCommit[]> {
  const output = await simpleGit(repoPath).raw([
    "log",
    "--reverse",
    "--format=%H%x09%P%x09%ae",
    "HEAD",
    "--not",
    "--remotes",
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, email] = line.split("\t");
      return { hash, parents: parents ? parents.split(" ") : [], email: email ?? "" };
    });
}

/** The unpushed commits authored by Scorpio's fallback session identity, i.e. before the student signed in. */
export function sessionAuthoredCommits(commits: UnpushedCommit[]): UnpushedCommit[] {
  return commits.filter((commit) => isSessionIdentity(commit.email));
}

/**
 * Re-authors every unpushed commit with the repository's current identity. Only unpushed history is rewritten, and
 * only linear history: a merge among the unpushed commits makes this refuse rather than flatten it.
 */
export async function reauthorUnpushedCommits(repoPath: string): Promise<number> {
  const commits = await listUnpushedCommits(repoPath);
  if (commits.length === 0) {
    return 0;
  }
  if (commits.some((commit) => commit.parents.length > 1)) {
    throw new Error("The unpushed commits contain a merge; their author was left unchanged.");
  }
  const base = commits[0].parents[0];
  // Non-interactive: "--exec" without "--interactive" opens no editor.
  await simpleGit(repoPath).raw([
    "rebase",
    "--autostash",
    "--exec",
    "git commit --amend --no-edit --reset-author --allow-empty",
    ...(base ? [base] : ["--root"]),
  ]);
  return commits.length;
}
