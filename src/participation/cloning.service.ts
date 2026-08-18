import * as vscode from "vscode";
import { settings } from "../shared/settings";
import { NotAuthenticatedError } from "../authentication/not_authenticated.error";
import { AUTH_ID } from "../authentication/authentication_provider";
import { getState } from "../shared/state";
import simpleGit from "simple-git";
import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { retrieveVcsAccessToken } from "../artemis/authentication.client";
import { getWorkspaceFolder, theiaEnv } from "../theia/theia";
import { addVcsTokenToUrl } from "@shared/models/participation.model";
import { ProgrammingExercise, ProgrammingLanguage } from "@shared/models/exercise.model";
import { warmupGradleDaemon } from "./gradle.service";

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

// Theia images seed a few workspace-owned paths into /home/project before Scorpio runs.
// We preserve only those exact paths. Everything else in the workspace should come from
// the exercise repository so repo content can fully define the student's project.
const THEIA_PRESERVED_PATHS = [".vscode/settings.json", ".theia", "persisted", "lost+found"];

export async function cloneUserRepo(repoUrl: string, username: string) {
  // get folder to clone repo into
  let destinationPath: string | undefined;
  let cloneOptions: CloneOptions | undefined;
  if (theiaEnv.THEIA_FLAG) {
    // Check if a workspace is available in which the exercise can be cloned
    destinationPath = getWorkspaceFolder()?.fsPath;
    if (!destinationPath) {
      throw new Error("No workspace folder available to clone repository");
    }
    cloneOptions = {
      mode: "workspace-root",
      preservedPaths: THEIA_PRESERVED_PATHS,
    };
  } else {
    // Open a dialog to select the folder where the repo will be cloned
    destinationPath = (
      await vscode.window.showOpenDialog({
        canSelectFolders: true,
        openLabel: "Select folder to clone into",
        defaultUri: vscode.Uri.file(settings.default_repo_path ?? ""),
      })
    )?.at(0)?.fsPath;

    if (!destinationPath) {
      throw new Error("No folder selected");
    }
  }

  const session = await vscode.authentication.getSession(AUTH_ID, [], {
    createIfNone: false,
  });
  if (!session) {
    throw new NotAuthenticatedError();
  }

  const vcsToken = await retrieveVcsAccessToken(
    session.accessToken,
    getState().displayedExercise?.studentParticipations![0].id!,
  );
  // Clone the repository
  const cloneUrlWithToken = new URL(addVcsTokenToUrl(repoUrl, username, vcsToken));
  const clonePath = await cloneByGivenURL(cloneUrlWithToken, destinationPath, cloneOptions);

  // Pre-warm Gradle in the background so the student's first build is faster.
  // The depth (off/daemon/deps/full) is controlled by the GRADLE_PREWARM env var.
  const exercise = getState().displayedExercise;
  if ((exercise as ProgrammingExercise)?.programmingLanguage === ProgrammingLanguage.JAVA) {
    warmupGradleDaemon(clonePath, theiaEnv.GRADLE_PREWARM);
  }

  if (!theiaEnv.THEIA_FLAG) {
    // Prompt the user to open the cloned folder in a new workspace
    const openIn = await vscode.window.showInformationMessage(
      `Would you like to open the cloned repository?`,
      { modal: true },
      "Open",
      "Open in New Window",
      "Cancel",
    );

    if (openIn === "Open") {
      vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(clonePath));
    } else if (openIn === "Open in New Window") {
      vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(clonePath), true);
    }
  }
}

/**
 *
 * @param cloneUrl which includes all credentials necessary to clone the repository
 * @param destinationPath the folder path where the repository should be cloned into
 * @returns the repository path of the cloned repository
 */
export async function cloneByGivenURL(
  cloneUrl: URL,
  destinationPath: string,
  options?: CloneOptions,
): Promise<string> {
  if (options?.mode === "workspace-root") {
    // Theia mounts a fixed working directory and we want the repository content at that root
    // instead of inside an extra subfolder.
    return cloneIntoWorkspaceRoot(
      cloneUrl,
      destinationPath,
      options.preservedPaths ?? THEIA_PRESERVED_PATHS,
    );
  }

  const repoName = path.basename(cloneUrl.pathname, ".git"); // Use repository name as subdirectory name
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
  // Store preserved workspace-owned files outside the mounted workspace so we can safely
  // clear /home/project and let `git clone ... .` materialize the repository at the root.
  const backupRoot = await fs.mkdtemp(path.join(tmpdir(), "scorpio-workspace-clone-"));
  const preservedEntries = await movePreservedWorkspaceEntries(
    workspacePath,
    preservedPaths,
    backupRoot,
  );

  let cloneSucceeded = false;
  let restoredEntries: PreservedWorkspaceEntry[] = [];

  try {
    // After preserved entries have been moved out, the remaining workspace content should not
    // survive. This ensures repo files win over any preexisting files from the image or volume.
    await clearDirectory(workspacePath);

    const gitForClone = simpleGit(workspacePath);
    // Clone into "." so the exercise repository becomes the workspace root in Theia.
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
    // Copy + remove is intentional here: the workspace is usually a mounted volume while the
    // temp directory may live on another filesystem, so rename() would fail with EXDEV.
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
      // Restore only when the repository did not provide that path itself. Repo content must
      // override preexisting workspace content if both define the same file or directory.
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
  // Keep restored workspace-owned files local to the Theia workspace instead of surfacing
  // them as untracked files inside the student's repository.
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
