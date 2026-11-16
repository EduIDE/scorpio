import { vscodeStub } from "./vscode-stub";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, test } from "node:test";
import { initTheia, theiaEnv } from "../theia/theia";

const newDir = () => mkdtempSync(path.join(tmpdir(), "theia-"));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const globalConfig = (key: string) => {
  try {
    return git(process.env.HOME!, "config", "--global", key);
  } catch {
    return undefined;
  }
};

function newExerciseRepo(): URL {
  const repo = newDir();
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Template");
  git(repo, "config", "user.email", "template@example.com");
  writeFileSync(path.join(repo, "README.md"), "exercise");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  return pathToFileURL(repo);
}

let workspace: string;

beforeEach(() => {
  process.env.HOME = newDir();
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  workspace = newDir();
  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: workspace } }];
  vscodeStub.window.errors.length = 0;
  vscodeStub.window.warnings.length = 0;
  delete process.env.SCORPIO_TEMPLATES_DIR;
  Object.assign(theiaEnv, {
    THEIA_FLAG: true,
    GIT_URI: undefined,
    TEMPLATE: undefined,
    GIT_USER: undefined,
    GIT_MAIL: undefined,
    GRADLE_PREWARM: "off",
  });
});

test("the injected identity is written to the global git config", async () => {
  Object.assign(theiaEnv, { GIT_USER: "Ada Lovelace", GIT_MAIL: "ada@example.com" });

  await initTheia();

  assert.equal(globalConfig("user.name"), "Ada Lovelace");
  assert.equal(globalConfig("user.email"), "ada@example.com");
});

test("a window without env falls back to the hostname on a fresh pod", async () => {
  await initTheia();

  assert.equal(globalConfig("user.name"), hostname());
});

test("a window without env keeps the identity an earlier window wrote", async () => {
  git(process.env.HOME!, "config", "--global", "user.name", "Ada Lovelace");
  git(process.env.HOME!, "config", "--global", "user.email", "ada@example.com");

  await initTheia();

  assert.equal(globalConfig("user.name"), "Ada Lovelace");
  assert.equal(globalConfig("user.email"), "ada@example.com");
});

test("the exercise is cloned into the workspace root", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "README.md")), true);
  assert.deepEqual(vscodeStub.window.errors, []);
});

test("a window finding the repository already cloned leaves the student's work alone", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  await initTheia();
  writeFileSync(path.join(workspace, "Solution.java"), "student work");

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "Solution.java")), true);
});

test("a window finding another window mid-clone leaves the workspace alone", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  writeFileSync(path.join(workspace, "in-progress"), "the other window's clone");
  const lockPath = path.join(tmpdir(), "scorpio-workspace-clone.lock");
  mkdirSync(lockPath);

  try {
    await initTheia();
  } finally {
    execFileSync("rm", ["-rf", lockPath]);
  }

  assert.equal(existsSync(path.join(workspace, "in-progress")), true);
  assert.equal(existsSync(path.join(workspace, "README.md")), false);
});

test("a failed clone is reported and the identity is still written", async () => {
  theiaEnv.GIT_URI = pathToFileURL(path.join(newDir(), "missing"));
  theiaEnv.GIT_USER = "Ada Lovelace";

  await initTheia();

  assert.deepEqual(vscodeStub.window.errors, ["Could not clone the exercise repository"]);
  assert.equal(globalConfig("user.name"), "Ada Lovelace");
});

test("GIT_URI wins over TEMPLATE: a failed clone is not replaced by the template", async () => {
  const templates = newDir();
  mkdirSync(path.join(templates, "gradle"));
  writeFileSync(path.join(templates, "gradle", "template.json"), "{}");
  writeFileSync(path.join(templates, "gradle", "from-template.txt"), "x");
  process.env.SCORPIO_TEMPLATES_DIR = templates;
  Object.assign(theiaEnv, {
    GIT_URI: pathToFileURL(path.join(newDir(), "missing")),
    TEMPLATE: "gradle",
  });

  await initTheia();

  assert.equal(vscodeStub.window.errors.length, 1);
  assert.equal(existsSync(path.join(workspace, "from-template.txt")), false);
});

test("a TEMPLATE without GIT_URI is copied into the workspace", async () => {
  const templates = newDir();
  mkdirSync(path.join(templates, "gradle"));
  writeFileSync(path.join(templates, "gradle", "template.json"), "{}");
  writeFileSync(path.join(templates, "gradle", "from-template.txt"), "x");
  process.env.SCORPIO_TEMPLATES_DIR = templates;
  theiaEnv.TEMPLATE = "gradle";

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "from-template.txt")), true);
});

test("an unknown TEMPLATE shows a notification and the session still starts", async () => {
  process.env.SCORPIO_TEMPLATES_DIR = newDir();
  theiaEnv.TEMPLATE = "nope";

  await initTheia();

  assert.deepEqual(vscodeStub.window.warnings, [
    "Template `nope` not found, starting with an empty workspace",
  ]);
  assert.equal(globalConfig("user.name"), hostname());
});
