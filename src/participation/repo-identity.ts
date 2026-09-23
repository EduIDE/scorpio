/**
 * Do two repository URLs point at the same repository?
 *
 * Kept free of Node imports so it can be unit tested in the web extension test harness.
 *
 * Credentials are deliberately ignored. A clone URL carries a short-lived token that differs
 * on every launch, and the remote stored in .git/config carries whichever token was current
 * when the clone happened - neither says anything about which repository this is.
 */
export function isSameRepository(existingRemote: string, cloneUrl: URL): boolean {
  let existing: URL;
  try {
    existing = new URL(existingRemote);
  } catch {
    // Non-URL remotes (scp-style "git@host:org/repo.git") never come from our launch flow.
    return false;
  }

  return (
    existing.host.toLowerCase() === cloneUrl.host.toLowerCase() &&
    normalizeRepoPath(existing.pathname) === normalizeRepoPath(cloneUrl.pathname)
  );
}

function normalizeRepoPath(pathname: string): string {
  return pathname
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
