/**
 * Hands a token to exactly one git process: a throw-away GIT_ASKPASS script that echoes it from that process's own
 * environment. The token is never in a URL, on a command line or in a git config file.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SCRIPT = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' "$SCORPIO_GIT_USERNAME" ;;
  *) printf '%s\\n' "$SCORPIO_GIT_PASSWORD" ;;
esac
`;

/**
 * The minimal environment for such a git process. Deliberately not process.env: it must not carry variables that
 * simple-git refuses (EDITOR, PAGER, ...), and nothing else in it is needed.
 */
export function baseGitEnv(): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

export async function withAskpass<T>(
  username: string,
  token: string,
  run: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scorpio-askpass-"));
  const script = path.join(dir, "askpass.sh");
  try {
    await fs.writeFile(script, SCRIPT, { mode: 0o700 });
    return await run({
      ...baseGitEnv(),
      GIT_ASKPASS: script,
      SCORPIO_GIT_USERNAME: username,
      SCORPIO_GIT_PASSWORD: token,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
