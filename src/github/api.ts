/**
 * The few GitHub REST calls Scorpio needs. The token is passed in per instance and never stored here.
 */

import type { GitHubConfig } from "./config";
import type { FetchLike } from "./device-flow";
import type { GitHubUser, RepoRef } from "./repo";

export type RepoInfo = RepoRef & {
  private: boolean;
  cloneUrl: string;
  defaultBranch: string;
  allowForking: boolean;
  canPush: boolean;
};

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function toRepoInfo(body: any): RepoInfo {
  return {
    owner: body.owner?.login,
    repo: body.name,
    private: Boolean(body.private),
    cloneUrl: body.clone_url,
    defaultBranch: body.default_branch,
    allowForking: body.allow_forking !== false,
    canPush: Boolean(body.permissions?.push),
  };
}

export class GitHubApi {
  constructor(
    private readonly config: GitHubConfig,
    private readonly fetchFn: FetchLike,
    private readonly token?: string,
  ) {}

  private async request(method: string, path: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await this.fetchFn(`${this.config.apiBase}${path}`, { method, headers });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  private fail(status: number, body: any, what: string): never {
    throw new GitHubApiError(status, `${what}: ${body?.message ?? `HTTP ${status}`}`);
  }

  async getUser(): Promise<GitHubUser> {
    const { status, body } = await this.request("GET", "/user");
    if (status !== 200) {
      this.fail(status, body, "Could not read the GitHub user");
    }
    return { id: body.id, login: body.login, name: body.name };
  }

  /** The repository, or undefined when GitHub answers 404: missing, or private without access. */
  async getRepo(ref: RepoRef): Promise<RepoInfo | undefined> {
    const { status, body } = await this.request(
      "GET",
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`,
    );
    if (status === 404) {
      return undefined;
    }
    if (status !== 200) {
      this.fail(status, body, `Could not read ${ref.owner}/${ref.repo}`);
    }
    return toRepoInfo(body);
  }

  /** Creates (or returns the existing) fork in the user's account. GitHub creates it asynchronously. */
  async createFork(ref: RepoRef): Promise<RepoInfo> {
    const { status, body } = await this.request(
      "POST",
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/forks`,
    );
    if (status !== 202 && status !== 200) {
      this.fail(status, body, `Could not fork ${ref.owner}/${ref.repo}`);
    }
    return toRepoInfo(body);
  }

  /** The user's repositories they can push to, most recently pushed first. */
  async listWritableRepos(): Promise<RepoInfo[]> {
    const { status, body } = await this.request(
      "GET",
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    );
    if (status !== 200) {
      this.fail(status, body, "Could not list your repositories");
    }
    return (Array.isArray(body) ? body : []).map(toRepoInfo).filter((r) => r.canPush);
  }
}
