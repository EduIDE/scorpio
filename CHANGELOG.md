# Change Log

All notable changes to the "scorpio" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Fix 51 Dependabot security alerts by updating vulnerable transitive dependencies
- Initial release
- `GRADLE_PREWARM_AUTO_CONFIRM=false` asks the student before prewarming runs the repository's Gradle wrapper
- A second browser window no longer replaces the git identity with the pod hostname
- A failed clone no longer stops the extension from starting or skips the git identity
- Two browser windows starting together no longer both clear the workspace and clone
- Added a test suite for session startup, run with `npm test`
- Publish only to Open VSX, as `aet-tum.artemis-scorpio`, through trusted publishing. The VS Code Marketplace release and its token are gone
