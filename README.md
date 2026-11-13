# Scorpio: EduIDE workspace bootstrap

Scorpio prepares a managed EduIDE (Theia) workspace when a session starts: it puts the project into the workspace, sets the git identity and warms up Gradle. It does not depend on Artemis; an Artemis exercise is one source of `GIT_URI` among others, such as a GitHub link.

## Features

- **Automatic Repository Cloning:** If `GIT_URI` is set, clones the repository into the workspace root, preserving `.vscode/settings.json`, `.theia`, `persisted`, and `lost+found`.
- **Templates:** If `GIT_URI` is not set but `TEMPLATE` is, copies the template `<id>` from the templates directory (`SCORPIO_TEMPLATES_DIR`, default `/home/theia/templates`) into the workspace. This only happens when the workspace is empty, so a restart never overwrites files. `GIT_URI` always wins over `TEMPLATE`. The template's `template.json` manifest is not copied, and `gradlew` is made executable. An unknown id shows a notification and the session starts with an empty workspace.
- **Git Identity:** Configures `user.name` and `user.email` globally, with hostname fallback when credentials are unavailable.
- **Environment Variable Loading:** Reads Theia environment variables via DataBridge or process environment (configurable via `SCORPIO_THEIA_ENV_STRATEGY`), see [README_THEIA.md](README_THEIA.md).
- **Settings Protection:** Prevents modification of `apiBaseUrl` and `repoPath` in Theia environments.
- **Gradle Pre-warming:** After a clone or template copy, warms the Gradle build in the background (daemon, dependencies, or full compile) so the first build is faster. Configurable via `GRADLE_PREWARM`; non-Gradle projects are skipped automatically.

## Extension Settings

- `scorpio.artemis.apiBaseUrl`: Optional base URL of an Artemis server. Artemis sessions set it from `ARTEMIS_URL`; there is no default.
- `scorpio.defaults.repoPath`: Default path for repository cloning (absolute path).

## Development

[Developer Guide](README_DEVELOPER.md)
