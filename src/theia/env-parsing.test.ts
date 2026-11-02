import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  gitHubHostname,
  isDataBridgeEnvComplete,
  parseGitRef,
  parseTheiaEnv,
  redactUrlCredentials,
  resolveGitSource,
} from "./env-parsing";

const GITHUB_REPO = "https://github.com/octocat/Hello-World.git";

test("the data bridge is complete with GIT_URI alone, without ARTEMIS_URL", () => {
  // A GitHub link through the landing page: THEIA and GIT_URI, no Artemis.
  assert.equal(isDataBridgeEnvComplete({ GIT_URI: GITHUB_REPO }), true);
  assert.equal(isDataBridgeEnvComplete({ THEIA: "true", GIT_URI: GITHUB_REPO }), true);
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
      GIT_SOURCE: "artemis",
      GIT_USER: "student",
      GIT_MAIL: "student@example.org",
      GRADLE_PREWARM: "deps",
      GITHUB_CLIENT_ID: undefined,
      GITHUB_PRIVATE_REPOS: undefined,
      GITHUB_HOST: undefined,
    },
  );
});

test("GitHub overrides pass through, and SCORPIO_GITHUB_HOST decides what counts as GitHub", () => {
  const env = parseTheiaEnv({
    GIT_URI: "https://ghe.example.org/o/r.git",
    SCORPIO_GITHUB_CLIENT_ID: "Iv1.x",
    SCORPIO_GITHUB_PRIVATE_REPOS: "false",
    SCORPIO_GITHUB_HOST: "https://ghe.example.org",
  });
  assert.equal(env.GIT_SOURCE, "github");
  assert.equal(env.GITHUB_CLIENT_ID, "Iv1.x");
  assert.equal(env.GITHUB_PRIVATE_REPOS, "false");
  assert.equal(gitHubHostname("http://fake-github:8080"), "fake-github");
  assert.equal(gitHubHostname(undefined), "github.com");
});

test("GRADLE_PREWARM defaults to daemon for Artemis and to off for other sources", () => {
  assert.equal(
    parseTheiaEnv({ ARTEMIS_URL: "https://artemis.example.org" }).GRADLE_PREWARM,
    "daemon",
  );
  assert.equal(parseTheiaEnv({ GIT_URI: GITHUB_REPO }).GRADLE_PREWARM, "off");
  assert.equal(parseTheiaEnv({}).GRADLE_PREWARM, "off");
});

test("an explicit GRADLE_PREWARM wins, unknown values fall back to the source's default", () => {
  assert.equal(
    parseTheiaEnv({ GIT_URI: GITHUB_REPO, GRADLE_PREWARM: " FULL " }).GRADLE_PREWARM,
    "full",
  );
  assert.equal(
    parseTheiaEnv({ ARTEMIS_URL: "https://a.example", GRADLE_PREWARM: "turbo" }).GRADLE_PREWARM,
    "daemon",
  );
  assert.equal(
    parseTheiaEnv({ GIT_URI: GITHUB_REPO, GRADLE_PREWARM: "turbo" }).GRADLE_PREWARM,
    "off",
  );
});

test("GIT_SOURCE: explicit value, then ARTEMIS_URL, then the host of GIT_URI", () => {
  assert.equal(
    resolveGitSource({ GIT_SOURCE: "GitHub", ARTEMIS_URL: "https://a.example" }),
    "github",
  );
  assert.equal(resolveGitSource({ GIT_SOURCE: "nonsense", GIT_URI: GITHUB_REPO }), "github");
  assert.equal(
    resolveGitSource({ ARTEMIS_URL: "https://a.example", GIT_URI: GITHUB_REPO }),
    "artemis",
  );
  assert.equal(resolveGitSource({ GIT_URI: "https://GitHub.com/o/r.git" }), "github");
  assert.equal(resolveGitSource({ GIT_URI: "https://gitlab.example.org/o/r.git" }), "other");
  assert.equal(
    resolveGitSource({ GIT_URI: "https://ghe.example.org/o/r.git" }, "ghe.example.org"),
    "github",
  );
  assert.equal(resolveGitSource({ GIT_URI: "not a url" }), "other");
  assert.equal(resolveGitSource({}), "other");
});

test("GIT_REF accepts branch, tag and commit names", () => {
  assert.equal(parseGitRef("main"), "main");
  assert.equal(parseGitRef(" feature/login-form "), "feature/login-form");
  assert.equal(parseGitRef("v1.2.0"), "v1.2.0");
  assert.equal(parseGitRef("0123abcd"), "0123abcd");
  assert.equal(parseTheiaEnv({ GIT_REF: "feature/x" }).GIT_REF, "feature/x");
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

test("credentials in URLs are redacted", () => {
  assert.equal(
    redactUrlCredentials(
      "fatal: unable to access 'https://student1:s3cr3t-token@artemis.example.org/git/EX/ex.git/': 403",
    ),
    "fatal: unable to access 'https://***@artemis.example.org/git/EX/ex.git/': 403",
  );
  assert.equal(
    redactUrlCredentials("https://token@github.com/o/r.git"),
    "https://***@github.com/o/r.git",
  );
  assert.equal(redactUrlCredentials("https://github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(redactUrlCredentials("mail me at a@b.example"), "mail me at a@b.example");
});
