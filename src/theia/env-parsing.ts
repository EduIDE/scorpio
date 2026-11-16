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
 * Set by the landing page: `artemis` for trusted Artemis links, `external` for any other repository.
 * Unset (an older landing page) behaves as before.
 */
export type GitSource = "artemis" | "external";

export type TheiaEnv = {
  THEIA_FLAG: boolean;
  ARTEMIS_URL: string | undefined;
  GIT_URI: URL | undefined;
  GIT_REF: string | undefined;
  /** The GIT_REF value that was rejected, so the student can be told the default branch is used. */
  GIT_REF_INVALID: string | undefined;
  GIT_SOURCE: GitSource | undefined;
  TEMPLATE: string | undefined;
  GIT_USER: string | undefined;
  GIT_MAIL: string | undefined;
  GRADLE_PREWARM: GradlePrewarmLevel;
  GRADLE_PREWARM_AUTO_CONFIRM: boolean;
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
  "TEMPLATE",
  "GIT_USER",
  "GIT_MAIL",
  "GRADLE_PREWARM",
  "GRADLE_PREWARM_AUTO_CONFIRM",
  "SCORPIO_GITHUB_CLIENT_ID",
  "SCORPIO_GITHUB_PRIVATE_REPOS",
  "SCORPIO_GITHUB_HOST",
] as const satisfies Array<string>;

/**
 * Default prewarm level when the environment variable is unset. Warming the
 * daemon is cheap and benefits every Gradle session, so it is the safe default.
 */
export const DEFAULT_GRADLE_PREWARM: GradlePrewarmLevel = "daemon";

export function parseGradlePrewarm(value: string | undefined): GradlePrewarmLevel {
  const level = value?.trim().toLowerCase();
  if (level === "off" || level === "daemon" || level === "deps" || level === "full") {
    return level;
  }
  if (level) {
    console.warn(
      `Unknown GRADLE_PREWARM value "${value}", falling back to "${DEFAULT_GRADLE_PREWARM}"`,
    );
  }
  return DEFAULT_GRADLE_PREWARM;
}

/** Anything but `artemis` is untrusted; undefined only for an unset or empty value. */
export function parseGitSource(value: string | undefined): GitSource | undefined {
  const source = value?.trim().toLowerCase();
  if (source === "artemis" || source === "external") {
    return source;
  }
  if (source) {
    // A typo must not make the source trusted: only an unset value keeps the behavior of older landing pages.
    console.warn(`Unknown GIT_SOURCE "${value}", treating it as "external"`);
    return "external";
  }
  return undefined;
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
 * Prewarming runs the Gradle wrapper of the cloned repository, which is code the student did not write.
 * It asks the student first unless the deployment explicitly sets GRADLE_PREWARM_AUTO_CONFIRM to true,
 * for platforms that trust their exercise templates.
 */
export function parseGradlePrewarmAutoConfirm(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
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
  return Boolean(env["GIT_URI"] || env["TEMPLATE"] || env["THEIA"]);
}

export function parseTheiaEnv(
  env: Record<string, string | undefined>,
  fromDataBridge: boolean = false,
): TheiaEnv {
  const gitUriString = env["GIT_URI"];
  const source = parseGitSource(env["GIT_SOURCE"]);
  return {
    THEIA_FLAG: env["THEIA"] !== undefined || (fromDataBridge && isDataBridgeEnvComplete(env)),
    ARTEMIS_URL: env["ARTEMIS_URL"],
    GIT_URI: gitUriString ? new URL(gitUriString) : undefined,
    GIT_REF: parseGitRef(env["GIT_REF"]),
    GIT_REF_INVALID: parseGitRef(env["GIT_REF"]) ? undefined : env["GIT_REF"]?.trim() || undefined,
    GIT_SOURCE: source,
    TEMPLATE: env["TEMPLATE"],
    GIT_USER: env["GIT_USER"],
    GIT_MAIL: env["GIT_MAIL"],
    GRADLE_PREWARM: parseGradlePrewarm(env["GRADLE_PREWARM"]),
    // The image's auto-confirm is meant for trusted Artemis exercises, so an external repository always asks.
    GRADLE_PREWARM_AUTO_CONFIRM:
      parseGradlePrewarmAutoConfirm(env["GRADLE_PREWARM_AUTO_CONFIRM"]) && source !== "external",
    GITHUB_CLIENT_ID: env["SCORPIO_GITHUB_CLIENT_ID"],
    GITHUB_PRIVATE_REPOS: env["SCORPIO_GITHUB_PRIVATE_REPOS"],
    GITHUB_HOST: env["SCORPIO_GITHUB_HOST"],
  };
}

/**
 * Removes credentials embedded in URLs (`https://user:token@host/...`), e.g. from a git or GitHub error message, before
 * it is shown or logged.
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@");
}
