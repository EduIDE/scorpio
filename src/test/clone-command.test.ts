import { vscodeStub } from "./vscode-stub";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { cloneByGivenURL } from "../participation/cloning.service";
import { cloneRepositoryIntoWorkspace, theiaEnv, validateRepoUrl } from "../theia/theia";

const both = ["https:", "http:"];

const dirs: string[] = [];
const newDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "clone-cmd-"));
  dirs.push(dir);
  return dir;
};
const lockPath = () => path.join(tmpdir(), "scorpio-workspace-clone.lock");

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let workspace: string;
let server: Server;
let baseUrl: string;
let login = "ada:s3cret";
let requireLogin: boolean;

// Serves a bare repository over the dumb http protocol, with Basic auth when requireLogin is set.
beforeEach(async () => {
  process.env.HOME = newDir();
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_TERMINAL_PROMPT = "0";
  delete process.env.GIT_ASKPASS;
  const work = newDir();
  git(work, "init", "-q");
  git(work, "config", "user.name", "T");
  git(work, "config", "user.email", "t@example.com");
  writeFileSync(path.join(work, "README.md"), "exercise");
  git(work, "add", ".");
  git(work, "commit", "-qm", "init");
  const served = newDir();
  git(served, "clone", "-q", "--bare", work, "org/repo.git");
  git(path.join(served, "org/repo.git"), "update-server-info");

  requireLogin = false;
  login = "ada:s3cret";
  theiaEnv.GIT_URI = undefined;
  theiaEnv.GIT_SOURCE = undefined;
  server = createServer((req, res) => {
    const expected = `Basic ${Buffer.from(login).toString("base64")}`;
    if (requireLogin && req.headers.authorization !== expected) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
      return;
    }
    const file = path.resolve(served, `.${req.url!.split("?")[0]}`);
    if (!file.startsWith(served + path.sep) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/org/repo.git`;

  workspace = newDir();
  vscodeStub.workspace.workspaceFolders = [{ uri: { fsPath: workspace } }];
  for (const list of ["errors", "warnings", "infos", "inputs", "prompts", "progress"] as const) {
    vscodeStub.window[list].length = 0;
  }
});

afterEach(() => {
  rmSync(lockPath(), { recursive: true, force: true });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  server.close();
  server.closeAllConnections();
});

test("only http and https URLs are accepted", () => {
  assert.equal(validateRepoUrl("https://github.com/a/b.git"), undefined);
  assert.equal(validateRepoUrl("http://git.example/a/b"), undefined);
  assert.equal(validateRepoUrl("  "), undefined);
  for (const bad of [
    "git@github.com:a/b.git",
    "ssh://git@host/a/b",
    "file:///tmp/x",
    "ftp://h/x",
    "nonsense",
  ]) {
    assert.ok(validateRepoUrl(bad), bad);
  }
});

test("a public repository is cloned into the workspace root", async () => {
  vscodeStub.window.inputs.push(baseUrl);

  await cloneRepositoryIntoWorkspace();

  assert.equal(readFileSync(path.join(workspace, "README.md"), "utf8"), "exercise");
  assert.deepEqual(vscodeStub.window.errors, []);
  assert.equal(vscodeStub.window.infos.length, 1);
});

test("a workspace with files is never overwritten", async () => {
  writeFileSync(path.join(workspace, "mine.txt"), "student work");
  vscodeStub.window.inputs.push(baseUrl);

  await cloneRepositoryIntoWorkspace();

  assert.equal(readFileSync(path.join(workspace, "mine.txt"), "utf8"), "student work");
  assert.ok(!existsSync(path.join(workspace, "README.md")));
  assert.match(vscodeStub.window.errors[0], /not empty.*mine\.txt/);
});

test("an authentication failure asks for credentials and keeps them out of .git/config", async () => {
  requireLogin = true;
  vscodeStub.window.inputs.push(baseUrl, " ada ", " s3cret ");
  const logs = captureConsole();

  await cloneRepositoryIntoWorkspace(both);
  logs.restore();

  assert.equal(readFileSync(path.join(workspace, "README.md"), "utf8"), "exercise");
  assert.equal(vscodeStub.window.prompts[2].password, true);
  const config = readFileSync(path.join(workspace, ".git", "config"), "utf8");
  assert.ok(config.includes(baseUrl));
  const everywhere = [
    ...allFiles(path.join(workspace, ".git")).map((f) => readFileSync(f, "latin1")),
    ...logs.lines,
    ...Object.values(vscodeStub.window).flatMap((v) =>
      Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : [],
    ),
  ].join("\n");
  assert.ok(!everywhere.includes("s3cret"));
  assert.deepEqual(vscodeStub.window.errors, []);
});

test("after a private clone the credentials go to the user's credential helper, not into .git", async () => {
  requireLogin = true;
  const store = path.join(process.env.HOME!, "credential-store");
  git(process.env.HOME!, "config", "--global", "credential.helper", `store --file=${store}`);
  vscodeStub.window.inputs.push(baseUrl, "ada", "s3cret");

  await cloneRepositoryIntoWorkspace(both);

  assert.equal(readFileSync(path.join(workspace, "README.md"), "utf8"), "exercise");
  assert.equal(
    decodeURIComponent(readFileSync(store, "utf8").trim()),
    `http://ada:s3cret@${new URL(baseUrl).host}`,
  );
  const inGit = allFiles(path.join(workspace, ".git"))
    .map((f) => readFileSync(f, "latin1"))
    .join("\n");
  assert.ok(!inGit.includes("s3cret"));
});

test("an http URL with credentials in it is refused before anything is sent", async () => {
  requireLogin = true;
  let requests = 0;
  server.on("request", () => requests++);
  vscodeStub.window.inputs.push(baseUrl.replace("http://", "http://ada:s3cret@"));

  await cloneRepositoryIntoWorkspace();

  assert.equal(requests, 0);
  assert.ok(vscodeStub.window.errors[0].includes("only sent over https"));
  assert.ok(!vscodeStub.window.errors[0].includes("s3cret"));
});

test("keepCredentialsInOrigin false also leaves a bare origin in subdirectory mode", async () => {
  requireLogin = true;
  const url = new URL(baseUrl);
  url.username = "ada";
  url.password = "s3cret";

  const clonePath = await cloneByGivenURL(url, workspace, { keepCredentialsInOrigin: false });

  assert.equal(git(clonePath, "remote", "get-url", "origin").trim(), baseUrl);
});

test("wrong credentials fail with a message that shows neither token nor raw error", async () => {
  requireLogin = true;
  vscodeStub.window.inputs.push(baseUrl, "ada", "wrong-token");

  await cloneRepositoryIntoWorkspace(both);

  assert.equal(vscodeStub.window.errors.length, 1);
  assert.ok(!vscodeStub.window.errors[0].includes("wrong-token"));
  assert.ok(!vscodeStub.window.errors[0].includes("127.0.0.1"));
  assert.ok(!existsSync(path.join(workspace, "README.md")));
  // URL, username and token: one retry, no second round of prompts.
  assert.equal(vscodeStub.window.prompts.length, 3);
});

test("cancelling the URL prompt does nothing", async () => {
  await cloneRepositoryIntoWorkspace();

  assert.deepEqual(vscodeStub.window.errors, []);
  assert.deepEqual(vscodeStub.window.infos, []);
});

function captureConsole() {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const key of ["log", "warn", "error"] as const) {
    console[key] = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  }
  return { lines, restore: () => Object.assign(console, saved) };
}

test("credentials with @ : % / reach the host intact and stay out of .git", async () => {
  requireLogin = true;
  login = "a@b:c:p%40/x:y";
  vscodeStub.window.inputs.push(baseUrl, "a@b:c", "p%40/x:y");

  await cloneRepositoryIntoWorkspace(both);

  assert.equal(readFileSync(path.join(workspace, "README.md"), "utf8"), "exercise");
  const all = allFiles(path.join(workspace, ".git"))
    .map((f) => readFileSync(f, "latin1"))
    .join("\n");
  assert.ok(!all.includes("p%40/x:y") && !all.includes("p%2540"));
});

test("cancelling at the username or token prompt says so and clones nothing", async () => {
  requireLogin = true;
  for (const answers of [[baseUrl], [baseUrl, "ada"], [baseUrl, "ada", "   "]]) {
    vscodeStub.window.infos.length = 0;
    vscodeStub.window.inputs.push(...answers);

    await cloneRepositoryIntoWorkspace(both);

    assert.deepEqual(vscodeStub.window.infos, ["Clone cancelled"]);
    assert.ok(!existsSync(path.join(workspace, "README.md")));
  }
});

test("credentials are only offered over https", async () => {
  requireLogin = true;
  vscodeStub.window.inputs.push(baseUrl);

  await cloneRepositoryIntoWorkspace();

  assert.equal(vscodeStub.window.prompts.length, 1);
  assert.match(vscodeStub.window.errors[0], /only sent over https/);
});

test("files added while the credential prompt is open are not overwritten", async () => {
  requireLogin = true;
  vscodeStub.window.inputs.push(baseUrl, "ada", "s3cret");
  const realShow = vscodeStub.window.showInputBox;
  vscodeStub.window.showInputBox = function (this: unknown, o) {
    if (o.password) writeFileSync(path.join(workspace, "mine.txt"), "student work");
    return realShow.call(vscodeStub.window, o);
  };
  try {
    await cloneRepositoryIntoWorkspace(both);
  } finally {
    vscodeStub.window.showInputBox = realShow;
  }

  assert.equal(readFileSync(path.join(workspace, "mine.txt"), "utf8"), "student work");
  assert.match(vscodeStub.window.errors[0], /not empty.*mine\.txt/);
});

test("a busy clone lock is reported", async () => {
  mkdirSync(lockPath());
  vscodeStub.window.inputs.push(baseUrl);

  await cloneRepositoryIntoWorkspace();

  assert.match(vscodeStub.window.warnings[0], /Another window is cloning/);
  assert.ok(!existsSync(path.join(workspace, "README.md")));
});

test("a workspace with only Theia files counts as empty and keeps them", async () => {
  mkdirSync(path.join(workspace, ".vscode"));
  writeFileSync(path.join(workspace, ".vscode", "settings.json"), "{}");
  mkdirSync(path.join(workspace, ".theia"));
  writeFileSync(path.join(workspace, ".theia", "a"), "1");
  mkdirSync(path.join(workspace, "persisted"));
  vscodeStub.window.inputs.push(baseUrl);

  await cloneRepositoryIntoWorkspace();

  assert.equal(readFileSync(path.join(workspace, "README.md"), "utf8"), "exercise");
  assert.equal(readFileSync(path.join(workspace, ".vscode", "settings.json"), "utf8"), "{}");
  assert.equal(readFileSync(path.join(workspace, ".theia", "a"), "utf8"), "1");
  assert.ok(existsSync(path.join(workspace, "persisted")));
});

test("an external link prefills the URL without its credentials, and all prompts survive focus loss", async () => {
  theiaEnv.GIT_SOURCE = "external";
  theiaEnv.GIT_URI = new URL(baseUrl.replace("http://", "http://u:tok@"));
  requireLogin = true;
  vscodeStub.window.inputs.push(baseUrl, "ada", "s3cret");

  await cloneRepositoryIntoWorkspace(both);

  assert.equal(vscodeStub.window.prompts[0].value, baseUrl);
  assert.ok(vscodeStub.window.prompts.every((p) => p.ignoreFocusOut));
});
