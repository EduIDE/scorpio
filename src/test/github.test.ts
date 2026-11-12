import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitHubApi } from "../github/api";
import { baseGitEnv, withAskpass } from "../github/askpass";
import { resolveGitHubConfig } from "../github/config";
import {
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  type FetchLike,
} from "../github/device-flow";
import {
  listUnpushedCommits,
  reauthorUnpushedCommits,
  sessionAuthoredCommits,
  setRepositoryIdentity,
} from "../github/identity";
import {
  appAuthorizationUrl,
  compareUrl,
  freeRemoteName,
  gitHubIdentity,
  hasScope,
  isSessionIdentity,
  orgAccessRestriction,
  parseRepoFromUrl,
  parseScopes,
  sameRepository,
} from "../github/repo";

const config = resolveGitHubConfig({ clientId: "Iv1.public" }, {});

/** A fetch that answers from a list and records every request. */
function fakeFetch(answers: Array<{ status?: number; body: any }>) {
  const calls: Array<{
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const answer = answers.shift() ?? { status: 500, body: {} };
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body };
  };
  return { fetchFn, calls };
}

// --- config -----------------------------------------------------------------------------------------------------

test("config: github.com by default, off without a client ID", () => {
  assert.deepEqual(resolveGitHubConfig({}, {}), {
    enabled: false,
    clientId: "",
    allowPrivate: true,
    host: "github.com",
    webOrigin: "https://github.com",
    apiBase: "https://api.github.com",
  });
  assert.equal(config.enabled, true);
});

test("config: environment overrides win over settings", () => {
  const resolved = resolveGitHubConfig(
    { clientId: "from-settings", allowPrivateRepositories: true, host: "github.com" },
    { GITHUB_CLIENT_ID: "from-env", GITHUB_PRIVATE_REPOS: "false", GITHUB_HOST: "ghe.example.org" },
  );
  assert.equal(resolved.clientId, "from-env");
  assert.equal(resolved.allowPrivate, false);
  assert.equal(resolved.webOrigin, "https://ghe.example.org");
  assert.equal(resolved.apiBase, "https://ghe.example.org/api/v3");
  assert.equal(
    resolveGitHubConfig({ allowPrivateRepositories: false }, { GITHUB_PRIVATE_REPOS: "nonsense" })
      .allowPrivate,
    false,
  );
});

test("config: a full origin is accepted as host, e.g. a test server", () => {
  const resolved = resolveGitHubConfig(
    { clientId: "x" },
    { GITHUB_HOST: "http://fake-github:8080" },
  );
  assert.equal(resolved.host, "fake-github:8080");
  assert.equal(resolved.webOrigin, "http://fake-github:8080");
  assert.equal(resolved.apiBase, "http://fake-github:8080/api/v3");
});

// --- repo helpers -----------------------------------------------------------------------------------------------

test("repo: owner/repo from GitHub remote URLs only", () => {
  assert.deepEqual(parseRepoFromUrl("https://github.com/octocat/Hello-World.git", config), {
    owner: "octocat",
    repo: "Hello-World",
  });
  assert.deepEqual(parseRepoFromUrl("https://GitHub.com/octocat/hello.world/", config), {
    owner: "octocat",
    repo: "hello.world",
  });
  assert.deepEqual(parseRepoFromUrl("https://user:token@github.com/o/r", config), {
    owner: "o",
    repo: "r",
  });
  assert.equal(parseRepoFromUrl("https://gitlab.com/o/r.git", config), undefined);
  assert.equal(parseRepoFromUrl("https://github.com/o", config), undefined);
  assert.equal(parseRepoFromUrl("https://github.com/o/r/tree/main", config), undefined);
  assert.equal(parseRepoFromUrl("git@github.com:o/r.git", config), undefined);
  assert.equal(parseRepoFromUrl(undefined, config), undefined);
});

test("repo: scopes", () => {
  assert.deepEqual(parseScopes("public_repo, read:user"), ["public_repo", "read:user"]);
  assert.deepEqual(parseScopes(undefined), []);
  assert.equal(hasScope(["public_repo"], "public_repo"), true);
  assert.equal(hasScope(["public_repo"], "repo"), false);
  assert.equal(hasScope(["repo"], "public_repo"), true, "repo includes public_repo");
  assert.equal(hasScope([], "public_repo"), false);
});

test("repo: identity uses the noreply address", () => {
  assert.deepEqual(gitHubIdentity({ id: 42, login: "ada", name: "Ada Lovelace" }), {
    name: "Ada Lovelace",
    email: "42+ada@users.noreply.github.com",
  });
  assert.equal(gitHubIdentity({ id: 1, login: "bob", name: null }).name, "bob");
  assert.equal(isSessionIdentity("session-anonymous-abc-123@artemis-theia.de"), true);
  assert.equal(isSessionIdentity("42+ada@users.noreply.github.com"), false);
});

test("repo: compare URL, remote names, same repository", () => {
  assert.equal(
    compareUrl(config, { owner: "teacher", repo: "task" }, "main", "ada", "feature/x"),
    "https://github.com/teacher/task/compare/main...ada:feature%2Fx?expand=1",
  );
  assert.equal(freeRemoteName("fork", ["origin"]), "fork");
  assert.equal(freeRemoteName("fork", ["origin", "fork", "fork-2"]), "fork-3");
  assert.equal(
    sameRepository("https://github.com/ada/task.git", "https://GITHUB.com/ada/task"),
    true,
  );
  assert.equal(
    sameRepository("https://t@github.com/ada/task/", "https://github.com/ada/task.git"),
    true,
  );
  assert.equal(sameRepository("https://github.com/ada/task", "https://github.com/bob/task"), false);
  assert.equal(sameRepository(undefined, "https://github.com/ada/task"), false);
});

// GitHub's wording, from the REST API (403) and from git (the body of the 403, which git prints as "remote:").
const RESTRICTED =
  "Although you appear to have the correct authorization credentials, the `course-org` organization has enabled " +
  "OAuth App access restrictions, meaning that data access to third-parties is limited. For more information on " +
  "these restrictions, including how to approve this app, visit " +
  "https://docs.github.com/articles/restricting-access-to-your-organization-s-data/";

test("repo: recognizes an organization's OAuth App access restriction", () => {
  assert.deepEqual(orgAccessRestriction(`Could not read course-org/task: ${RESTRICTED}`), {
    org: "course-org",
  });
  assert.deepEqual(
    orgAccessRestriction(
      `remote: ${RESTRICTED}\nfatal: unable to access 'https://github.com/course-org/task.git/': ` +
        "The requested URL returned error: 403",
    ),
    { org: "course-org" },
  );
  assert.deepEqual(
    orgAccessRestriction(
      "see https://docs.github.com/articles/restricting-access-to-your-organization-s-data/",
    ),
    { org: undefined },
  );
  assert.equal(
    orgAccessRestriction("remote: Permission to ada/task.git denied to bob."),
    undefined,
  );
  assert.equal(orgAccessRestriction("Could not read ada/task: Bad credentials"), undefined);
});

test("repo: the student's page for the OAuth App", () => {
  assert.equal(
    appAuthorizationUrl(config),
    "https://github.com/settings/connections/applications/Iv1.public",
  );
  assert.equal(
    appAuthorizationUrl(
      resolveGitHubConfig({ clientId: "abc", host: "http://fake-github:8080" }, {}),
    ),
    "http://fake-github:8080/settings/connections/applications/abc",
  );
});

// --- device flow ------------------------------------------------------------------------------------------------

const noSleep = async () => undefined;

test("device flow: requests a code with the client ID and scope, form-encoded", async () => {
  const { fetchFn, calls } = fakeFetch([
    {
      body: {
        device_code: "dc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        interval: 5,
        expires_in: 900,
      },
    },
  ]);
  const code = await requestDeviceCode(config, "public_repo", fetchFn);

  assert.equal(code.userCode, "ABCD-1234");
  assert.equal(calls[0].url, "https://github.com/login/device/code");
  assert.equal(calls[0].headers?.["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
    client_id: "Iv1.public",
    scope: "public_repo",
  });
  assert.equal(calls[0].body?.includes("secret"), false);
});

test("device flow: a refused code request is an error", async () => {
  const { fetchFn } = fakeFetch([
    { status: 400, body: { error: "device_flow_disabled", error_description: "off" } },
  ]);
  await assert.rejects(
    requestDeviceCode(config, "repo", fetchFn),
    (e: DeviceFlowError) => e.code === "device_flow_disabled",
  );
});

test("device flow: waits through pending and slow_down, then returns the token and scopes", async () => {
  const { fetchFn, calls } = fakeFetch([
    { body: { error: "authorization_pending" } },
    { body: { error: "slow_down", interval: 10 } },
    { body: { access_token: "gho_token", scope: "public_repo" } },
  ]);
  const sleeps: number[] = [];
  const token = await pollForToken(
    config,
    { deviceCode: "dc", userCode: "u", verificationUri: "v", interval: 5, expiresIn: 900 },
    fetchFn,
    async (ms) => void sleeps.push(ms),
  );

  assert.deepEqual(token, { token: "gho_token", scopes: ["public_repo"] });
  assert.deepEqual(sleeps, [5000, 5000, 10000]);
  assert.equal(
    new URLSearchParams(calls[0].body).get("grant_type"),
    "urn:ietf:params:oauth:grant-type:device_code",
  );
});

test("device flow: declined, expired and cancelled sign-ins end with their reason", async () => {
  const code = {
    deviceCode: "dc",
    userCode: "u",
    verificationUri: "v",
    interval: 1,
    expiresIn: 900,
  };
  for (const [answer, reason] of [
    ["access_denied", "access_denied"],
    ["expired_token", "expired_token"],
    ["incorrect_device_code", "incorrect_device_code"],
  ]) {
    const { fetchFn } = fakeFetch([{ body: { error: answer } }]);
    await assert.rejects(
      pollForToken(config, code, fetchFn, noSleep),
      (e: DeviceFlowError) => e.code === reason,
    );
  }
  const { fetchFn } = fakeFetch([]);
  await assert.rejects(
    pollForToken(config, code, fetchFn, noSleep, () => true),
    (e: DeviceFlowError) => e.code === "cancelled",
  );
});

test("device flow: gives up when the code expires", async () => {
  let clock = 0;
  const { fetchFn } = fakeFetch(
    Array.from({ length: 10 }, () => ({ body: { error: "authorization_pending" } })),
  );
  await assert.rejects(
    pollForToken(
      config,
      { deviceCode: "dc", userCode: "u", verificationUri: "v", interval: 5, expiresIn: 12 },
      fetchFn,
      async (ms) => void (clock += ms),
      () => false,
      () => clock,
    ),
    (e: DeviceFlowError) => e.code === "expired_token",
  );
});

// --- API --------------------------------------------------------------------------------------------------------

test("api: a 404 repository is undefined, permissions are mapped, the token is a bearer token", async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 404, body: { message: "Not Found" } },
    {
      body: {
        name: "task",
        owner: { login: "teacher" },
        private: false,
        clone_url: "https://github.com/teacher/task.git",
        default_branch: "main",
        permissions: { push: false },
      },
    },
  ]);
  const api = new GitHubApi(config, fetchFn, "gho_token");

  assert.equal(await api.getRepo({ owner: "x", repo: "missing" }), undefined);
  assert.deepEqual(await api.getRepo({ owner: "teacher", repo: "task" }), {
    owner: "teacher",
    repo: "task",
    private: false,
    cloneUrl: "https://github.com/teacher/task.git",
    defaultBranch: "main",
    allowForking: true,
    canPush: false,
  });
  assert.equal(calls[1].url, "https://api.github.com/repos/teacher/task");
  assert.equal(calls[1].headers?.Authorization, "Bearer gho_token");
});

test("api: fork and writable repositories", async () => {
  const repo = (name: string, push: boolean) => ({
    name,
    owner: { login: "ada" },
    clone_url: `https://github.com/ada/${name}.git`,
    default_branch: "main",
    permissions: { push },
  });
  const { fetchFn, calls } = fakeFetch([
    { status: 202, body: repo("task", true) },
    { body: [repo("mine", true), repo("read-only", false)] },
    { status: 403, body: { message: "Resource not accessible by integration" } },
  ]);
  const api = new GitHubApi(config, fetchFn, "t");

  assert.equal((await api.createFork({ owner: "teacher", repo: "task" })).owner, "ada");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(
    (await api.listWritableRepos()).map((r) => r.repo),
    ["mine"],
  );
  await assert.rejects(api.getUser(), /Resource not accessible/);
});

// --- askpass ----------------------------------------------------------------------------------------------------

test("askpass: answers git's prompts from its own environment, then disappears", async () => {
  let script = "";
  const answers = await withAskpass("ada", "gho_secret", async (env) => {
    script = env.GIT_ASKPASS;
    assert.equal(fs.statSync(script).mode & 0o777, 0o700);
    const ask = (prompt: string) =>
      execFileSync(script, [prompt], { env, encoding: "utf8" }).trim();
    return [
      ask("Username for 'https://github.com': "),
      ask("Password for 'https://ada@github.com': "),
    ];
  });

  assert.deepEqual(answers, ["ada", "gho_secret"]);
  assert.equal(fs.existsSync(script), false);
});

test("askpass: the git environment carries no editor or pager variables", () => {
  process.env.EDITOR = "vim";
  process.env.GIT_PAGER = "less";
  try {
    const env = baseGitEnv();
    assert.equal(env.EDITOR, undefined);
    assert.equal(env.GIT_PAGER, undefined);
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.PATH, process.env.PATH);
  } finally {
    delete process.env.EDITOR;
    delete process.env.GIT_PAGER;
  }
});

// --- identity (real git) ----------------------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A clone with one pushed commit and two local commits made with Scorpio's session identity. */
function cloneWithSessionCommits(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorpio-identity-test-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const work = path.join(root, "work");
  git(root, "clone", "--quiet", origin, work);
  git(work, "config", "user.name", "Teacher");
  git(work, "config", "user.email", "teacher@example.org");
  fs.writeFileSync(path.join(work, "a.txt"), "a\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "pushed");
  git(work, "push", "--quiet", "origin", "main");
  git(work, "config", "user.name", "session-anonymous-x");
  git(work, "config", "user.email", "session-anonymous-x@artemis-theia.de");
  fs.writeFileSync(path.join(work, "b.txt"), "b\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "local 1");
  fs.writeFileSync(path.join(work, "c.txt"), "c\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "local 2");
  return work;
}

test("identity: finds the unpushed commits made with the session identity", async () => {
  const work = cloneWithSessionCommits();
  const unpushed = await listUnpushedCommits(work);

  assert.equal(unpushed.length, 2);
  assert.equal(sessionAuthoredCommits(unpushed).length, 2);
  assert.equal(unpushed[0].parents.length, 1);
});

test("identity: re-authors only the unpushed commits, keeping uncommitted work", async () => {
  const work = cloneWithSessionCommits();
  fs.writeFileSync(path.join(work, "dirty.txt"), "not committed\n");
  await setRepositoryIdentity(work, { name: "Ada", email: "42+ada@users.noreply.github.com" });

  assert.equal(await reauthorUnpushedCommits(work), 2);
  assert.equal(
    git(work, "log", "--format=%an <%ae>"),
    [
      "Ada <42+ada@users.noreply.github.com>",
      "Ada <42+ada@users.noreply.github.com>",
      "Teacher <teacher@example.org>",
    ].join("\n"),
  );
  assert.equal(fs.readFileSync(path.join(work, "dirty.txt"), "utf8"), "not committed\n");
  assert.equal(git(work, "config", "--local", "user.email"), "42+ada@users.noreply.github.com");
});

test("identity: refuses to flatten a merge among the unpushed commits", async () => {
  const work = cloneWithSessionCommits();
  git(work, "switch", "--quiet", "-c", "side", "HEAD~1");
  fs.writeFileSync(path.join(work, "d.txt"), "d\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "side");
  git(work, "switch", "--quiet", "main");
  git(work, "merge", "--quiet", "--no-edit", "side");

  await assert.rejects(reauthorUnpushedCommits(work), /merge/);
});
