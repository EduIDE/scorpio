import * as assert from "assert";

import { cloneByGivenURL, gitClientFactory } from "../../participation/cloning.service";

type CloneCall = { repo: string; local: string; options: unknown };

suite("cloneByGivenURL httpExtraHeader handling", () => {
  const originalSimpleGit = gitClientFactory.simpleGit;
  let cloneCalls: CloneCall[];

  setup(() => {
    cloneCalls = [];
    // Swap the git factory for a fake that records the arguments passed to clone().
    gitClientFactory.simpleGit = (() => {
      return {
        clone: async (repo: string, local: string, options: unknown) => {
          cloneCalls.push({ repo, local, options });
          return "";
        },
      };
    }) as unknown as typeof gitClientFactory.simpleGit;
  });

  teardown(() => {
    gitClientFactory.simpleGit = originalSimpleGit;
  });

  test("passes -c http.extraHeader when a header is provided", async () => {
    await cloneByGivenURL(
      new URL("https://gitea.example.com/course/repo.git"),
      "/dest",
      { httpExtraHeader: "Authorization: Bearer TESTTOKEN" },
    );

    assert.strictEqual(cloneCalls.length, 1);
    assert.deepStrictEqual(cloneCalls[0].options, [
      "-c",
      "http.extraHeader=Authorization: Bearer TESTTOKEN",
    ]);
  });

  test("passes no extra config when no header is provided (unchanged path)", async () => {
    await cloneByGivenURL(new URL("https://gitea.example.com/course/repo.git"), "/dest");

    assert.strictEqual(cloneCalls.length, 1);
    assert.deepStrictEqual(cloneCalls[0].options, []);
  });
});
