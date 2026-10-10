import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { GradlePrewarmLevel } from "../theia/env-strategy";

/**
 * Gradle invocation per prewarm level. Each higher level warms one more phase of
 * the student's first build during session startup (see the prewarming levels L1-L4):
 *  - "daemon" (L1): start the Gradle daemon so it is warm and reused.
 *  - "deps"   (L3): additionally configure the build and resolve/download dependencies.
 *  - "full"   (L4): additionally compile, leaving the first build near-instant.
 * "off" disables prewarming and is handled before this map is used.
 */
const PREWARM_ARGS: Record<Exclude<GradlePrewarmLevel, "off">, string[]> = {
  daemon: ["--daemon", "help"],
  deps: ["--daemon", "dependencies"],
  full: ["--daemon", "build", "-x", "test"],
};

/**
 * Side effects the prewarm performs, grouped behind a seam so tests can assert the security
 * gate (no build is ever started without explicit user confirmation) without touching the
 * real filesystem, child_process or VS Code.
 */
export type GradlePrewarmEffects = {
  gradlewExists: (gradlewPath: string) => boolean;
  confirm: (projectPath: string) => Promise<boolean>;
  makeExecutable: (gradlewPath: string) => void;
  run: (projectPath: string, args: string[], level: GradlePrewarmLevel) => void;
};

/**
 * Asks the student whether the repository's Gradle wrapper may be executed to prewarm the
 * build. The prompt is non-modal and defaults to "no": if the student ignores it nothing runs,
 * which keeps the feature opt-in while removing the silent code-execution property.
 */
async function promptPrewarmConfirmation(_projectPath: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    "Scorpio can pre-build this exercise with its Gradle wrapper to speed up your first build. " +
      "This runs code from the cloned repository. Only continue for exercises you trust.",
    "Pre-build now",
  );
  return choice === "Pre-build now";
}

function spawnGradle(projectPath: string, args: string[], level: GradlePrewarmLevel): void {
  const child = spawn("./gradlew", args, {
    cwd: projectPath,
    detached: true,
    stdio: "ignore",
  });
  // Detached failures surface asynchronously via the 'error' event, not a throw.
  child.on("error", (error) => {
    console.warn(`Gradle prewarm (${level}) failed to start: ${error.message}`);
  });
  child.unref();
}

export const defaultGradlePrewarmEffects: GradlePrewarmEffects = {
  gradlewExists: (gradlewPath) => fs.existsSync(gradlewPath),
  confirm: promptPrewarmConfirmation,
  makeExecutable: (gradlewPath) => fs.chmodSync(gradlewPath, 0o755),
  run: spawnGradle,
};

/**
 * Pre-warms the Gradle build in the background after cloning a repository, so the student's
 * first build can skip the phases warmed here.
 *
 * Security: `./gradlew` and the bundled Gradle wrapper jar are repository-controlled, so a
 * tampered exercise template could run arbitrary code during prewarm. The wrapper is therefore
 * never executed automatically - the student must explicitly confirm first, and confirmation
 * defaults to "no".
 *
 * Silently skips (no prompt) if:
 * - Prewarming is disabled (`level` is "off")
 * - Running on Windows (not a supported environment)
 * - The project does not contain a `gradlew` file (not a Gradle project)
 */
export async function warmupGradleDaemon(
  projectPath: string,
  level: GradlePrewarmLevel = "daemon",
  effects: GradlePrewarmEffects = defaultGradlePrewarmEffects,
): Promise<void> {
  if (level === "off" || process.platform === "win32") {
    return;
  }

  const gradlewPath = path.join(projectPath, "gradlew");
  if (!effects.gradlewExists(gradlewPath)) {
    return;
  }

  const confirmed = await effects.confirm(projectPath).catch(() => false);
  if (!confirmed) {
    return;
  }

  try {
    effects.makeExecutable(gradlewPath);
    effects.run(projectPath, PREWARM_ARGS[level], level);
  } catch (error: any) {
    console.warn(`Gradle prewarm (${level}) failed: ${error.message}`);
  }
}
