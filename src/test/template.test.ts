import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { applyTemplate } from "../participation/template.service";

const newDir = () => mkdtempSync(path.join(tmpdir(), "template-"));
const write = (file: string, content = "x") => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

function newTemplates() {
  const dir = newDir();
  write(path.join(dir, "gradle", "template.json"), "{}");
  write(path.join(dir, "gradle", "build.gradle"), "plugins {}");
  write(path.join(dir, "gradle", "gradlew"), "#!/bin/sh");
  write(path.join(dir, "gradle", "src", "Main.java"), "class Main {}");
  write(path.join(dir, "gradle", ".vscode", "settings.json"), "template");
  return dir;
}
const lock = () => path.join(newDir(), "lock");

test("the template is copied into an empty workspace without its manifest", async () => {
  const workspace = newDir();

  const result = await applyTemplate("gradle", workspace, newTemplates(), lock());

  assert.equal(result, "applied");
  assert.equal(existsSync(path.join(workspace, "build.gradle")), true);
  assert.equal(existsSync(path.join(workspace, "src", "Main.java")), true);
  assert.equal(existsSync(path.join(workspace, "template.json")), false);
});

test("gradlew is executable after the copy", async () => {
  const workspace = newDir();
  await applyTemplate("gradle", workspace, newTemplates(), lock());
  assert.equal(statSync(path.join(workspace, "gradlew")).mode & 0o111, 0o111);
});

test("a workspace with files is left alone", async () => {
  const workspace = newDir();
  write(path.join(workspace, "mine.txt"), "keep");

  const result = await applyTemplate("gradle", workspace, newTemplates(), lock());

  assert.equal(result, "workspace-not-empty");
  assert.equal(existsSync(path.join(workspace, "build.gradle")), false);
});

test("what Theia puts into the workspace itself does not count as content", async () => {
  const workspace = newDir();
  write(path.join(workspace, ".theia", "settings.json"));
  write(path.join(workspace, "persisted", "x"));
  write(path.join(workspace, ".vscode", "settings.json"), "mine");

  const result = await applyTemplate("gradle", workspace, newTemplates(), lock());

  assert.equal(result, "applied");
  assert.equal(readFileSync(path.join(workspace, ".vscode", "settings.json"), "utf8"), "mine");
  assert.equal(existsSync(path.join(workspace, "build.gradle")), true);
});

test("other files in .vscode count as content", async () => {
  const workspace = newDir();
  write(path.join(workspace, ".vscode", "tasks.json"));

  assert.equal(
    await applyTemplate("gradle", workspace, newTemplates(), lock()),
    "workspace-not-empty",
  );
});

test("an unknown template id is not found and the workspace stays empty", async () => {
  const workspace = newDir();

  assert.equal(await applyTemplate("nope", workspace, newTemplates(), lock()), "not-found");
  assert.equal(existsSync(path.join(workspace, "build.gradle")), false);
});

test("ids that point outside the templates directory are rejected", async () => {
  const templates = newTemplates();
  const outside = path.join(path.dirname(templates), "outside");
  write(path.join(outside, "secret.txt"));
  const workspace = newDir();

  for (const id of ["..", "../outside", "gradle/..", "/etc", "gradle/src", "", ".", "..\\x"]) {
    assert.equal(await applyTemplate(id, workspace, templates, lock()), "not-found", id);
  }
  assert.equal(existsSync(path.join(workspace, "secret.txt")), false);
});

test("a second window skips the copy while one is running", async () => {
  const workspace = newDir();
  const templates = newTemplates();
  const lockPath = lock();
  mkdirSync(lockPath);

  assert.equal(await applyTemplate("gradle", workspace, templates, lockPath), "busy");
});
