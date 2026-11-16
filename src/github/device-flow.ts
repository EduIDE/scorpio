/**
 * GitHub's OAuth device flow, which needs only the public client ID: no redirect URL (every EduIDE session lives at
 * its own path) and no client secret. Pure apart from the injected fetch and sleep, so it can be unit tested.
 */

import type { GitHubConfig } from "./config";
import { parseScopes, type Scope } from "./repo";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between polls, as GitHub asks. */
  interval: number;
  /** Seconds until the code expires. */
  expiresIn: number;
};

export type DeviceToken = { token: string; scopes: string[] };

export class DeviceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// GitHub documents these endpoints with form-encoded parameters; Accept asks for a JSON answer.
const FORM_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
};

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

export async function requestDeviceCode(
  config: GitHubConfig,
  scope: Scope,
  fetchFn: FetchLike,
): Promise<DeviceCode> {
  const response = await fetchFn(`${config.webOrigin}/login/device/code`, {
    method: "POST",
    headers: FORM_HEADERS,
    body: form({ client_id: config.clientId, scope }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.device_code) {
    throw new DeviceFlowError(
      body.error ?? `http_${response.status}`,
      body.error_description ?? `GitHub did not issue a device code (HTTP ${response.status}).`,
    );
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    interval: Number(body.interval) || 5,
    expiresIn: Number(body.expires_in) || 900,
  };
}

/**
 * Polls until the user has entered the code and approved, following GitHub's rules: wait `interval` seconds between
 * requests and add 5 seconds on every `slow_down`.
 */
export async function pollForToken(
  config: GitHubConfig,
  code: DeviceCode,
  fetchFn: FetchLike,
  sleep: (ms: number) => Promise<void>,
  isCancelled: () => boolean = () => false,
  now: () => number = Date.now,
): Promise<DeviceToken> {
  let interval = code.interval;
  const deadline = now() + code.expiresIn * 1000;
  while (now() < deadline) {
    await sleep(interval * 1000);
    if (isCancelled()) {
      throw new DeviceFlowError("cancelled", "Sign-in was cancelled.");
    }
    const response = await fetchFn(`${config.webOrigin}/login/oauth/access_token`, {
      method: "POST",
      headers: FORM_HEADERS,
      body: form({
        client_id: config.clientId,
        device_code: code.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (body.access_token) {
      return { token: body.access_token, scopes: parseScopes(body.scope) };
    }
    switch (body.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = Number(body.interval) || interval + 5;
        continue;
      case "access_denied":
        throw new DeviceFlowError("access_denied", "Sign-in was declined on GitHub.");
      case "expired_token":
        throw new DeviceFlowError("expired_token", "The sign-in code expired. Please try again.");
      default:
        throw new DeviceFlowError(
          body.error ?? `http_${response.status}`,
          body.error_description ?? `GitHub sign-in failed (HTTP ${response.status}).`,
        );
    }
  }
  throw new DeviceFlowError("expired_token", "The sign-in code expired. Please try again.");
}
