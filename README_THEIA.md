# Theia/EduIDE Features

Scorpio is primarily designed for Theia/EduIDE environments. All core features (auto-clone, git identity, env loading, settings protection) activate automatically when running in Theia.

## Environment Variables

Scorpio reads the following variables from the Theia environment:

| Variable         | Required | Purpose                                                                                                                    |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ARTEMIS_URL`    | No       | Artemis server base URL (Artemis exercises only)                                                                           |
| `GIT_URI`        | No       | Repository URL to clone; nothing is cloned without it                                                                      |
| `GIT_USER`       | No       | Git username (falls back to hostname)                                                                                      |
| `GIT_MAIL`       | No       | Git email (falls back to `<username>@artemis-theia.de`)                                                                    |
| `THEIA`          | No       | Explicit Theia flag (auto-detected via DataBridge)                                                                         |
| `GRADLE_PREWARM` | No       | Gradle pre-warm level: `off`, `daemon`, `deps`, or `full`. Default `daemon` for Artemis, `off` for other sources           |
| `GIT_REF`        | No       | Branch, tag or commit to check out after cloning; default branch if unset                                                  |
| `GIT_SOURCE`     | No       | `artemis`, `github` or `other`. Default: `artemis` with `ARTEMIS_URL`, `github` for a `github.com` `GIT_URI`, else `other` |

A failed clone is reported in a notification, with credentials removed from the URL and git's message.

Pre-warming runs the repository's own `./gradlew` and build scripts, so it is off by default for repositories that do not come from Artemis.

## Environment Strategy

Set `SCORPIO_THEIA_ENV_STRATEGY=data-bridge` to use the DataBridge extension (`tum-aet.data-bridge`) for environment variable loading. Otherwise, process environment variables are read directly.

The operator sets this for warm-pool (eagerly started) instances, which receive the session's variables after they started. Scorpio polls the bridge for up to 10 seconds and proceeds as soon as `GIT_URI` or `THEIA` arrives; the operator injects all of a session's variables at once. `ARTEMIS_URL` is not required, so sessions opened from somewhere other than Artemis, such as a GitHub link, are cloned too.

## GitHub: sign-in, push, private repositories

For sessions opened from GitHub (for example with the "Open in EduIDE" browser extension), Scorpio can sign the student in to GitHub and push their commits. It is off until an OAuth App client ID is configured.

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
