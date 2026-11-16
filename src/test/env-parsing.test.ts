import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  isDataBridgeEnvComplete,
  parseGitRef,
  parseTheiaEnv,
  redactUrlCredentials,
} from "../theia/env-parsing";

const GITHUB_REPO = "https://github.com/octocat/Hello-World.git";

test("the data bridge is complete with GIT_URI alone, without ARTEMIS_URL", () => {
  // A GitHub link through the landing page: THEIA and GIT_URI, no Artemis.
  assert.equal(isDataBridgeEnvComplete({ GIT_URI: GITHUB_REPO }), true);
  assert.equal(
    isDataBridgeEnvComplete({ THEIA: "true", GIT_URI: GITHUB_REPO }),
    true,
  );
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
      GIT_REF: undefined,
      GIT_SOURCE: undefined,
      TEMPLATE: undefined,
      GIT_USER: "student",
      GIT_MAIL: "student@example.org",
      GRADLE_PREWARM: "deps",
      GRADLE_PREWARM_AUTO_CONFIRM: false,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_PRIVATE_REPOS: undefined,
      GITHUB_HOST: undefined,
    },
  );
});

test("GRADLE_PREWARM falls back to the default for missing or unknown values", () => {
  assert.equal(parseTheiaEnv({}).GRADLE_PREWARM, "daemon");
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM: " FULL " }).GRADLE_PREWARM,
    "full",
  );
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM: "turbo" }).GRADLE_PREWARM,
    "daemon",
  );
});

test("GRADLE_PREWARM_AUTO_CONFIRM defaults to false and only an explicit true turns it on", () => {
  assert.equal(parseTheiaEnv({}).GRADLE_PREWARM_AUTO_CONFIRM, false);
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM_AUTO_CONFIRM: "" })
      .GRADLE_PREWARM_AUTO_CONFIRM,
    false,
  );
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM_AUTO_CONFIRM: "yes" })
      .GRADLE_PREWARM_AUTO_CONFIRM,
    false,
  );
  assert.equal(
    parseTheiaEnv({ GRADLE_PREWARM_AUTO_CONFIRM: " True " })
      .GRADLE_PREWARM_AUTO_CONFIRM,
    true,
  );
});

test("GIT_SOURCE accepts artemis and external and ignores anything else", () => {
  assert.equal(
    parseTheiaEnv({ GIT_SOURCE: " External " }).GIT_SOURCE,
    "external",
  );
  assert.equal(parseTheiaEnv({ GIT_SOURCE: "artemis" }).GIT_SOURCE, "artemis");
  assert.equal(parseTheiaEnv({ GIT_SOURCE: "github" }).GIT_SOURCE, undefined);
  assert.equal(parseTheiaEnv({}).GIT_SOURCE, undefined);
});

test("an external source is always asked before Gradle prewarming, whatever the image says", () => {
  const confirm = (extra: Record<string, string>) =>
    parseTheiaEnv({ GRADLE_PREWARM_AUTO_CONFIRM: "true", ...extra })
      .GRADLE_PREWARM_AUTO_CONFIRM;

  assert.equal(confirm({ GIT_SOURCE: "external" }), false);
  assert.equal(confirm({ GIT_SOURCE: "artemis" }), true);
  assert.equal(confirm({}), true);
  // The trust decision is not inferred from ARTEMIS_URL or the host of GIT_URI.
  assert.equal(
    confirm({ GIT_SOURCE: "external", ARTEMIS_URL: "https://a.example" }),
    false,
  );
});

test("GIT_REF accepts branch, tag and commit names", () => {
  assert.equal(parseGitRef("main"), "main");
  assert.equal(parseGitRef(" feature/login-form "), "feature/login-form");
  assert.equal(parseGitRef("0123abcd"), "0123abcd");
  assert.equal(parseTheiaEnv({ GIT_REF: "v1.2.0" }).GIT_REF, "v1.2.0");
});

test("GIT_REF rejects options, ranges and other invalid names", () => {
  for (const ref of [
    "",
    "  ",
    "--upload-pack=evil",
    "-b",
    "a..b",
    "a b",
    "HEAD~1",
    "x^",
    "a:b",
    "x@{1}",
    "a\\b",
  ]) {
    assert.equal(parseGitRef(ref), undefined, JSON.stringify(ref));
  }
  assert.equal(parseGitRef("x".repeat(256)), undefined);
});

test("the GitHub overrides pass through", () => {
  const env = parseTheiaEnv({
    SCORPIO_GITHUB_CLIENT_ID: "Iv1.x",
    SCORPIO_GITHUB_PRIVATE_REPOS: "false",
    SCORPIO_GITHUB_HOST: "ghe.example.org",
  });
  assert.equal(env.GITHUB_CLIENT_ID, "Iv1.x");
  assert.equal(env.GITHUB_PRIVATE_REPOS, "false");
  assert.equal(env.GITHUB_HOST, "ghe.example.org");
});

test("credentials in URLs are redacted", () => {
  assert.equal(
    redactUrlCredentials(
      "fatal: unable to access 'https://user:tok@host.example/o/r.git/': 403",
    ),
    "fatal: unable to access 'https://***@host.example/o/r.git/': 403",
  );
  assert.equal(
    redactUrlCredentials("https://github.com/o/r.git"),
    "https://github.com/o/r.git",
  );
});
