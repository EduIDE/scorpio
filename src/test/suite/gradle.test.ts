import * as assert from "assert";

import { GradlePrewarmEffects, warmupGradleDaemon } from "../../participation/gradle.service";

type RunCall = { projectPath: string; args: string[]; level: string };

function makeEffects(overrides: Partial<GradlePrewarmEffects>) {
  const runCalls: RunCall[] = [];
  const effects: GradlePrewarmEffects = {
    gradlewExists: () => true,
    confirm: async () => true,
    makeExecutable: () => {},
    run: (projectPath, args, level) => {
      runCalls.push({ projectPath, args, level });
    },
    ...overrides,
  };
  return { effects, runCalls };
}

suite("warmupGradleDaemon security gate", () => {
  test("does not run the Gradle wrapper when the user declines", async () => {
    const { effects, runCalls } = makeEffects({ confirm: async () => false });

    await warmupGradleDaemon("/repo", "daemon", effects);

    assert.strictEqual(runCalls.length, 0, "no build may start without confirmation");
  });

  test("runs the Gradle wrapper only after explicit confirmation", async () => {
    const { effects, runCalls } = makeEffects({ confirm: async () => true });

    await warmupGradleDaemon("/repo", "daemon", effects);

    assert.strictEqual(runCalls.length, 1);
    assert.deepStrictEqual(runCalls[0].args, ["--daemon", "help"]);
  });

  test("never prompts or runs when prewarming is disabled", async () => {
    let confirmed = false;
    const { effects, runCalls } = makeEffects({
      confirm: async () => {
        confirmed = true;
        return true;
      },
    });

    await warmupGradleDaemon("/repo", "off", effects);

    assert.strictEqual(confirmed, false, "disabled prewarm must not prompt");
    assert.strictEqual(runCalls.length, 0);
  });

  test("does not prompt when the project has no gradlew", async () => {
    let confirmed = false;
    const { effects, runCalls } = makeEffects({
      gradlewExists: () => false,
      confirm: async () => {
        confirmed = true;
        return true;
      },
    });

    await warmupGradleDaemon("/repo", "full", effects);

    assert.strictEqual(confirmed, false, "non-Gradle project must not prompt");
    assert.strictEqual(runCalls.length, 0);
  });

  test("treats a confirmation failure as a decline", async () => {
    const { effects, runCalls } = makeEffects({
      confirm: async () => {
        throw new Error("prompt failed");
      },
    });

    await warmupGradleDaemon("/repo", "deps", effects);

    assert.strictEqual(runCalls.length, 0);
  });
});
