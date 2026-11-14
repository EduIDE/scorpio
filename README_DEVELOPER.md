# Development

## Setup

Navigate into the repository and press <kbd>F5</kbd> (<kbd>fn + F5</kbd> on Mac) to start the extension in a new VS Code window with the extension loaded.

Behind the scenes, this runs the default build task defined in [.vscode/tasks.json](.vscode/tasks.json):

```bash
npm run build
```

## Architecture

Scorpio is a Node.js-only VS Code extension (no webview). The source is in `src/` and consists of six modules:

- `extension.ts` - Activation: loads Theia env, initializes settings, registers the restart command.
- `shared/settings.ts` - Reads and protects `scorpio.artemis.apiBaseUrl` and `scorpio.defaults.repoPath`.
- `theia/env-strategy.ts` - Two strategies for reading Theia environment variables: `ProcessEnvStrategy` and `DataBridgeStrategy`. Also parses the `GRADLE_PREWARM` level.
- `theia/theia.ts` - Auto-clone into workspace root with idempotence guard, git identity setup, and Gradle pre-warm trigger.
- `participation/cloning.service.ts` - Git clone operations with workspace-root path preservation.
- `participation/gradle.service.ts` - Background Gradle pre-warming after clone; skips non-Gradle repositories and Windows.

## Build

```bash
npm install
npm run build          # webpack production build
npm run watch          # webpack watch mode
npm run lint           # eslint
npm test               # node:test with a stubbed vscode module
npm run package        # vsce package
```

## Release

Releases are manual. Ask Claude to "release scorpio" (skill `.claude/skills/release`) or do it by hand:

1. Open a release pull request that moves the `## [Unreleased]` entries of `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`. The CHANGELOG section becomes the GitHub release notes.
2. After it is merged, run `gh workflow run release.yml -R EduIDE/scorpio --ref main -f version=X.Y.Z`.
3. Approve the run in environment `prod` (required reviewers). The workflow drafts the GitHub Release, packages the vsix (version stamped from the input), attaches `artemis-scorpio-X.Y.Z.vsix`, publishes to Open VSX through trusted publishing, verifies both and publishes the release, which creates tag `vX.Y.Z`.

A release candidate (`-rc.N`, for example `2.2.0-rc.1`) can be dispatched from any branch. It creates a GitHub prerelease with the vsix and never publishes to Open VSX.

After a release, bump `theiaPlugins.scorpio` in EduIDE (`images/base-ide/package.json.patch`).
