import { vscodeStub } from "./vscode-stub";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DataBridgeStrategy } from "../theia/env-strategy";

afterEach(() => {
  delete process.env.GRADLE_PREWARM_AUTO_CONFIRM;
});

async function loadWithBridge(payload: Record<string, string>) {
  vscodeStub.extensions.getExtension = () => ({ isActive: true });
  vscodeStub.commands.executeCommand = async () => payload;
  return new DataBridgeStrategy().load();
}

test("a value delivered through the data bridge cannot turn Gradle auto-confirm on", async () => {
  const env = await loadWithBridge({
    GIT_URI: "https://github.com/example/repo",
    GRADLE_PREWARM_AUTO_CONFIRM: "true",
  });

  assert.equal(env.GRADLE_PREWARM_AUTO_CONFIRM, false);
});

test("the pod's own GRADLE_PREWARM_AUTO_CONFIRM counts in data bridge mode", async () => {
  process.env.GRADLE_PREWARM_AUTO_CONFIRM = "true";

  const env = await loadWithBridge({ GIT_URI: "https://github.com/example/repo" });

  assert.equal(env.GRADLE_PREWARM_AUTO_CONFIRM, true);
});
