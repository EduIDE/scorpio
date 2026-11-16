# Change Log

All notable changes to the "scorpio" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Breaking changes

- `GRADLE_PREWARM_AUTO_CONFIRM` now defaults to `false`: the student is asked before pre-warming runs the repository's Gradle wrapper. Set it to `true` in the deployment to keep the old behavior. In data bridge mode the value is read from the pod environment, and a value delivered through the bridge is ignored (internal security audit 2026-11-16, SC-02)
- Credentials in `GIT_URI` are no longer stored in the clone's `.git/config` or passed on the git command line; pushing needs a sign-in (internal security audit 2026-11-16, SC-03)

### Fixes

- **Security:** Scorpio never clears a workspace that has content. It clones only into an empty workspace; if the checkout does not match `GIT_URI` (renamed remote, changed origin, git error), the student gets a warning instead of losing files. A checkout is matched by host and path, and credentials are removed from its origin URL (internal security audit 2026-11-16, SC-01)

## [2.2.0] - 2026-11-16

### Features

- Scorpio can bootstrap a workspace from a template: without `GIT_URI`, `TEMPLATE` copies `<templates dir>/<id>` into an empty workspace (`SCORPIO_TEMPLATES_DIR`, default `/home/theia/templates`). `GIT_URI` always wins, and the template's `.vscode/settings.json` is merged over the image's ([#219](https://github.com/EduIDE/scorpio/pull/219))
- Scorpio no longer depends on Artemis: it has a new display name and description, and `scorpio.artemis.apiBaseUrl` is optional ([#219](https://github.com/EduIDE/scorpio/pull/219))

### Fixes

- Warm-pool sessions opened from a GitHub link now clone `GIT_URI` without waiting for `ARTEMIS_URL` ([#219](https://github.com/EduIDE/scorpio/pull/219))

### Dependencies

- Update npm dev dependencies ([#218](https://github.com/EduIDE/scorpio/pull/218))

## [2.1.1] - 2026-11-06

### Features

- `GRADLE_PREWARM_AUTO_CONFIRM=false` asks the student before prewarming runs the repository's Gradle wrapper ([#207](https://github.com/EduIDE/scorpio/pull/207), [#208](https://github.com/EduIDE/scorpio/pull/208))
- Publish only to Open VSX, as `aet-tum.artemis-scorpio`, through trusted publishing. The VS Code Marketplace release and its token are gone ([#213](https://github.com/EduIDE/scorpio/pull/213))

### Fixes

- A second browser window no longer replaces the git identity with the pod hostname ([#208](https://github.com/EduIDE/scorpio/pull/208))
- A failed clone no longer stops the extension from starting or skips the git identity ([#209](https://github.com/EduIDE/scorpio/pull/209))
- Two browser windows starting together no longer both clear the workspace and clone ([#210](https://github.com/EduIDE/scorpio/pull/210))

### Dependencies

- simple-git 4 and minimatch 11, fixing the remaining Dependabot alerts ([#214](https://github.com/EduIDE/scorpio/pull/214))
- Fix 51 Dependabot security alerts by updating vulnerable transitive dependencies ([#212](https://github.com/EduIDE/scorpio/pull/212))
