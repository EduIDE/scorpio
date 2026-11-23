# Scorpio: EduIDE workspace bootstrap

Scorpio prepares a managed EduIDE (Theia) workspace when a session starts: it puts the project into the workspace, sets the git identity and warms up Gradle. It does not depend on Artemis; an Artemis exercise is one source of `GIT_URI` among others, such as a GitHub link.

## Features

- **Automatic Repository Cloning:** If `GIT_URI` is set, clones the repository into the workspace root (and checks out `GIT_REF` if set, after a fresh clone only), but only into an empty workspace (one that holds nothing besides `.vscode/settings.json`, `.theia`, `persisted`, and `lost+found`). A workspace that already holds the repository (same host and path, whatever the scheme or credentials) is reused. Any other workspace with content is never cleared: the student gets a warning that the exercise was not cloned, and no Gradle pre-warm runs. Credentials in `GIT_URI` (`user:token@`) are not passed on the `git clone` command line; afterwards `origin` is set to `GIT_URI` as given, because the Artemis extension pushes with plain `git push`. Known limitation: that token stays in `.git/config` on the workspace volume.
- **Clone Repository into Workspace:** The command `Scorpio: Clone Repository into Workspace` (also the "Clone Repository" button in the empty Source Control view) asks for an http(s) URL and clones into the workspace root, so the repository's `.vscode` config is found. It refuses a workspace that holds files. For a private repository it asks for a username and access token and retries once; the token is used for that clone only and `origin` keeps the bare URL.
- **Templates:** If `GIT_URI` is not set but `TEMPLATE` is, copies the template `<id>` from the templates directory (`SCORPIO_TEMPLATES_DIR`, default `/home/theia/templates`) into the workspace. A template is a folder that contains a `template.json` manifest. This only happens when the workspace is empty, so a restart never overwrites files. "Empty" means it holds nothing besides `.theia`, `persisted`, `lost+found` and `.vscode/settings.json`; if both the workspace and the template have a `.vscode/settings.json`, they are merged (top-level keys, the template's win; comments and trailing commas are accepted, comments are not kept in the merged file; if either file does not parse, the workspace file stays). A student who empties the workspace gets the template again on the next start. If the copy fails, Scorpio removes what it created and reports an error. `GIT_URI` always wins over `TEMPLATE`. The template's `template.json` manifest is not copied, and `gradlew` is made executable. An unknown id shows a notification and the session starts with an empty workspace.
- **Progress Notifications:** While the workspace is prepared, shows a "Preparing your workspace" notification with the current step (waiting for exercise details, cloning, applying a template) and short status bar messages when another window is cloning or Gradle is prepared in the background. Messages never contain credentials.
- **Git Identity:** Configures `user.name` and `user.email` globally, with hostname fallback when credentials are unavailable.
- **Environment Variable Loading:** Reads Theia environment variables via DataBridge or process environment (configurable via `SCORPIO_THEIA_ENV_STRATEGY`), see [README_THEIA.md](README_THEIA.md).
- **Settings Protection:** Prevents modification of `apiBaseUrl` and `repoPath` in Theia environments.
- **Gradle Pre-warming:** After a clone or template copy, warms the Gradle build in the background (daemon, dependencies, or full compile) so the first build is faster. Configurable via `GRADLE_PREWARM`; non-Gradle projects are skipped automatically. The repository's `./gradlew` is code from the repository, so the student is asked before it runs, unless the deployment sets `GRADLE_PREWARM_AUTO_CONFIRM=true` and the landing page did not mark the repository `GIT_SOURCE=external` (a template copy is pre-warmed without asking).

## Extension Settings

- `scorpio.artemis.apiBaseUrl`: Optional base URL of an Artemis server. Artemis sessions set it from `ARTEMIS_URL`; there is no default.
- `scorpio.defaults.repoPath`: Default path for repository cloning (absolute path).

## Development

[Developer Guide](README_DEVELOPER.md)
