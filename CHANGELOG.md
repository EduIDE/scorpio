# Change Log

All notable changes to the "scorpio" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Add `TEMPLATE`: without `GIT_URI`, copy `<templates dir>/<id>` into an empty workspace (`SCORPIO_TEMPLATES_DIR`, default `/home/theia/templates`); `GIT_URI` always wins
- Scorpio is a workspace bootstrap for EduIDE, independent of Artemis: new display name and description, `scorpio.artemis.apiBaseUrl` is optional and has no default
- Warm-pool sessions opened from a GitHub link now clone `GIT_URI` without waiting for `ARTEMIS_URL`
- simple-git 4 and minimatch 11, fixing the remaining Dependabot alerts
- Fix 51 Dependabot security alerts by updating vulnerable transitive dependencies
- Initial release
- `GRADLE_PREWARM_AUTO_CONFIRM=false` asks the student before prewarming runs the repository's Gradle wrapper
- A second browser window no longer replaces the git identity with the pod hostname
- A failed clone no longer stops the extension from starting or skips the git identity
- Two browser windows starting together no longer both clear the workspace and clone
- Added a test suite for session startup, run with `npm test`
- Publish only to Open VSX, as `aet-tum.artemis-scorpio`, through trusted publishing. The VS Code Marketplace release and its token are gone
