import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
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
 * Pre-warms the Gradle build in the background after cloning a repository, so the
 * student's first build can skip the phases warmed here. Runs detached and never
 * blocks the caller.
 *
 * Silently skips if:
 * - Prewarming is disabled (`level` is "off")
 * - Running on Windows (not a supported environment)
 * - The project does not contain a `gradlew` file (not a Gradle project)
 */
export function warmupGradleDaemon(
  projectPath: string,
  level: GradlePrewarmLevel = "daemon",
): void {
  if (level === "off" || process.platform === "win32") {
    return;
  }

  const gradlewPath = path.join(projectPath, "gradlew");
  if (!fs.existsSync(gradlewPath)) {
    return;
  }

  try {
    fs.chmodSync(gradlewPath, 0o755);

    const child = spawn("./gradlew", PREWARM_ARGS[level], {
      cwd: projectPath,
      detached: true,
      stdio: "ignore",
    });
    // Detached failures surface asynchronously via the 'error' event, not the throw below.
    child.on("error", (error) => {
      console.warn(`Gradle prewarm (${level}) failed to start: ${error.message}`);
    });
    child.unref();
  } catch (error: any) {
    console.warn(`Gradle prewarm (${level}) failed: ${error.message}`);
  }
}
