import "./vscode-stub";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GradlePrewarmEffects, warmupGradleDaemon } from "../participation/gradle.service";

function recordingEffects(overrides: Partial<GradlePrewarmEffects> = {}) {
  const runs: string[][] = [];
  const effects: GradlePrewarmEffects = {
    gradlewExists: () => true,
    confirm: async () => true,
    makeExecutable: () => {},
    run: (_projectPath, args) => runs.push(args),
    ...overrides,
  };
  return { runs, effects };
}

test("prewarm runs without asking when auto confirm is on", async () => {
  const { runs, effects } = recordingEffects({
    confirm: async () => assert.fail("must not ask"),
  });
  await warmupGradleDaemon("/repo", "daemon", true, effects);
  assert.deepEqual(runs, [["--daemon", "help"]]);
});

test("nothing runs without confirmation when auto confirm is off", async () => {
  const { runs, effects } = recordingEffects({ confirm: async () => false });
  await warmupGradleDaemon("/repo", "daemon", false, effects);
  assert.deepEqual(runs, []);
});

test("a failed confirmation prompt counts as no", async () => {
  const { runs, effects } = recordingEffects({
    confirm: async () => {
      throw new Error("prompt failed");
    },
  });
  await warmupGradleDaemon("/repo", "daemon", false, effects);
  assert.deepEqual(runs, []);
});

test("prewarm skips non-Gradle projects and the off level", async () => {
  const noWrapper = recordingEffects({ gradlewExists: () => false });
  await warmupGradleDaemon("/repo", "daemon", true, noWrapper.effects);
  assert.deepEqual(noWrapper.runs, []);

  const off = recordingEffects();
  await warmupGradleDaemon("/repo", "off", true, off.effects);
  assert.deepEqual(off.runs, []);
});
