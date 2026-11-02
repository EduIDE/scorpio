/**
 * Pure parsing of the Theia environment. Kept free of the vscode API so it can be unit tested.
 */

/**
 * Controls how much of the first Gradle build is warmed up in the background at
 * session startup (see the prewarming levels L1-L4):
 *  - "off":    no prewarming.
 *  - "daemon": start the Gradle daemon so it is warm and reused (L1).
 *  - "deps":   also configure the build and resolve/download dependencies (L3).
 *  - "full":   also compile, leaving the student's first build near-instant (L4).
 */
export type GradlePrewarmLevel = "off" | "daemon" | "deps" | "full";

/**
 * Where the session's repository comes from. Artemis exercises are trusted course code with an Artemis identity;
 * anything else (e.g. a GitHub link through the landing page) is an arbitrary repository.
 */
export type GitSource = "artemis" | "github" | "other";

export type TheiaEnv = {
  THEIA_FLAG: boolean;
  ARTEMIS_URL: string | undefined;
  GIT_URI: URL | undefined;
  GIT_REF: string | undefined;
  GIT_SOURCE: GitSource;
  GIT_USER: string | undefined;
  GIT_MAIL: string | undefined;
  GRADLE_PREWARM: GradlePrewarmLevel;
  /** Per-installation overrides of the scorpio.github.* settings, as raw strings (see src/github/config.ts). */
  GITHUB_CLIENT_ID: string | undefined;
  GITHUB_PRIVATE_REPOS: string | undefined;
  GITHUB_HOST: string | undefined;
};

export const ENV_KEYS = [
  "THEIA",
  "ARTEMIS_URL",
  "GIT_URI",
  "GIT_REF",
  "GIT_SOURCE",
  "GIT_USER",
  "GIT_MAIL",
  "GRADLE_PREWARM",
  "SCORPIO_GITHUB_CLIENT_ID",
  "SCORPIO_GITHUB_PRIVATE_REPOS",
  "SCORPIO_GITHUB_HOST",
] as const satisfies Array<string>;

/** The host name of a GitHub host setting, which may be a bare host ("github.com") or an origin URL. */
export function gitHubHostname(value: string | undefined): string {
  const host = value?.trim() || "github.com";
  try {
    return new URL(host.includes("://") ? host : `https://${host}`).hostname.toLowerCase();
  } catch {
    return host.toLowerCase();
  }
}

/**
 * Default prewarm level for Artemis exercises when the environment variable is unset. Warming the daemon is cheap and
 * benefits every Gradle session.
 */
export const DEFAULT_GRADLE_PREWARM: GradlePrewarmLevel = "daemon";

/**
 * Default for every other source. Prewarming runs the repository's own `./gradlew` and build scripts, which for an
 * arbitrary repository means running code the student has not looked at yet.
 */
export const DEFAULT_GRADLE_PREWARM_UNTRUSTED: GradlePrewarmLevel = "off";

export function parseGradlePrewarm(
  value: string | undefined,
  fallback: GradlePrewarmLevel = DEFAULT_GRADLE_PREWARM,
): GradlePrewarmLevel {
  const level = value?.trim().toLowerCase();
  if (level === "off" || level === "daemon" || level === "deps" || level === "full") {
    return level;
  }
  if (level) {
    console.warn(`Unknown GRADLE_PREWARM value "${value}", falling back to "${fallback}"`);
  }
  return fallback;
}

/**
 * GIT_SOURCE wins when it names a known source. Otherwise ARTEMIS_URL means Artemis, a GIT_URI on GitHub means GitHub,
 * and anything else is "other".
 */
export function resolveGitSource(
  env: Record<string, string | undefined>,
  gitHubHost: string = "github.com",
): GitSource {
  const explicit = env["GIT_SOURCE"]?.trim().toLowerCase();
  if (explicit === "artemis" || explicit === "github" || explicit === "other") {
    return explicit;
  }
  if (env["ARTEMIS_URL"]) {
    return "artemis";
  }
  try {
    if (env["GIT_URI"] && new URL(env["GIT_URI"]).hostname.toLowerCase() === gitHubHost) {
      return "github";
    }
  } catch {
    // an unparseable GIT_URI is reported when it is used
  }
  return "other";
}

/**
 * A branch, tag or commit to check out after cloning. Rejected when it could be read as an option or a path, or is
 * otherwise not something git would accept as a ref name; git reports anything subtler at checkout.
 */
export function parseGitRef(value: string | undefined): string | undefined {
  const ref = value?.trim();
  if (!ref) {
    return undefined;
  }
  if (ref.length > 255 || ref.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(ref)) {
    console.warn(`Ignoring invalid GIT_REF "${value}"`);
    return undefined;
  }
  return ref;
}

/**
 * Whether the data bridge has delivered the session's environment. The operator injects all of a session's variables
 * in one request, so the first of them to show up means all have.
 *
 * ARTEMIS_URL is deliberately not required: sessions opened from somewhere other than Artemis (e.g. a GitHub link
 * through the landing page) carry GIT_URI but no ARTEMIS_URL, and waiting for it made Scorpio time out and fall back to
 * the process environment, where a warm-pool instance has no GIT_URI, so nothing was cloned.
 */
export function isDataBridgeEnvComplete(env: Record<string, string | undefined>): boolean {
  return Boolean(env["GIT_URI"] || env["THEIA"]);
}

export function parseTheiaEnv(
  env: Record<string, string | undefined>,
  fromDataBridge: boolean = false,
): TheiaEnv {
  const gitUriString = env["GIT_URI"];
  const source = resolveGitSource(env, gitHubHostname(env["SCORPIO_GITHUB_HOST"]));
  return {
    THEIA_FLAG: env["THEIA"] !== undefined || (fromDataBridge && isDataBridgeEnvComplete(env)),
    ARTEMIS_URL: env["ARTEMIS_URL"],
    GIT_URI: gitUriString ? new URL(gitUriString) : undefined,
    GIT_REF: parseGitRef(env["GIT_REF"]),
    GIT_SOURCE: source,
    GIT_USER: env["GIT_USER"],
    GIT_MAIL: env["GIT_MAIL"],
    GRADLE_PREWARM: parseGradlePrewarm(
      env["GRADLE_PREWARM"],
      source === "artemis" ? DEFAULT_GRADLE_PREWARM : DEFAULT_GRADLE_PREWARM_UNTRUSTED,
    ),
    GITHUB_CLIENT_ID: env["SCORPIO_GITHUB_CLIENT_ID"],
    GITHUB_PRIVATE_REPOS: env["SCORPIO_GITHUB_PRIVATE_REPOS"],
    GITHUB_HOST: env["SCORPIO_GITHUB_HOST"],
  };
}

/**
 * Removes credentials embedded in URLs (`https://user:token@host/...`), e.g. from a git error message, before it is
 * shown or logged. Artemis repository URLs carry the student's VCS token.
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@");
}
