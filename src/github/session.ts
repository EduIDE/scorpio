/**
 * The student's GitHub sign-in for this session. The token lives only in this object, in the extension host's
 * memory: not in SecretStorage, a file, git config or the environment. It is gone when the session ends.
 */

import * as vscode from "vscode";
import { GitHubApi } from "./api";
import type { GitHubConfig } from "./config";
import { DeviceFlowError, pollForToken, requestDeviceCode, type FetchLike } from "./device-flow";
import { hasScope, type GitHubUser, type Scope } from "./repo";

type Auth = { token: string; scopes: string[]; user: GitHubUser };

const fetchFn: FetchLike = (url, init) => fetch(url, init);

export class GitHubSession implements vscode.Disposable {
  private auth: Auth | undefined;
  private pending: Promise<boolean> | undefined;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly changed = new vscode.EventEmitter<GitHubUser | undefined>();
  /** Fires with the user after every sign-in, and with undefined after sign-out. */
  readonly onDidChange = this.changed.event;

  constructor(readonly config: GitHubConfig) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBar.command = "scorpio.github.menu";
    this.updateStatusBar();
    this.statusBar.show();
  }

  get user(): GitHubUser | undefined {
    return this.auth?.user;
  }

  get token(): string | undefined {
    return this.auth?.token;
  }

  /** API client with the current token, or without one when nobody is signed in. */
  api(): GitHubApi {
    return new GitHubApi(this.config, fetchFn, this.auth?.token);
  }

  /** Anonymous API client, e.g. to tell a private repository from a public one. */
  anonymousApi(): GitHubApi {
    return new GitHubApi(this.config, fetchFn);
  }

  /**
   * Signs in, or upgrades to `repo`, unless the current token already has the scope. Concurrent callers share one
   * sign-in. Returns false when the student cancels or private access is not allowed.
   */
  async ensureSignedIn(scope: Scope): Promise<boolean> {
    if (this.auth && hasScope(this.auth.scopes, scope)) {
      return true;
    }
    if (scope === "repo" && !this.config.allowPrivate) {
      vscode.window.showErrorMessage("Private GitHub repositories are not enabled on this EduIDE.");
      return false;
    }
    if (this.pending) {
      await this.pending;
      return this.auth !== undefined && hasScope(this.auth.scopes, scope);
    }
    this.pending = this.signIn(scope).finally(() => (this.pending = undefined));
    return this.pending;
  }

  signOut(): void {
    this.auth = undefined;
    this.updateStatusBar();
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.auth = undefined;
    this.statusBar.dispose();
    this.changed.dispose();
  }

  private async signIn(scope: Scope): Promise<boolean> {
    try {
      const code = await requestDeviceCode(this.config, scope, fetchFn);
      const why =
        scope === "repo"
          ? "This also grants access to your private repositories."
          : "This lets EduIDE push to your public repositories.";
      void vscode.window
        .showInformationMessage(
          `Sign in to GitHub: enter the code ${code.userCode} at ${code.verificationUri}. ${why}`,
          "Copy code & open GitHub",
        )
        .then(async (choice) => {
          if (choice) {
            await vscode.env.clipboard.writeText(code.userCode);
            await vscode.env.openExternal(vscode.Uri.parse(code.verificationUri));
          }
        });
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Waiting for GitHub sign-in (code ${code.userCode})…`,
          cancellable: true,
        },
        (_progress, cancellation) =>
          pollForToken(
            this.config,
            code,
            fetchFn,
            (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            () => cancellation.isCancellationRequested,
          ),
      );
      const user = await new GitHubApi(this.config, fetchFn, result.token).getUser();
      this.auth = { token: result.token, scopes: result.scopes, user };
      this.updateStatusBar();
      this.changed.fire(user);
      return true;
    } catch (error: any) {
      if (!(error instanceof DeviceFlowError && error.code === "cancelled")) {
        vscode.window.showErrorMessage(`GitHub sign-in failed: ${error?.message ?? error}`);
      }
      return false;
    }
  }

  private updateStatusBar(): void {
    if (this.auth) {
      this.statusBar.text = `$(github) ${this.auth.user.login}`;
      this.statusBar.tooltip = "Signed in to GitHub for this session. Click to push or sign out.";
    } else {
      this.statusBar.text = "$(github) Sign in to GitHub";
      this.statusBar.tooltip = "Sign in to push to GitHub";
    }
  }
}
