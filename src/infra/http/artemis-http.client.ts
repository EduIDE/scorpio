import { settings } from "../../shared/settings";

type QueryValue = string | number | boolean | undefined;

type ArtemisRequestOptions = {
  method?: string;
  token?: string;
  body?: string | null;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
};

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
  if (!settings.base_url) {
    throw new Error("Base URL is not set");
  }

  const url = new URL(path, settings.base_url);
  if (!query) return url;
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  }
  return url;
}

export async function artemisRequest(
  path: string,
  options: ArtemisRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const url = buildUrl(path, options.query);

  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ?? undefined,
  });
}

