/**
 * GitHub settings, merged from the VS Code settings (defaults baked into the image) and per-installation
 * environment overrides. Pure, so it can be unit tested.
 */

export type GitHubConfig = {
  /** False when no OAuth App client ID is configured; the GitHub features then stay off. */
  enabled: boolean;
  /** Public client ID of the OAuth App the device flow signs in to. There is no client secret. */
  clientId: string;
  /** Whether Scorpio may ask for the `repo` scope (private repositories). */
  allowPrivate: boolean;
  /** `host[:port]`, compared with the authority of git remotes and credential requests. */
  host: string;
  /** e.g. https://github.com: device flow and web links. */
  webOrigin: string;
  /** e.g. https://api.github.com, or <origin>/api/v3 for GitHub Enterprise Server. */
  apiBase: string;
};

export type GitHubSettings = {
  clientId?: string;
  allowPrivateRepositories?: boolean;
  host?: string;
};

export type GitHubEnvOverrides = {
  GITHUB_CLIENT_ID?: string;
  GITHUB_PRIVATE_REPOS?: string;
  GITHUB_HOST?: string;
};

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

export function resolveGitHubConfig(
  settings: GitHubSettings,
  env: GitHubEnvOverrides,
): GitHubConfig {
  const clientId = (env.GITHUB_CLIENT_ID?.trim() || settings.clientId?.trim()) ?? "";
  const hostSetting = env.GITHUB_HOST?.trim() || settings.host?.trim() || "github.com";
  // A bare host means HTTPS. A full origin is accepted too, e.g. for a test server.
  const origin = new URL(hostSetting.includes("://") ? hostSetting : `https://${hostSetting}`);
  const webOrigin = origin.origin;
  const host = origin.host.toLowerCase();
  const apiBase =
    origin.hostname.toLowerCase() === "github.com"
      ? "https://api.github.com"
      : `${webOrigin}/api/v3`;
  return {
    enabled: clientId !== "",
    clientId,
    allowPrivate:
      parseBoolean(env.GITHUB_PRIVATE_REPOS) ?? settings.allowPrivateRepositories ?? true,
    host,
    webOrigin,
    apiBase,
  };
}
