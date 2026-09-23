import * as assert from "assert";

import { isSameRepository } from "../../participation/repo-identity";

/**
 * These pin down when a workspace is treated as "already holding this exercise", which decides
 * whether the student's uncommitted work survives a re-entry. A false positive keeps a stale
 * unrelated repo; a false negative wipes their work.
 */
suite("isSameRepository", () => {
  const cloneUrl = new URL("https://artemis.example.org/git/COURSE/exercise-student1.git");

  test("matches the same repository", () => {
    assert.strictEqual(
      isSameRepository("https://artemis.example.org/git/COURSE/exercise-student1.git", cloneUrl),
      true,
    );
  });

  test("ignores credentials on either side", () => {
    assert.strictEqual(
      isSameRepository(
        "https://student:old-token@artemis.example.org/git/COURSE/exercise-student1.git",
        new URL("https://student:fresh-token@artemis.example.org/git/COURSE/exercise-student1.git"),
      ),
      true,
    );
  });

  test("ignores a missing .git suffix and a trailing slash", () => {
    assert.strictEqual(
      isSameRepository("https://artemis.example.org/git/COURSE/exercise-student1/", cloneUrl),
      true,
    );
  });

  test("matches when the stored remote keeps a slash after .git", () => {
    // Getting the strip order wrong here means a wipe, not a missed optimisation.
    assert.strictEqual(
      isSameRepository("https://artemis.example.org/git/COURSE/exercise-student1.git/", cloneUrl),
      true,
    );
  });

  test("matches across http and https, so an old remote does not trigger a wipe", () => {
    assert.strictEqual(
      isSameRepository("http://artemis.example.org/git/COURSE/exercise-student1.git", cloneUrl),
      true,
    );
  });

  test("treats paths as case-sensitive", () => {
    // Git hosts may serve /COURSE/ and /course/ as different repositories.
    assert.strictEqual(
      isSameRepository("https://artemis.example.org/git/course/exercise-student1.git", cloneUrl),
      false,
    );
  });

  test("ignores hostname case", () => {
    assert.strictEqual(
      isSameRepository("https://ARTEMIS.example.org/git/COURSE/exercise-student1.git", cloneUrl),
      true,
    );
  });

  test("rejects a different repository on the same host", () => {
    assert.strictEqual(
      isSameRepository("https://artemis.example.org/git/COURSE/exercise-student2.git", cloneUrl),
      false,
    );
  });

  test("rejects the same path on a different host", () => {
    assert.strictEqual(
      isSameRepository("https://evil.example.org/git/COURSE/exercise-student1.git", cloneUrl),
      false,
    );
  });

  test("rejects an scp-style remote rather than guessing", () => {
    assert.strictEqual(
      isSameRepository("git@artemis.example.org:git/COURSE/exercise-student1.git", cloneUrl),
      false,
    );
  });

  test("rejects an empty remote", () => {
    assert.strictEqual(isSameRepository("", cloneUrl), false);
  });
});
