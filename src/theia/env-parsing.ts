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

export type TheiaEnv = {
  THEIA_FLAG: boolean;
  ARTEMIS_URL: string | undefined;
  GIT_URI: URL | undefined;
  GIT_USER: string | undefined;
  GIT_MAIL: string | undefined;
  GRADLE_PREWARM: GradlePrewarmLevel;
  GRADLE_PREWARM_AUTO_CONFIRM: boolean;
};

export const ENV_KEYS = [
  "THEIA",
  "ARTEMIS_URL",
  "GIT_URI",
  "GIT_USER",
  "GIT_MAIL",
  "GRADLE_PREWARM",
  "GRADLE_PREWARM_AUTO_CONFIRM",
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

/**
 * Prewarming runs the Gradle wrapper of the cloned repository. Exercise templates come from a
 * trusted Artemis by default, so it runs without asking. Set GRADLE_PREWARM_AUTO_CONFIRM to false
 * where they are not trusted: the student then has to confirm first.
 */
export function parseGradlePrewarmAutoConfirm(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
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
  return {
    THEIA_FLAG: env["THEIA"] !== undefined || (fromDataBridge && isDataBridgeEnvComplete(env)),
    ARTEMIS_URL: env["ARTEMIS_URL"],
    GIT_URI: gitUriString ? new URL(gitUriString) : undefined,
    GIT_USER: env["GIT_USER"],
    GIT_MAIL: env["GIT_MAIL"],
    GRADLE_PREWARM: parseGradlePrewarm(env["GRADLE_PREWARM"]),
    GRADLE_PREWARM_AUTO_CONFIRM: parseGradlePrewarmAutoConfirm(env["GRADLE_PREWARM_AUTO_CONFIRM"]),
  };
}
