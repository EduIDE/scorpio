import * as vscode from "vscode";
import { settings } from "../shared/settings";
import { NotAuthenticatedError } from "../authentication/not_authenticated.error";
import { AUTH_ID } from "../authentication/authentication_provider";
import { getState } from "../shared/state";
import simpleGit from "simple-git";
import * as path from "path";
import { retrieveVcsAccessToken } from "../artemis/authentication.client";
import { getWorkspaceFolder, theiaEnv } from "../theia/theia";
import { addVcsTokenToUrl } from "@shared/models/participation.model";
import { ProgrammingExercise, ProgrammingLanguage } from "@shared/models/exercise.model";
import { warmupGradleDaemon } from "./gradle.service";

export async function cloneUserRepo(repoUrl: string, username: string) {
  // get folder to clone repo into
  let destinationPath: string | undefined;
  if (theiaEnv.THEIA_FLAG) {
    // Check if a workspace is available in which the exercise can be cloned
    destinationPath = getWorkspaceFolder()?.fsPath;
    if (!destinationPath) {
      throw new Error("No workspace folder available to clone repository");
    }
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
  const clonePath = await cloneByGivenURL(cloneUrlWithToken, destinationPath);

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
export async function cloneByGivenURL(cloneUrl: URL, destinationPath: string): Promise<string> {
  const repoName = path.basename(cloneUrl.pathname, ".git"); // Use repository name as subdirectory name
  const clonePath = path.join(destinationPath, repoName);

  const gitForClone = simpleGit(destinationPath);

  try {
    await gitForClone.clone(cloneUrl.toString(), clonePath);
  } catch (e: any) {
    console.error(`Error cloning repository: ${e.message}`);
  }

  return clonePath;
}
