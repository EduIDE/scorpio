import { simpleGit, type SimpleGit } from "simple-git";
import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";

type CloneMode = "subdirectory" | "workspace-root";

type CloneOptions = {
  mode?: CloneMode;
  preservedPaths?: string[];
  /** Branch, tag or commit to check out after cloning; the default branch when unset. */
  ref?: string;
  /** Called when the ref cannot be checked out; the clone is kept on the default branch. */
  onRefFailed?: (ref: string) => void;
};

type PreservedWorkspaceEntry = {
  relativePath: string;
  backupPath: string;
  isDirectory: boolean;
};

export const THEIA_PRESERVED_PATHS = [".vscode/settings.json", ".theia", "persisted", "lost+found"];

const CLONE_LOCK_PATH = path.join(tmpdir(), "scorpio-workspace-clone.lock");
// shortcut: assumes a clone finishes within this time, raise it if a window can replace a slow clone.
const CLONE_LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * Runs `clone` unless another browser window is already cloning. Cloning clears the workspace, so
 * two windows starting together must not both do it. Returns whether `clone` ran.
 */
export async function withCloneLock(
  clone: () => Promise<void>,
  lockPath: string = CLONE_LOCK_PATH,
  staleMs: number = CLONE_LOCK_STALE_MS,
): Promise<boolean> {
  try {
    await fs.mkdir(lockPath);
  } catch {
    // The window holding the lock closed mid-clone, so nothing would ever release it.
    const lockAge = Date.now() - (await fs.stat(lockPath)).mtimeMs;
    if (lockAge < staleMs) {
      return false;
    }
    await fs.rm(lockPath, { recursive: true, force: true });
    await fs.mkdir(lockPath);
  }

  try {
    await clone();
    return true;
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

/**
 * Splits the credentials off a clone URL, so they reach neither the git arguments nor .git/config.
 */
export function splitCredentials(cloneUrl: URL): {
  url: string;
  user: string;
  password: string;
} {
  const bare = new URL(cloneUrl.toString());
  bare.username = "";
  bare.password = "";
  return {
    url: bare.toString(),
    user: decodeURIComponent(cloneUrl.username),
    password: decodeURIComponent(cloneUrl.password),
  };
}

/**
 * Runs `clone` with the credentials supplied through a credential helper that prints them from a private temp file.
 * They are in neither the git arguments nor the environment of the clone. The file lives only for that one command.
 * Callers that need the credentials afterwards (see setOrigin) store them on purpose.
 */
async function withCredentialHelper<T>(
  user: string,
  password: string,
  cwd: string,
  clone: (git: SimpleGit) => Promise<T>,
): Promise<T> {
  if (!user && !password) {
    return clone(simpleGit(cwd));
  }
  const dir = await fs.mkdtemp(path.join(tmpdir(), "scorpio-git-credentials-"));
  try {
    const file = path.join(dir, "credentials");
    await fs.writeFile(file, `username=${user}\npassword=${password}\n`, {
      mode: 0o600,
    });
    const quoted = `'${file.replace(/'/g, `'\\''`)}'`;
    // The first, empty helper drops helpers from the user's own git config, which could store the token.
    const config = ["credential.helper=", `credential.helper=!cat ${quoted} #`];
    return await clone(
      simpleGit({
        baseDir: cwd,
        config,
        unsafe: { allowUnsafeCredentialHelper: true },
      }),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Points origin at the URL as given, credentials included: the Artemis extension pushes with a plain `git push`
 * and relies on them. Known limitation: the token stays in .git/config on the workspace volume.
 */
export async function setOrigin(repoPath: string, cloneUrl: URL): Promise<void> {
  await simpleGit(repoPath).remote(["set-url", "origin", cloneUrl.toString()]);
}

export async function cloneByGivenURL(
  cloneUrl: URL,
  destinationPath: string,
  options?: CloneOptions,
): Promise<string> {
  if (options?.mode === "workspace-root") {
    return cloneIntoWorkspaceRoot(
      cloneUrl,
      destinationPath,
      options.preservedPaths ?? THEIA_PRESERVED_PATHS,
      options.ref,
      options.onRefFailed,
    );
  }

  const repoName = path.basename(cloneUrl.pathname, ".git");
  const clonePath = path.join(destinationPath, repoName);

  const { url, user, password } = splitCredentials(cloneUrl);

  try {
    await withCredentialHelper(user, password, destinationPath, (git) => git.clone(url, clonePath));
    await setOrigin(clonePath, cloneUrl);
  } catch (e: any) {
    throw new Error(`Error cloning repository: ${e.message}`);
  }

  return clonePath;
}

async function cloneIntoWorkspaceRoot(
  cloneUrl: URL,
  workspacePath: string,
  preservedPaths: string[] = [],
  ref?: string,
  onRefFailed?: (ref: string) => void,
): Promise<string> {
  const backupRoot = await fs.mkdtemp(path.join(tmpdir(), "scorpio-workspace-clone-"));
  const preservedEntries = await movePreservedWorkspaceEntries(
    workspacePath,
    preservedPaths,
    backupRoot,
  );

  let cloneSucceeded = false;
  let restoredEntries: PreservedWorkspaceEntry[] = [];

  try {
    await clearDirectory(workspacePath);

    const { url, user, password } = splitCredentials(cloneUrl);
    await withCredentialHelper(user, password, workspacePath, (git) => git.clone(url, "."));
    await setOrigin(workspacePath, cloneUrl);
    cloneSucceeded = true;
    if (ref) {
      try {
        // A full clone has every branch and tag, so one checkout covers branches, tags and commits.
        // "--" keeps git from reading the ref as a path.
        await simpleGit(workspacePath).raw(["checkout", "--quiet", ref, "--"]);
      } catch (e: any) {
        // The repository is there, so the clone counts as done; the student is told which branch they are on.
        console.warn(`Could not check out ${ref}: ${e.message}`);
        onRefFailed?.(ref);
      }
    }

    return workspacePath;
  } catch (e: any) {
    throw new Error(`Error cloning repository into workspace root: ${e.message}`);
  } finally {
    restoredEntries = await restorePreservedWorkspaceEntries(workspacePath, preservedEntries);

    if (cloneSucceeded) {
      await addEntriesToGitExclude(workspacePath, restoredEntries);
    }

    await fs.rm(backupRoot, { recursive: true, force: true });
  }
}

async function movePreservedWorkspaceEntries(
  workspacePath: string,
  preservedPaths: string[],
  backupRoot: string,
): Promise<PreservedWorkspaceEntry[]> {
  const preservedEntries: PreservedWorkspaceEntry[] = [];

  for (const relativePath of preservedPaths) {
    const sourcePath = path.join(workspacePath, relativePath);
    const sourceStats = await safeStat(sourcePath);
    if (!sourceStats) {
      continue;
    }

    const backupPath = path.join(backupRoot, relativePath);
    await ensureParentDirectory(backupPath);
    await copyPath(sourcePath, backupPath, sourceStats.isDirectory());
    await fs.rm(sourcePath, { recursive: true, force: true });

    preservedEntries.push({
      relativePath,
      backupPath,
      isDirectory: sourceStats.isDirectory(),
    });
  }

  return preservedEntries;
}

async function restorePreservedWorkspaceEntries(
  workspacePath: string,
  preservedEntries: PreservedWorkspaceEntry[],
): Promise<PreservedWorkspaceEntry[]> {
  const restoredEntries: PreservedWorkspaceEntry[] = [];

  for (const entry of preservedEntries) {
    const targetPath = path.join(workspacePath, entry.relativePath);
    const targetStats = await safeStat(targetPath);

    if (!targetStats) {
      await ensureParentDirectory(targetPath);
      await copyPath(entry.backupPath, targetPath, entry.isDirectory);
      restoredEntries.push(entry);
    }

    await fs.rm(entry.backupPath, { recursive: true, force: true });
  }

  return restoredEntries;
}

async function addEntriesToGitExclude(
  workspacePath: string,
  restoredEntries: PreservedWorkspaceEntry[],
): Promise<void> {
  if (restoredEntries.length === 0) {
    return;
  }

  const excludePath = path.join(workspacePath, ".git", "info", "exclude");
  const existingContent = await fs.readFile(excludePath, "utf8").catch(() => "");
  const existingEntries = new Set(existingContent.split(/\r?\n/).filter(Boolean));
  const newEntries = restoredEntries.map((entry) =>
    entry.isDirectory
      ? `${normalizeGitPath(entry.relativePath)}/`
      : normalizeGitPath(entry.relativePath),
  );

  let hasChanges = false;
  for (const entry of newEntries) {
    if (!existingEntries.has(entry)) {
      existingEntries.add(entry);
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return;
  }

  await ensureParentDirectory(excludePath);
  const nextContent = `${Array.from(existingEntries).join("\n")}\n`;
  await fs.writeFile(excludePath, nextContent, "utf8");
}

async function clearDirectory(directoryPath: string): Promise<void> {
  const entries = await fs.readdir(directoryPath);
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(directoryPath, entry), { recursive: true, force: true }),
    ),
  );
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyPath(
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
  } else {
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function safeStat(targetPath: string) {
  try {
    return await fs.lstat(targetPath);
  } catch {
    return undefined;
  }
}

function normalizeGitPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
