# Development

## Setup

Navigate into the repository and press <kbd>F5</kbd> (<kbd>fn + F5</kbd> on Mac) to start the extension in a new VS Code window with the extension loaded.

Behind the scenes, this runs the default build task defined in [.vscode/tasks.json](.vscode/tasks.json):

```bash
npm run build
```

## Architecture

Scorpio is a Node.js-only VS Code extension (no webview). The source is in `src/` and consists of five modules:

- `extension.ts` - Activation: loads Theia env, initializes settings, registers the restart command.
- `shared/settings.ts` - Reads and protects `scorpio.artemis.apiBaseUrl` and `scorpio.defaults.repoPath`.
- `theia/env-strategy.ts` - Two strategies for reading Theia environment variables: `ProcessEnvStrategy` and `DataBridgeStrategy`.
- `theia/theia.ts` - Auto-clone into workspace root with idempotence guard, git identity setup.
- `participation/cloning.service.ts` - Git clone operations with workspace-root path preservation.

## Build

```bash
npm install
npm run build          # webpack production build
npm run watch          # webpack watch mode
npm run lint           # eslint
npm run package        # vsce package
```

## Release

1. Go to GitHub Releases in the scorpio repository
2. Click "Draft a new release"
3. Choose a tag with the new version number (e.g. `v1.5.0`)
4. Generate release notes automatically
5. An admin reviews and approves the release
6. GitHub builds, uploads the artifact, and publishes to the marketplace
