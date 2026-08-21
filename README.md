# Scorpio: Theia Infrastructure for [Artemis](https://github.com/ls1intum/Artemis)

Scorpio provides Theia/EduIDE infrastructure for the Artemis learning platform. It handles environment setup, repository cloning, and git identity configuration in managed Theia workspaces.

## Features

- **Automatic Repository Cloning:** Clones the exercise repository into the workspace root with path preservation for `.vscode/settings.json`, `.theia`, `persisted`, and `lost+found`.
- **Git Identity:** Configures `user.name` and `user.email` globally, with hostname fallback when credentials are unavailable.
- **Environment Variable Loading:** Reads Theia environment variables via DataBridge or process environment (configurable via `SCORPIO_THEIA_ENV_STRATEGY`).
- **Settings Protection:** Prevents modification of `apiBaseUrl` and `repoPath` in Theia environments.
- **Gradle Pre-warming:** After cloning a Gradle project, warms the build in the background (daemon, dependencies, or full compile) so the first build is faster. Configurable via `GRADLE_PREWARM`; non-Gradle repositories are skipped automatically.

## Extension Settings

- `scorpio.artemis.apiBaseUrl`: The base URL of the Artemis Server. Default: `https://artemis.cit.tum.de`
- `scorpio.defaults.repoPath`: Default path for repository cloning (absolute path).

## Development

[Developer Guide](README_DEVELOPER.md)
