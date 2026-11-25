# Theia/EduIDE Features

Scorpio is primarily designed for Theia/EduIDE environments. All core features (auto-clone, git identity, env loading, settings protection) activate automatically when running in Theia.

## Environment Variables

Scorpio reads the following variables from the Theia environment:

| Variable                      | Required | Purpose                                                                                                                                                                                                                                            |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARTEMIS_URL`                 | No       | Artemis server base URL (Artemis exercises only)                                                                                                                                                                                                   |
| `GIT_URI`                     | No       | Repository URL to clone; wins over `TEMPLATE`                                                                                                                                                                                                      |
| `TEMPLATE`                    | No       | Template id copied into an empty workspace when `GIT_URI` is unset                                                                                                                                                                                 |
| `GIT_REF`                     | No       | Branch, tag or commit checked out after a fresh clone; default branch if unset. If the ref is invalid or cannot be checked out, the student gets a warning and the default branch is used. Ignored when the workspace already holds the repository |
| `GIT_SOURCE`                  | No       | Set by the landing page: `artemis` or `external`; any other value counts as `external`. `external` always asks before Gradle warmup, even with `GRADLE_PREWARM_AUTO_CONFIRM=true`. Unset behaves as before                                    |
| `SCORPIO_TEMPLATES_DIR`       | No       | Templates directory (default `/home/theia/templates`)                                                                                                                                                                                              |
| `GIT_USER`                    | No       | Git username (falls back to hostname)                                                                                                                                                                                                              |
| `GIT_MAIL`                    | No       | Git email (falls back to `<username>@artemis-theia.de`)                                                                                                                                                                                            |
| `THEIA`                       | No       | Explicit Theia flag (auto-detected via DataBridge)                                                                                                                                                                                                 |
| `GRADLE_PREWARM`              | No       | Gradle warmup level: `off`, `daemon` (default), `deps`, or `full`                                                                                                                                                                                |
| `GRADLE_PREWARM_AUTO_CONFIRM` | No       | `true` runs the Gradle warmup without asking the student. Default `false`: the student confirms first. Read from the pod environment only, never from the data bridge                                                                                    |

## Startup Behavior

- Only one browser window clones at a time. The windows share a lock in the temp directory, and a lock older than 10 minutes counts as abandoned. A window that finds the repository already cloned skips the clone.
- Scorpio only clones into an empty workspace or one that already holds the repository (same host and path). If the workspace holds anything else, for example after the student renamed or changed the remote, it is left untouched, the student sees a warning, and no Gradle pre-warm runs.
- Credentials in `GIT_URI` are handed to the one `git clone` through a temporary credential helper, not on its command line. Afterwards `origin` is set to `GIT_URI` as given, so plain `git push` keeps working. Known limitation: the token stays in `.git/config` on the workspace volume.
- Students can clone by hand with `Scorpio: Clone Repository into Workspace` (or the button in Source Control). It follows the same rules (empty workspace only, one clone at a time), but credentials entered for a private repository never reach `.git/config`: `origin` is set to the bare URL. After the clone the credentials go to the user's git credential helper on stdin (`git credential approve`); in the standalone images that is the in-memory cache (3 hours), so the first push does not ask again. Without a configured helper git keeps nothing and pushes ask again.
- A failed clone is reported to the student. Scorpio still sets the git identity and keeps starting.
- A window without `GIT_USER` does not replace an existing git identity with the pod hostname.

## Environment Strategy

Set `SCORPIO_THEIA_ENV_STRATEGY=data-bridge` to read the launch data through a session extension: `eduide.eduide-session` (control plane) if installed, otherwise the legacy `tum-aet.data-bridge` (EduIDE 2.x). If neither is installed, process environment variables are read directly.

The EduIDE Helm chart sets it for every template (`templateDefaults.env`): in EduIDE 3.x the control plane's agent hands over the launch data only after the IDE started, for every start strategy, so the process environment never holds it. Scorpio polls the extension for up to 10 seconds and proceeds as soon as `GIT_URI`, `TEMPLATE` or `THEIA` arrives; the agent delivers all of a session's launch data at once. `ARTEMIS_URL` is not required, so sessions opened from somewhere other than Artemis, such as a GitHub link, are cloned too.
