/**
 * Decides whether an externally supplied Artemis base URL (for example the `ARTEMIS_URL`
 * environment variable injected into a Theia session) may be trusted as the API base.
 *
 * The candidate is only accepted when it is a well-formed http(s) URL whose origin
 * (scheme + host + port) matches a trusted origin. This prevents an environment from silently
 * repointing the extension - and the Bearer token it attaches to every request - at a rogue host.
 *
 * Two origins are trusted:
 *  - the origin the extension is already configured for (`scorpio.artemis.apiBaseUrl`), and
 *  - the origin of the session's `GIT_URI`, when present.
 *
 * The git origin matters because a single IDE image serves every Artemis instance (production,
 * the test/staging servers, and self-hosted deployments). `ARTEMIS_URL` and `GIT_URI` are
 * injected together from the same trusted session spec and name the same Artemis host, so an
 * `ARTEMIS_URL` whose origin matches the exercise's own git remote is legitimate even when it
 * differs from the packaged default. An `ARTEMIS_URL` pointing somewhere the git remote does not
 * is still rejected.
 *
 * Returns the trusted URL string when the candidate is allowed, otherwise `undefined`.
 */
export function resolveAllowedArtemisUrl(
  candidate: string | undefined,
  configuredBaseUrl: string | undefined,
  gitUri?: string | URL,
): string | undefined {
  if (!candidate) {
    return undefined;
  }

  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    return undefined;
  }

  if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") {
    return undefined;
  }

  // Collect the origins we trust the candidate to match. `URL.origin` excludes any userinfo, so a
  // GIT_URI carrying credentials (user:token@host) still reduces to its bare host origin.
  const trustedOrigins = new Set<string>();
  for (const source of [configuredBaseUrl, gitUri]) {
    if (!source) {
      continue;
    }
    try {
      trustedOrigins.add(new URL(source).origin);
    } catch {
      // ignore an unparseable source; the others still establish trust
    }
  }

  // Without any trusted origin to allowlist against we cannot establish trust, so the override is
  // rejected rather than accepted blindly.
  if (trustedOrigins.size === 0) {
    return undefined;
  }

  return trustedOrigins.has(candidateUrl.origin) ? candidate : undefined;
}
