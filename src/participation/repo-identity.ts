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
    // Hostnames are case-insensitive; repository paths are not. Lowercasing the path would make
    // /git/COURSE/repo and /git/course/repo look identical, and on a case-sensitive host those can
    // be two different repositories - we would then keep the wrong checkout.
    existing.host.toLowerCase() === cloneUrl.host.toLowerCase() &&
    normalizeRepoPath(existing.pathname) === normalizeRepoPath(cloneUrl.pathname)
  );
}

function normalizeRepoPath(pathname: string): string {
  // Order matters: a stored remote of ".../repo.git/" must reduce to the same thing as
  // ".../repo.git". Stripping the suffix first would leave the slash in place, the two would not
  // match, and the workspace would be wiped on the strength of a formatting difference.
  return pathname
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}
