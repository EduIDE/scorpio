# Theia/EduIDE Features

Scorpio is primarily designed for Theia/EduIDE environments. All core features (auto-clone, git identity, env loading, settings protection) activate automatically when running in Theia.

## Environment Variables

Scorpio reads the following variables from the Theia environment:

| Variable         | Required | Purpose                                                             |
| ---------------- | -------- | ------------------------------------------------------------------- |
| `ARTEMIS_URL`    | Yes      | Artemis server base URL                                             |
| `GIT_URI`        | Yes      | Repository URL to clone                                             |
| `GIT_USER`       | No       | Git username (falls back to hostname)                               |
| `GIT_MAIL`       | No       | Git email (falls back to `<username>@artemis-theia.de`)             |
| `THEIA`          | No       | Explicit Theia flag (auto-detected via DataBridge)                  |
| `GRADLE_PREWARM` | No       | Gradle pre-warm level: `off`, `daemon` (default), `deps`, or `full` |

## Environment Strategy

Set `SCORPIO_THEIA_ENV_STRATEGY=data-bridge` to use the DataBridge extension (`tum-aet.data-bridge`) for environment variable loading. Otherwise, process environment variables are read directly.
