# Theia/EduIDE Features

Scorpio is primarily designed for Theia/EduIDE environments. All core features (auto-clone, git identity, env loading, settings protection) activate automatically when running in Theia.

## Environment Variables

Scorpio reads the following variables from the Theia environment:

| Variable                      | Required | Purpose                                                                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ARTEMIS_URL`                 | No       | Artemis server base URL (Artemis exercises only)                                                                           |
| `GIT_URI`                     | No       | Repository URL to clone; nothing is cloned without it                                                                      |
| `GIT_USER`                    | No       | Git username (falls back to hostname)                                                                                      |
| `GIT_MAIL`                    | No       | Git email (falls back to `<username>@artemis-theia.de`)                                                                    |
| `THEIA`                       | No       | Explicit Theia flag (auto-detected via DataBridge)                                                                         |
| `GRADLE_PREWARM`              | No       | Gradle pre-warm level: `off`, `daemon`, `deps`, or `full`. Default `daemon` for Artemis, `off` for other sources           |
| `GRADLE_PREWARM_AUTO_CONFIRM` | No       | `false` asks the student before pre-warming runs the repository's Gradle wrapper. Default `true`                           |
| `GIT_REF`                     | No       | Branch, tag or commit to check out after cloning; default branch if unset                                                  |
| `GIT_SOURCE`                  | No       | `artemis`, `github` or `other`. Default: `artemis` with `ARTEMIS_URL`, `github` for a `github.com` `GIT_URI`, else `other` |

A failed clone is reported in a notification, with credentials removed from the URL and git's message.

Pre-warming runs the repository's own `./gradlew` and build scripts, so it is off by default for repositories that do not come from Artemis.

## Environment Strategy

Set `SCORPIO_THEIA_ENV_STRATEGY=data-bridge` to use the DataBridge extension (`tum-aet.data-bridge`) for environment variable loading. Otherwise, process environment variables are read directly.

The operator sets this for warm-pool (eagerly started) instances, which receive the session's variables after they started. Scorpio polls the bridge for up to 10 seconds and proceeds as soon as `GIT_URI` or `THEIA` arrives; the operator injects all of a session's variables at once. `ARTEMIS_URL` is not required, so sessions opened from somewhere other than Artemis, such as a GitHub link, are cloned too.
