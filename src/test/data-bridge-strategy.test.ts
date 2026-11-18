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

  const env = await loadWithBridge({
    GIT_URI: "https://github.com/example/repo",
  });

  assert.equal(env.GRADLE_PREWARM_AUTO_CONFIRM, true);
});

test("the student is told that scorpio waits for the exercise details", async () => {
  vscodeStub.window.progress.length = 0;

  await loadWithBridge({ GIT_URI: "https://github.com/example/repo" });

  assert.deepEqual(vscodeStub.window.progress, ["Waiting for your exercise details"]);
});

function stubExtensions(installed: string[]) {
  const asked: string[] = [];
  vscodeStub.extensions.getExtension = (id: string) => {
    asked.push(id);
    return installed.includes(id) ? { isActive: true } : undefined;
  };
  return asked;
}

test("eduide.eduide-session is used when it is installed", async () => {
  const asked = stubExtensions(["eduide.eduide-session", "tum-aet.data-bridge"]);
  vscodeStub.commands.executeCommand = async () => ({ GIT_URI: "https://github.com/example/repo" });

  const env = await new DataBridgeStrategy().load();

  assert.deepEqual(asked, ["eduide.eduide-session", "eduide.eduide-session"]);
  assert.equal(env.GIT_URI?.href, "https://github.com/example/repo");
});

test("tum-aet.data-bridge is used when eduide.eduide-session is missing", async () => {
  const asked = stubExtensions(["tum-aet.data-bridge"]);
  vscodeStub.commands.executeCommand = async () => ({ GIT_URI: "https://github.com/example/repo" });

  const env = await new DataBridgeStrategy().load();

  assert.deepEqual(asked, ["eduide.eduide-session", "tum-aet.data-bridge", "tum-aet.data-bridge"]);
  assert.equal(env.GIT_URI?.href, "https://github.com/example/repo");
});

test("without either extension scorpio warns and falls back to the process env", async () => {
  stubExtensions([]);
  let polled = false;
  vscodeStub.commands.executeCommand = async () => {
    polled = true;
    return {};
  };
  vscodeStub.window.warnings.length = 0;

  await new DataBridgeStrategy().load();

  assert.equal(polled, false);
  assert.equal(vscodeStub.window.warnings.length, 1);
});
