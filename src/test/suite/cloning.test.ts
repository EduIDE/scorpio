import * as assert from "assert";

import { cloneByGivenURL, gitClientFactory } from "../../participation/cloning.service";

type CloneCall = { repo: string; local: string; options: unknown };
type ConfigCall = { key: string; value: string; append: unknown; scope: unknown };

suite("cloneByGivenURL httpExtraHeader handling", () => {
  const originalSimpleGit = gitClientFactory.simpleGit;
  let cloneCalls: CloneCall[];
  let configCalls: ConfigCall[];
  let envCalls: Record<string, string>[];

  setup(() => {
    cloneCalls = [];
    configCalls = [];
    envCalls = [];
    // Swap the git factory for a fake that records env(), clone() and addConfig() arguments.
    gitClientFactory.simpleGit = (() => {
      const fake: any = {
        env: (env: Record<string, string>) => {
          envCalls.push(env);
          return fake;
        },
        clone: async (repo: string, local: string, options: unknown) => {
          cloneCalls.push({ repo, local, options });
          return "";
        },
        addConfig: async (key: string, value: string, append: unknown, scope: unknown) => {
          configCalls.push({ key, value, append, scope });
          return "";
        },
      };
      return fake;
    }) as unknown as typeof gitClientFactory.simpleGit;
  });

  teardown(() => {
    gitClientFactory.simpleGit = originalSimpleGit;
  });

  test("injects the auth header via GIT_CONFIG_* env, never on the command line", async () => {
    await cloneByGivenURL(new URL("https://gitea.example.com/course/repo.git"), "/dest", {
      httpExtraHeader: "Authorization: Bearer TESTTOKEN",
    });

    assert.strictEqual(cloneCalls.length, 1);
    // The token must not be passed as a clone argument (would be visible in `ps`).
    assert.deepStrictEqual(cloneCalls[0].options, undefined);
    assert.ok(
      !JSON.stringify(cloneCalls[0]).includes("TESTTOKEN"),
      "clone arguments must not contain the token",
    );

    // The header is supplied through the git process environment instead.
    assert.strictEqual(envCalls.length, 1);
    assert.strictEqual(envCalls[0].GIT_CONFIG_COUNT, "1");
    assert.strictEqual(envCalls[0].GIT_CONFIG_KEY_0, "http.extraHeader");
    assert.strictEqual(envCalls[0].GIT_CONFIG_VALUE_0, "Authorization: Bearer TESTTOKEN");
  });

  test("persists the auth header into the cloned repo for later fetch/push", async () => {
    await cloneByGivenURL(new URL("https://gitea.example.com/course/repo.git"), "/dest", {
      httpExtraHeader: "Authorization: Bearer TESTTOKEN",
    });

    assert.strictEqual(configCalls.length, 1);
    assert.strictEqual(configCalls[0].key, "http.extraHeader");
    assert.strictEqual(configCalls[0].value, "Authorization: Bearer TESTTOKEN");
    assert.strictEqual(configCalls[0].scope, "local");
  });

  test("does not touch env or config when no header is provided (unchanged path)", async () => {
    await cloneByGivenURL(new URL("https://gitea.example.com/course/repo.git"), "/dest");

    assert.strictEqual(cloneCalls.length, 1);
    assert.deepStrictEqual(cloneCalls[0].options, undefined);
    assert.strictEqual(envCalls.length, 0);
    assert.strictEqual(configCalls.length, 0);
  });
});
