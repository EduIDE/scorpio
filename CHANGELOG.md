# Change Log

All notable changes to the "scorpio" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release

### Security

- Gradle prewarm no longer runs the cloned repository's `./gradlew` wrapper automatically. The
  student must explicitly confirm before any repository-controlled Gradle build is executed,
  removing a silent remote-code-execution path from tampered exercise templates.
- The VCS/Git access token is no longer embedded in the clone URL or passed on the git command
  line. It is injected through the git process environment (`GIT_CONFIG_*`) during clone and
  persisted only into `.git/config` for later in-IDE fetch/push.
- STOMP/WebSocket frame logging is disabled so the Artemis JWT in the CONNECT frame is never
  written to the debug console.
- The `ARTEMIS_URL` environment override is validated against the configured Artemis origin
  (scheme + host + port) before it is used as the API base, preventing the Bearer token from
  being sent to an untrusted host.
