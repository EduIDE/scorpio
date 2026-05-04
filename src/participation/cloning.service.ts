import simpleGit from "simple-git";
import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";

type CloneMode = "subdirectory" | "workspace-root";

type CloneOptions = {
  mode?: CloneMode;
  preservedPaths?: string[];
};

type PreservedWorkspaceEntry = {
  relativePath: string;
  backupPath: string;
  isDirectory: boolean;
};

const THEIA_PRESERVED_PATHS = [".vscode/settings.json", ".theia", "persisted", "lost+found"];

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
    );
  }

  const repoName = path.basename(cloneUrl.pathname, ".git");
  const clonePath = path.join(destinationPath, repoName);

  const gitForClone = simpleGit(destinationPath);

  try {
    await gitForClone.clone(cloneUrl.toString(), clonePath);
  } catch (e: any) {
    throw new Error(`Error cloning repository: ${e.message}`);
  }

  return clonePath;
}

async function cloneIntoWorkspaceRoot(
  cloneUrl: URL,
  workspacePath: string,
  preservedPaths: string[] = [],
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

    const gitForClone = simpleGit(workspacePath);
    await gitForClone.clone(cloneUrl.toString(), ".");
    cloneSucceeded = true;

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
