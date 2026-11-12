import "./vscode-stub";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { cloneByGivenURL } from "../participation/cloning.service";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.org",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.org",
    },
  }).trim();
}

/** A bare repository with `main`, a `feature/x` branch and a `v1` tag on the first commit. */
function makeRepository(): { url: URL; firstCommit: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scorpio-clone-test-"));
  const work = path.join(root, "work");
  fs.mkdirSync(work);
  git(work, "init", "--quiet", "--initial-branch=main");
  fs.writeFileSync(path.join(work, "file.txt"), "first\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "first");
  const firstCommit = git(work, "rev-parse", "HEAD");
  git(work, "tag", "v1");
  git(work, "switch", "--quiet", "-c", "feature/x");
  fs.writeFileSync(path.join(work, "file.txt"), "feature\n");
  git(work, "commit", "--quiet", "-am", "feature");
  git(work, "switch", "--quiet", "main");
  fs.writeFileSync(path.join(work, "file.txt"), "main\n");
  git(work, "commit", "--quiet", "-am", "main");
  const bare = path.join(root, "repo.git");
  git(root, "clone", "--quiet", "--bare", work, bare);
  return { url: pathToFileURL(bare), firstCommit };
}

function emptyWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "scorpio-workspace-"));
  fs.mkdirSync(path.join(workspace, ".vscode"));
  fs.writeFileSync(path.join(workspace, ".vscode", "settings.json"), '{ "kept": true }\n');
  return workspace;
}

const read = (workspace: string) => fs.readFileSync(path.join(workspace, "file.txt"), "utf8");

test("without a ref the default branch is cloned into the workspace root", async () => {
  const { url } = makeRepository();
  const workspace = emptyWorkspace();

  await cloneByGivenURL(url, workspace, { mode: "workspace-root" });

  assert.equal(read(workspace), "main\n");
  assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(
    fs.readFileSync(path.join(workspace, ".vscode", "settings.json"), "utf8"),
    '{ "kept": true }\n',
  );
});

test("a branch ref is checked out as a local branch", async () => {
  const { url } = makeRepository();
  const workspace = emptyWorkspace();

  await cloneByGivenURL(url, workspace, { mode: "workspace-root", ref: "feature/x" });

  assert.equal(read(workspace), "feature\n");
  assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD"), "feature/x");
});

test("a tag or commit ref is checked out", async () => {
  const { url, firstCommit } = makeRepository();

  const byTag = emptyWorkspace();
  await cloneByGivenURL(url, byTag, { mode: "workspace-root", ref: "v1" });
  assert.equal(read(byTag), "first\n");

  const byCommit = emptyWorkspace();
  await cloneByGivenURL(url, byCommit, { mode: "workspace-root", ref: firstCommit });
  assert.equal(read(byCommit), "first\n");
});

test("an unknown ref fails after cloning, with git's reason", async () => {
  const { url } = makeRepository();
  const workspace = emptyWorkspace();

  await assert.rejects(
    cloneByGivenURL(url, workspace, { mode: "workspace-root", ref: "does-not-exist" }),
    /does-not-exist/,
  );
});
