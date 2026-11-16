# Theia/EduIDE Features

Scorpio is primarily designed for Theia/EduIDE environments. All core features (auto-clone, git identity, env loading, settings protection) activate automatically when running in Theia.

## Environment Variables

Scorpio reads the following variables from the Theia environment:

| Variable                      | Required | Purpose                                                                                                                                                                   |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARTEMIS_URL`                 | No       | Artemis server base URL (Artemis exercises only)                                                                                                                          |
| `GIT_URI`                     | No       | Repository URL to clone; wins over `TEMPLATE`                                                                                                                             |
| `TEMPLATE`                    | No       | Template id copied into an empty workspace when `GIT_URI` is unset                                                                                                        |
| `GIT_REF`                     | No       | Branch, tag or commit checked out after a fresh clone; default branch if unset. Ignored when the workspace already holds the repository                                   |
| `GIT_SOURCE`                  | No       | Set by the landing page: `artemis` or `external`. `external` always asks before Gradle pre-warming, even with `GRADLE_PREWARM_AUTO_CONFIRM=true`. Unset behaves as before |
| `SCORPIO_TEMPLATES_DIR`       | No       | Templates directory (default `/home/theia/templates`)                                                                                                                     |
| `GIT_USER`                    | No       | Git username (falls back to hostname)                                                                                                                                     |
| `GIT_MAIL`                    | No       | Git email (falls back to `<username>@artemis-theia.de`)                                                                                                                   |
| `THEIA`                       | No       | Explicit Theia flag (auto-detected via DataBridge)                                                                                                                        |
| `GRADLE_PREWARM`              | No       | Gradle pre-warm level: `off`, `daemon` (default), `deps`, or `full`                                                                                                       |
| `GRADLE_PREWARM_AUTO_CONFIRM` | No       | `true` runs pre-warming without asking the student. Default `false`: the student confirms first. Read from the pod environment only, never from the data bridge           |

## Startup Behavior

- Only one browser window clones at a time. The windows share a lock in the temp directory, and a lock older than 10 minutes counts as abandoned. A window that finds the repository already cloned skips the clone.
- Scorpio only clones into an empty workspace or one that already holds the repository (same host and path). If the workspace holds anything else, for example after the student renamed or changed the remote, it is left untouched, the student sees a warning, and no Gradle pre-warm runs.
- Credentials in `GIT_URI` are handed to the one `git clone` through a temporary credential helper, not on its command line. Afterwards `origin` is set to `GIT_URI` as given, so plain `git push` keeps working. Known limitation: the token stays in `.git/config` on the workspace volume.
- A failed clone is reported to the student. Scorpio still sets the git identity and keeps starting.
- A window without `GIT_USER` does not replace an existing git identity with the pod hostname.

## Environment Strategy

Set `SCORPIO_THEIA_ENV_STRATEGY=data-bridge` to use the DataBridge extension (`tum-aet.data-bridge`) for environment variable loading. Otherwise, process environment variables are read directly.

The operator sets this for warm-pool (eagerly started) instances, which receive the session's variables after they started. Scorpio polls the bridge for up to 10 seconds and proceeds as soon as `GIT_URI`, `TEMPLATE` or `THEIA` arrives; the operator injects all of a session's variables at once. `ARTEMIS_URL` is not required, so sessions opened from somewhere other than Artemis, such as a GitHub link, are cloned too.

## GitHub: sign-in, push, private repositories

For sessions with `GIT_SOURCE=external` whose `GIT_URI` is on the configured GitHub host (for example opened with the "Open in EduIDE" browser extension), Scorpio can sign the student in to GitHub and push their commits. It is off until an OAuth App client ID is configured.

**Sign-in** uses GitHub's device flow: Scorpio shows a code, the student enters it at `github.com/login/device` and authorizes the app once. The device flow needs only the public client ID, no client secret and no redirect URL. Scorpio asks for `public_repo`, and for `repo` only when a private repository is involved.

**The token** lives only in the extension host's memory for this session. It is never written to disk, git config, `SecretStorage` or the environment. Git receives it through the built-in Git extension's credentials provider (pushes from the Source Control view, the terminal and Scorpio), and Scorpio's own private clone receives it through a one-off `GIT_ASKPASS` helper.

**Push to GitHub** (command, Source Control title bar, or the status bar item) pushes to `origin` when the student may. Otherwise it offers to fork and push (then to open a pull request) or to push to another of their repositories. It never force-pushes. Before pushing, unpushed commits authored by the session placeholder (`<pod>@artemis-theia.de`) can be re-authored with the GitHub noreply identity, which also becomes the repository's local identity. Artemis repositories are left alone.

**Private repositories:** the token-less clone at startup fails, Scorpio offers to sign in with `repo`, and clones again.

| Setting                                   | Environment override           | Default      | Purpose                                                        |
| ----------------------------------------- | ------------------------------ | ------------ | -------------------------------------------------------------- |
| `scorpio.github.clientId`                 | `SCORPIO_GITHUB_CLIENT_ID`     | empty (off)  | Public client ID of the OAuth App                              |
| `scorpio.github.allowPrivateRepositories` | `SCORPIO_GITHUB_PRIVATE_REPOS` | `true`       | Whether Scorpio may ask for the `repo` scope                   |
| `scorpio.github.host`                     | `SCORPIO_GITHUB_HOST`          | `github.com` | GitHub Enterprise Server host (API at `https://<host>/api/v3`) |

The OAuth App needs the device flow enabled. Nothing else about it is configured in Scorpio.
