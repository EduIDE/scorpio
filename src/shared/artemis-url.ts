/**
 * Decides whether an externally supplied Artemis base URL (for example the `ARTEMIS_URL`
 * environment variable injected into a Theia session) may be trusted as the API base.
 *
 * The candidate is only accepted when it is a well-formed http(s) URL whose origin
 * (scheme + host + port) matches the origin the extension is already configured for. This
 * prevents an attacker-controlled environment from silently repointing the extension - and the
 * Bearer token it attaches to every request - at a rogue host.
 *
 * Returns the trusted URL string when the candidate is allowed, otherwise `undefined`.
 */
export function resolveAllowedArtemisUrl(
  candidate: string | undefined,
  configuredBaseUrl: string | undefined,
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

  // Without a configured origin to allowlist against we cannot establish trust, so the
  // override is rejected rather than accepted blindly.
  if (!configuredBaseUrl) {
    return undefined;
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(configuredBaseUrl);
  } catch {
    return undefined;
  }

  return candidateUrl.origin === configuredUrl.origin ? candidate : undefined;
}
