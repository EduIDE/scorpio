import { vscodeStub } from "./vscode-stub";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, test } from "node:test";
import { cloneFailureMessage, initTheia, theiaEnv } from "../theia/theia";

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
  vscodeStub.window.progress.length = 0;
  vscodeStub.window.statusBar.length = 0;
  vscodeStub.window.warnings.length = 0;
  delete process.env.SCORPIO_TEMPLATES_DIR;
  Object.assign(theiaEnv, {
    THEIA_FLAG: true,
    GIT_URI: undefined,
    GIT_REF: undefined,
    GIT_REF_INVALID: undefined,
    GIT_SOURCE: undefined,
    TEMPLATE: undefined,
    GIT_USER: undefined,
    GIT_MAIL: undefined,
    GRADLE_PREWARM: "off",
    GRADLE_PREWARM_AUTO_CONFIRM: false,
  });
});

test("the injected identity is written to the global git config", async () => {
  Object.assign(theiaEnv, {
    GIT_USER: "Ada Lovelace",
    GIT_MAIL: "ada@example.com",
  });

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

test("a repository that wants credentials gets the private-repository hint", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  theiaEnv.GIT_URI = new URL(`http://127.0.0.1:${port}/org/private-exercise.git`);
  theiaEnv.GIT_SOURCE = "external";
  // No prompt, as in the pod: git must fail instead of waiting for a username.
  const oldPrompt = process.env.GIT_TERMINAL_PROMPT;
  const oldAskpass = process.env.GIT_ASKPASS;
  process.env.GIT_TERMINAL_PROMPT = "0";
  delete process.env.GIT_ASKPASS;

  try {
    await initTheia();
  } finally {
    if (oldPrompt === undefined) delete process.env.GIT_TERMINAL_PROMPT;
    else process.env.GIT_TERMINAL_PROMPT = oldPrompt;
    if (oldAskpass !== undefined) process.env.GIT_ASKPASS = oldAskpass;
    server.close();
    server.closeAllConnections();
  }

  assert.equal(vscodeStub.window.errors.length, 1);
  assert.match(vscodeStub.window.errors[0], /^Could not clone private-exercise: it is private or does not exist\./);
  assert.ok(vscodeStub.window.errors[0].includes(`git clone 'http://127.0.0.1:${port}/org/private-exercise.git' .`));
});

test("the private-repository hint quotes the URL for the shell", () => {
  const message = cloneFailureMessage(new URL("https://git.example/o/x$(id);'y.git"), "Authentication failed", "external");
  assert.ok(message.includes(`git clone 'https://git.example/o/x$(id);'\\''y.git' .`));
});

test("a link with credentials never gets the private-repository hint", () => {
  for (const url of ["https://user:token@artemis.example/git/x.git", "https://:token@artemis.example/git/x.git"]) {
    assert.equal(cloneFailureMessage(new URL(url), "Authentication failed", "external"), "Could not clone the exercise repository");
  }
});

test("only an external link gets the private-repository hint", () => {
  const url = new URL("https://artemis.example/git/x.git");
  for (const source of [undefined, "artemis"] as const) {
    assert.equal(cloneFailureMessage(url, "Authentication failed", source), "Could not clone the exercise repository");
  }
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

const NOT_CLONED_WARNING =
  "The exercise was not cloned because this workspace already contains files. Empty the workspace or start a new one to get the exercise.";

async function assertWorkspaceKept() {
  assert.equal(readFileSync(path.join(workspace, "Solution.java"), "utf8"), "student work");
  assert.equal(existsSync(path.join(workspace, "README.md")), true);
  assert.deepEqual(vscodeStub.window.warnings, [NOT_CLONED_WARNING]);
  assert.deepEqual(vscodeStub.window.errors, []);
}

async function cloneThenEdit(edit: () => void) {
  theiaEnv.GIT_URI = newExerciseRepo();
  await initTheia();
  writeFileSync(path.join(workspace, "Solution.java"), "student work");
  edit();
  await initTheia();
}

test("a workspace with a renamed remote is kept and the student is warned", async () => {
  await cloneThenEdit(() => git(workspace, "remote", "rename", "origin", "upstream"));
  await assertWorkspaceKept();
});

test("a workspace whose origin points to another repository is kept and the student is warned", async () => {
  await cloneThenEdit(() =>
    git(workspace, "remote", "set-url", "origin", "https://example.org/fork/x.git"),
  );
  await assertWorkspaceKept();
});

test("a workspace that git cannot read is kept and the student is warned", async () => {
  await cloneThenEdit(() => writeFileSync(path.join(workspace, ".git", "config"), "[broken"));
  await assertWorkspaceKept();
});

test("a workspace with unrelated files and no repository is kept and the student is warned", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  writeFileSync(path.join(workspace, "Solution.java"), "student work");

  await initTheia();

  assert.equal(readFileSync(path.join(workspace, "Solution.java"), "utf8"), "student work");
  assert.equal(existsSync(path.join(workspace, ".git")), false);
  assert.deepEqual(vscodeStub.window.warnings, [NOT_CLONED_WARNING]);
});

test("an empty workspace with only Theia's own entries is cloned into", async () => {
  mkdirSync(path.join(workspace, "lost+found"));
  mkdirSync(path.join(workspace, ".theia"));
  theiaEnv.GIT_URI = newExerciseRepo();

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "README.md")), true);
  assert.equal(existsSync(path.join(workspace, ".theia")), true);
  assert.deepEqual(vscodeStub.window.warnings, []);
});

test("scheme and credentials of the origin do not make the checkout a mismatch", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  await initTheia();
  writeFileSync(path.join(workspace, "Solution.java"), "student work");
  const remoteUrl = git(workspace, "remote", "get-url", "origin");

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "Solution.java")), true);
  assert.equal(git(workspace, "remote", "get-url", "origin"), remoteUrl);
  assert.deepEqual(vscodeStub.window.warnings, []);
});

test("reusing a checkout takes over the current GIT_URI including its credentials", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  await initTheia();
  git(workspace, "remote", "set-url", "origin", "https://oldtoken@example.org/x.git");
  theiaEnv.GIT_URI = new URL("https://newtoken:s3cret@EXAMPLE.org/x");

  await initTheia();

  assert.equal(
    git(workspace, "remote", "get-url", "origin"),
    "https://newtoken:s3cret@example.org/x",
  );
  assert.deepEqual(vscodeStub.window.warnings, []);
});

test("a workspace that was not cloned into is not prewarmed", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  writeFileSync(path.join(workspace, "gradlew"), "#!/bin/sh\ntouch ran\n");
  Object.assign(theiaEnv, {
    GRADLE_PREWARM: "daemon",
    GRADLE_PREWARM_AUTO_CONFIRM: true,
  });

  await initTheia();
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.deepEqual(vscodeStub.window.warnings, [NOT_CLONED_WARNING]);
  assert.equal(existsSync(path.join(workspace, "ran")), false);
});

test("credentials in GIT_URI reach git through the credential helper, not the process arguments", async () => {
  const bare = newDir();
  git(bare, "clone", "-q", "--bare", newExerciseRepo().toString(), ".");
  git(bare, "update-server-info");
  const seen: (string | undefined)[] = [];
  // A git wrapper on PATH records the arguments of every git process.
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const wrapperDir = newDir();
  const argLog = path.join(wrapperDir, "args.log");
  writeFileSync(
    path.join(wrapperDir, "git"),
    `#!/bin/sh\necho "$*" >> '${argLog}'\nexec '${realGit}' "$@"\n`,
    { mode: 0o755 },
  );
  const oldPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${oldPath}`;
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    if (req.headers.authorization !== "Basic " + Buffer.from("student:tok/en").toString("base64")) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
      return;
    }
    const file = path.resolve(bare, "." + decodeURIComponent(req.url!.split("?")[0]));
    if (!file.startsWith(bare + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let body: Buffer | undefined;
    try {
      body = readFileSync(file);
    } catch {
      // not a file of the dumb protocol
    }
    res.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  theiaEnv.GIT_URI = new URL(`http://student:tok%2Fen@127.0.0.1:${port}/`);

  try {
    await initTheia();
  } finally {
    process.env.PATH = oldPath;
    server.close();
    server.closeAllConnections();
  }

  assert.deepEqual(vscodeStub.window.errors, []);
  assert.equal(existsSync(path.join(workspace, "README.md")), true);
  assert.equal(seen.includes("Basic " + Buffer.from("student:tok/en").toString("base64")), true);
  assert.equal(git(workspace, "remote", "get-url", "origin"), theiaEnv.GIT_URI!.toString());
  const args = readFileSync(argLog, "utf8");
  const cloneCalls = args.split("\n").filter((line) => / clone /.test(` ${line} `));
  assert.equal(cloneCalls.length, 1);
  assert.equal(/tok|student/.test(cloneCalls[0]), false);
});

test("the student sees the clone progress without any credential", async () => {
  const repo = newExerciseRepo();
  repo.username = "student";
  repo.password = "SECRETTOKEN";
  theiaEnv.GIT_URI = repo;

  await initTheia();

  const shown = vscodeStub.window.progress;
  assert.equal(
    shown.some((m) => m.startsWith("Cloning ")),
    true,
  );
  assert.equal(
    shown.some((m) => m.includes("SECRETTOKEN") || m.includes("student")),
    false,
  );
});

test("the student sees which template is applied", async () => {
  const templates = newDir();
  mkdirSync(path.join(templates, "java"));
  writeFileSync(path.join(templates, "java", "template.json"), "{}");
  process.env.SCORPIO_TEMPLATES_DIR = templates;
  theiaEnv.TEMPLATE = "java";

  await initTheia();

  assert.deepEqual(vscodeStub.window.progress, ["Applying template java"]);
});

test("a window finding another window mid-clone tells the student", async () => {
  theiaEnv.GIT_URI = newExerciseRepo();
  const lockPath = path.join(tmpdir(), "scorpio-workspace-clone.lock");
  mkdirSync(lockPath);

  try {
    await initTheia();
  } finally {
    execFileSync("rm", ["-rf", lockPath]);
  }

  assert.deepEqual(vscodeStub.window.statusBar, ["Another window is cloning the exercise"]);
});

test("GIT_REF is checked out after a fresh clone", async () => {
  const url = newExerciseRepo();
  git(url.pathname, "branch", "feature");
  git(url.pathname, "checkout", "-q", "feature");
  writeFileSync(path.join(url.pathname, "feature.txt"), "x");
  git(url.pathname, "add", ".");
  git(url.pathname, "commit", "-qm", "feature");
  git(url.pathname, "checkout", "-q", "-");
  Object.assign(theiaEnv, { GIT_URI: url, GIT_REF: "feature" });

  await initTheia();

  assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD"), "feature");
  assert.equal(existsSync(path.join(workspace, "feature.txt")), true);
});

test("a reused workspace ignores GIT_REF", async () => {
  const url = newExerciseRepo();
  git(url.pathname, "branch", "feature");
  theiaEnv.GIT_URI = url;
  await initTheia();
  const branch = git(workspace, "rev-parse", "--abbrev-ref", "HEAD");
  theiaEnv.GIT_REF = "feature";

  await initTheia();

  assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD"), branch);
});

test("an invalid GIT_REF tells the student the default branch is used", async () => {
  Object.assign(theiaEnv, {
    GIT_URI: newExerciseRepo(),
    GIT_REF_INVALID: "--evil",
  });

  await initTheia();

  assert.deepEqual(vscodeStub.window.warnings, [
    'GIT_REF "--evil" is not a valid branch, tag or commit name. The default branch is checked out.',
  ]);
  assert.equal(existsSync(path.join(workspace, "README.md")), true);
});

test("a ref that cannot be checked out leaves the clone in place and warns the student", async () => {
  Object.assign(theiaEnv, { GIT_URI: newExerciseRepo(), GIT_REF: "does-not-exist" });

  await initTheia();

  assert.equal(existsSync(path.join(workspace, "README.md")), true);
  assert.deepEqual(vscodeStub.window.errors, []);
  assert.deepEqual(vscodeStub.window.warnings, [
    'Could not check out "does-not-exist". The default branch is checked out instead.',
  ]);
});
