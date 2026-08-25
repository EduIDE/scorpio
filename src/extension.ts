// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { buildCourseOptions } from "./course/course";
import { buildExerciseOptions, cloneCurrentExercise } from "./exercise/exercise";
import { SidebarProvider } from "./sidebar/sidebarProvider";
import { ArtemisAuthenticationProvider, AUTH_ID } from "./authentication/authentication_provider";
import { clearRepoState, setDisplayedState, getState } from "./shared/state";
import { sync_problem_statement_with_workspace } from "./problemStatement/problem_statement";
import { NotAuthenticatedError } from "./authentication/not_authenticated.error";
import { initTheia, loadTheiaEnv, rawEnv, theiaEnv } from "./theia/theia";
import { KNOWN_ENV_KEYS } from "./theia/env-strategy";
import { initSettings } from "./shared/settings";
import { detectRepoCourseAndExercise, submitCurrentWorkspace } from "./shared/repository.service";
import { umlFileProvider } from "./problemStatement/uml.db";
import { RealtimeSyncService } from "./participation/realtime-sync.service";

export var authenticationProvider: ArtemisAuthenticationProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "scorpio" is now active!');

  // Load credentials first (may poll credential bridge if configured)
  // Blocks the activation until the credentials are loaded
  await loadTheiaEnv();

  // Export arbitrary (non-known) variables to the integrated terminal environment so
  // that terminals and terminal-spawned tasks inherit them. Known keys are handled by
  // their bespoke logic and are deliberately kept out of terminals (this also avoids
  // leaking ARTEMIS_TOKEN into shells). Clear first: the collection is persistent and
  // survives workspace reloads, so stale vars from a prior launch must not linger.
  context.environmentVariableCollection.clear();
  for (const [key, value] of Object.entries(rawEnv)) {
    if (!KNOWN_ENV_KEYS.has(key)) {
      context.environmentVariableCollection.replace(key, value);
    }
  }

  await initTheia();

  initSettings();
  const realtimeSync = new RealtimeSyncService();
  context.subscriptions.push(realtimeSync);
  initAuthentication(context, realtimeSync);

  const sidebar = initSidebar(context);

  // init UmlPreview
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("uml-preview", umlFileProvider, {
      isReadonly: true,
    }),
  );

  registerCommands(context, sidebar, realtimeSync);

  listenToEvents();

  detectRepoCourseAndExercise().catch((e) => {
    console.error(e);
  });

  realtimeSync.start().catch((e) => {
    console.error(e);
  });
}

function initAuthentication(context: vscode.ExtensionContext, realtimeSync: RealtimeSyncService) {
  authenticationProvider = new ArtemisAuthenticationProvider(context.secrets);

  context.subscriptions.push(authenticationProvider);

  (async () => {
    // check if user is already authenticated
    // is needed for the login button to be displayed on the profile button

    // Try to get existing session silently first
    let session = await vscode.authentication.getSession(AUTH_ID, [], { silent: true });

    // If no session exists but we have credentials, create one silently
    if (!session && theiaEnv.ARTEMIS_TOKEN !== undefined) {
      session = await authenticationProvider.createSession([]);
    }

    vscode.commands.executeCommand("setContext", "scorpio.authenticated", session !== undefined);
  })();

  authenticationProvider.onAuthSessionsChange.event(({ added, removed }) => {
    if (added && added.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", true);
      vscode.commands.executeCommand("scorpio.workspace.detectRepo");
      realtimeSync.start().catch((e) => {
        console.error(e);
      });
      return;
    }

    if (removed && removed.length > 0) {
      vscode.commands.executeCommand("setContext", "scorpio.authenticated", false);

      clearRepoState();
      setDisplayedState(undefined, undefined);
      return;
    }
  });
}

function initSidebar(context: vscode.ExtensionContext): SidebarProvider {
  // register sidebar for problem statement
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    authenticationProvider.onAuthSessionsChange,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("artemis-sidebar", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  return sidebarProvider;
}

function registerCommands(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider,
  realtimeSync: RealtimeSyncService,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.restart", () => {
      deactivate();
      activate(context);
    }),
  );

  // command to login
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.login", async () => {
      try {
        const token = await vscode.authentication.getSession(AUTH_ID, [], {
          createIfNone: true,
        });
        if (!token) {
          vscode.window.showErrorMessage("Login failed");
          return;
        }
      } catch (e) {
        _errorMessage(e, LogLevel.ERROR, "Failed to login");
      }
    }),
  );

  // command to logout
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.logout", async () => {
      vscode.window
        .showWarningMessage("Sign out from Artemis - Scorpio", { modal: true }, "Sign out")
        .then((value) => {
          if (value === "Sign out") {
            authenticationProvider.removeSession();
            vscode.authentication.getSession(AUTH_ID, [], {
              createIfNone: false,
            });
          }
        });
    }),
  );

  // command to select a course and exercise
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.displayExercise", async () => {
      try {
        const course = await buildCourseOptions();

        const exercise = await buildExerciseOptions(course);

        setDisplayedState(course, exercise);
      } catch (e) {
        _errorMessage(e, LogLevel.ERROR, "Failed to display Exercise");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.displayedExercise.back", () => {
      const state = getState();
      if (state.displayedExercise) {
        // only remove exercise to get into exercise selection
        setDisplayedState(state.displayedCourse, undefined);
      } else {
        // remove course to get into course selection
        setDisplayedState(undefined, undefined);
      }
    }),
  );

  // command to clone repository
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.displayedExercise.clone", async () => {
      try {
        await cloneCurrentExercise();
        // In Theia mode the repo is materialized into the workspace root,
        // so we can detect it immediately and update repoKey without a round-trip.
        await detectRepoCourseAndExercise();
        await realtimeSync.refreshNow();
      } catch (e) {
        _errorMessage(e, LogLevel.ERROR, "Failed to clone repository");
      }
    }),
  );

  // command to submit workspace
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.workspace.submit", async () => {
      try {
        await submitCurrentWorkspace();
      } catch (e) {
        _errorMessage(e, LogLevel.ERROR, "Failed to submit workspace");
      }
    }),
  );

  // command to detect repo in workspace
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.workspace.detectRepo", async () => {
      detectRepoCourseAndExercise().catch((e) => {
        _errorMessage(e, LogLevel.ERROR, "Failed to detect repo");
      });
    }),
  );

  // command to sync problem statement with workspace
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.workspace.sync", async () => {
      sync_problem_statement_with_workspace().catch((e) => {
        _errorMessage(e, LogLevel.ERROR, "Failed to sync workspace");
      });
    }),
  );

  // command to refresh sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("scorpio.sidebar.refresh", () => {
      sidebar.resolveWebviewView(sidebar._view!);
    }),
  );
}

function listenToEvents() {
  // listen to workspace changes to display problem statement
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    detectRepoCourseAndExercise().catch((e) => {
      console.error(e);
    });
  });
}

enum LogLevel {
  INFO = "info",
  ERROR = "error",
  WARN = "warn",
}
function _errorMessage(e: any, logLevel: LogLevel = LogLevel.ERROR, messagePrefix: string = "") {
  switch (logLevel) {
    case LogLevel.INFO:
      console.info(e);
      if (e instanceof NotAuthenticatedError) {
        vscode.window
          .showInformationMessage(`${messagePrefix}: ${e.message}`, "Login")
          .then((value) => {
            if (value === "Login") {
              vscode.commands.executeCommand("scorpio.login");
            }
          });
        return;
      }
      if (e instanceof Error) {
        vscode.window.showInformationMessage(`${messagePrefix}: ${e.message}`);
        return;
      }

      vscode.window.showInformationMessage(`${messagePrefix}: ${e}`);
      break;
    case LogLevel.ERROR:
      console.error(e);
      if (e instanceof NotAuthenticatedError) {
        vscode.window.showErrorMessage(`${messagePrefix}: ${e.message}`, "Login").then((value) => {
          if (value === "Login") {
            vscode.commands.executeCommand("scorpio.login");
          }
        });
        return;
      }
      if (e instanceof Error) {
        vscode.window.showErrorMessage(`${messagePrefix}: ${e.message}`);
        return;
      }

      vscode.window.showErrorMessage(`${messagePrefix}: ${e}`);
      break;
    case LogLevel.WARN:
      console.warn(e);
      if (e instanceof NotAuthenticatedError) {
        vscode.window
          .showWarningMessage(`${messagePrefix}: ${e.message}`, "Login")
          .then((value) => {
            if (value === "Login") {
              vscode.commands.executeCommand("scorpio.login");
            }
          });
        return;
      }
      if (e instanceof Error) {
        vscode.window.showWarningMessage(`${messagePrefix}: ${e.message}`);
        return;
      }

      vscode.window.showWarningMessage(`${messagePrefix}: ${e}`);
      break;
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
