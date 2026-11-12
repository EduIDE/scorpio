import "./vscode-stub";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { withCloneLock } from "../participation/cloning.service";

const newLockPath = () => path.join(mkdtempSync(path.join(tmpdir(), "lock-")), "lock");

test("a second window skips cloning while the first one holds the lock", async () => {
  const lockPath = newLockPath();
  let finishFirst = () => {};
  const firstIsCloning = new Promise<void>((resolve) => (finishFirst = resolve));
  let clones = 0;

  const first = withCloneLock(async () => {
    clones++;
    await firstIsCloning;
  }, lockPath);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const secondRan = await withCloneLock(async () => {
    clones++;
  }, lockPath);
  finishFirst();

  assert.equal(secondRan, false);
  assert.equal(await first, true);
  assert.equal(clones, 1);
});

test("the lock is released after a clone", async () => {
  const lockPath = newLockPath();
  await withCloneLock(async () => {}, lockPath);
  assert.equal(existsSync(lockPath), false);
});

test("the lock is released and the error kept when a clone fails", async () => {
  const lockPath = newLockPath();
  await assert.rejects(
    withCloneLock(async () => {
      throw new Error("clone failed");
    }, lockPath),
    /clone failed/,
  );
  assert.equal(existsSync(lockPath), false);
});

test("a lock left behind by a closed window is taken over once stale", async () => {
  const lockPath = newLockPath();
  mkdirSync(lockPath);
  // A negative limit makes any lock stale, whatever the filesystem's timestamp rounding.
  assert.equal(await withCloneLock(async () => {}, lockPath, -1000), true);
});

test("a recent lock left behind is respected", async () => {
  const lockPath = newLockPath();
  mkdirSync(lockPath);
  assert.equal(await withCloneLock(async () => {}, lockPath), false);
  assert.equal(existsSync(lockPath), true);
});
