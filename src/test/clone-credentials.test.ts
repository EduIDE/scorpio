import "./vscode-stub";
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitCredentials } from "../participation/cloning.service";

test("credentials are split off the clone URL and decoded", () => {
  assert.deepEqual(splitCredentials(new URL("https://user:p%40ss%2Fx@git.example.org/a/b.git")), {
    url: "https://git.example.org/a/b.git",
    user: "user",
    password: "p@ss/x",
  });
});

test("a URL without credentials is returned unchanged", () => {
  assert.deepEqual(splitCredentials(new URL("https://git.example.org/a/b.git")), {
    url: "https://git.example.org/a/b.git",
    user: "",
    password: "",
  });
});

test("a token without a user name counts as the user name", () => {
  const { url, user, password } = splitCredentials(new URL("https://tok@github.com/a/b"));
  assert.deepEqual(
    { url, user, password },
    { url: "https://github.com/a/b", user: "tok", password: "" },
  );
});
