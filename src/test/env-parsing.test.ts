import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isDataBridgeEnvComplete, parseTheiaEnv } from "../theia/env-parsing";

const GITHUB_REPO = "https://github.com/octocat/Hello-World.git";

test("the data bridge is complete with GIT_URI alone, without ARTEMIS_URL", () => {
  // A GitHub link through the landing page: THEIA and GIT_URI, no Artemis.
  assert.equal(isDataBridgeEnvComplete({ GIT_URI: GITHUB_REPO }), true);
  assert.equal(isDataBridgeEnvComplete({ THEIA: "true", GIT_URI: GITHUB_REPO }), true);
});

test("the data bridge is complete with TEMPLATE alone", () => {
  assert.equal(isDataBridgeEnvComplete({ TEMPLATE: "gradle" }), true);
  assert.equal(parseTheiaEnv({ TEMPLATE: "gradle" }).TEMPLATE, "gradle");
});

test("the data bridge is complete for an Artemis launch", () => {
  assert.equal(
    isDataBridgeEnvComplete({
      THEIA: "true",
      ARTEMIS_URL: "https://artemis.example.org",
      GIT_URI: "https://artemis.example.org/git/EX/ex-student.git",
    }),
    true,
  );
});

test("the data bridge is complete for a standalone launch that only marks the session", () => {
  assert.equal(isDataBridgeEnvComplete({ THEIA: "true" }), true);
});

test("the data bridge is not complete before anything arrived", () => {
  assert.equal(isDataBridgeEnvComplete({}), false);
  assert.equal(isDataBridgeEnvComplete({ GIT_URI: "", THEIA: "" }), false);
  assert.equal(isDataBridgeEnvComplete({ GRADLE_PREWARM: "off" }), false);
});

test("a GitHub launch from the data bridge is a Theia session with a repository to clone", () => {
  const env = parseTheiaEnv({ GIT_URI: GITHUB_REPO }, true);

  assert.equal(env.THEIA_FLAG, true);
  assert.equal(env.GIT_URI?.toString(), GITHUB_REPO);
  assert.equal(env.ARTEMIS_URL, undefined);
});

test("THEIA marks a Theia session from the process environment too", () => {
  assert.equal(parseTheiaEnv({ THEIA: "true" }).THEIA_FLAG, true);
  assert.equal(parseTheiaEnv({ GIT_URI: GITHUB_REPO }).THEIA_FLAG, false);
});

test("an Artemis launch keeps its values", () => {
  const env = parseTheiaEnv(
    {
      THEIA: "true",
      ARTEMIS_URL: "https://artemis.example.org",
      GIT_URI: "https://artemis.example.org/git/EX/ex-student.git",
      GIT_USER: "student",
      GIT_MAIL: "student@example.org",
      GRADLE_PREWARM: "deps",
    },
    true,
  );

  assert.deepEqual(
    { ...env, GIT_URI: env.GIT_URI?.toString() },
    {
      THEIA_FLAG: true,
      ARTEMIS_URL: "https://artemis.example.org",
      GIT_URI: "https://artemis.example.org/git/EX/ex-student.git",
      TEMPLATE: undefined,
      GIT_USER: "student",
      GIT_MAIL: "student@example.org",
      GRADLE_PREWARM: "deps",
      GRADLE_PREWARM_AUTO_CONFIRM: true,
    },
  );
});

test("GRADLE_PREWARM falls back to the default for missing or unknown values", () => {
  assert.equal(parseTheiaEnv({}).GRADLE_PREWARM, "daemon");
  assert.equal(parseTheiaEnv({ GRADLE_PREWARM: " FULL " }).GRADLE_PREWARM, "full");
  assert.equal(parseTheiaEnv({ GRADLE_PREWARM: "turbo" }).GRADLE_PREWARM, "daemon");
});

test("GRADLE_PREWARM_AUTO_CONFIRM defaults to true and only an explicit false turns it off", () => {
  assert.equal(parseTheiaEnv({}).GRADLE_PREWARM_AUTO_CONFIRM, true);
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM_AUTO_CONFIRM: " False " }).GRADLE_PREWARM_AUTO_CONFIRM,
    false,
  );
});
