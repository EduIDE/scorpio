/**
 * The part of the built-in Git extension's API (vscode.git, API version 1) that Scorpio uses. Declared here because
 * the extension ships no type package. Looked up at runtime, so Scorpio does not hard-depend on it.
 */

import * as vscode from "vscode";

export type Credentials = { username: string; password: string };

export interface CredentialsProvider {
  getCredentials(host: vscode.Uri): vscode.ProviderResult<Credentials>;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD:
      | { readonly name?: string; readonly upstream?: { remote: string; name: string } }
      | undefined;
    readonly remotes: Remote[];
  };
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
}

export interface GitApi {
  readonly repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
  registerCredentialsProvider(provider: CredentialsProvider): vscode.Disposable;
}

export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>("vscode.git");
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports?.getAPI(1);
}

/** The Git extension discovers a freshly cloned repository asynchronously; wait for it briefly. */
export async function waitForRepository(
  api: GitApi,
  root: vscode.Uri,
  timeoutMs = 10000,
): Promise<Repository | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const repository = api.getRepository(root) ?? api.repositories[0];
    if (repository) {
      return repository;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}
