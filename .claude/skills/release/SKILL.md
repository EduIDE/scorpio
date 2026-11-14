---
name: release
description: Release scorpio. Use when asked to release, cut a release, make or publish a new version, ship a version, tag a version, or prepare a release candidate of scorpio. Finds the unreleased changes, proposes the version, checks the EduIDE dependencies it pins, writes CHANGELOG.md, opens the release pull request and runs release.yml.
---

# Releasing scorpio

A release is two steps with a human in between:

1. a **release pull request** that bumps the version files and moves the
   unreleased CHANGELOG entries under the new version, and
2. after it is merged, a run of **`release.yml`** (`workflow_dispatch`, input
   `version`), which validates, builds, tags, creates the GitHub Release from
   the CHANGELOG section and publishes.

Nothing releases on push to `main`. Tags look like `vX.Y.Z`;
images, charts and vsix files carry `X.Y.Z` without the prefix.

## Reference for this repository

Version files (release.yml refuses a stable version they do not state):

| File | Field |
|---|---|
| `package.json`, `package-lock.json` | `version`. Bump with `npm version X.Y.Z --no-git-tag-version`. A `-rc.N` is not checked. |

What a release publishes:

| Artifact | Where | Check |
|---|---|---|
| GitHub Release `vX.Y.Z` with `artemis-scorpio-X.Y.Z.vsix` (prerelease for `-rc.N`) | https://github.com/EduIDE/scorpio/releases | `gh release view vX.Y.Z -R EduIDE/scorpio --json assets --jq '.assets[].name'` |
| Open VSX `aet-tum/artemis-scorpio` X.Y.Z (stable only, never an `-rc.N`) | https://open-vsx.org/extension/aet-tum/artemis-scorpio | `curl -fsS https://open-vsx.org/api/aet-tum/artemis-scorpio/X.Y.Z \| jq -r .version` |

EduIDE dependencies this repository pins: **none**. It is a leaf in the EduIDE dependency graph.

Who pins this repository (tell the user after the release):

| Repository | Pinned in |
|---|---|
| EduIDE | `images/base-ide/package.json.patch`, `theiaPlugins.scorpio` (Open VSX URL, version without `v`) |

## 1. Find the last release and what is unreleased

```bash
gh release list -R EduIDE/scorpio --limit 10
LAST=$(gh release list -R EduIDE/scorpio --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName')
git fetch origin --tags
git log --first-parent --format='%h %s' "$LAST"..origin/main
```

Read the merged pull requests behind those commits, not only the titles:

```bash
gh pr list -R EduIDE/scorpio --state merged --base main --limit 100 \
  --search "merged:>$(git log -1 --format=%cI "$LAST")" \
  --json number,title,labels,body,url
```

Also read the `## [Unreleased]` section of `CHANGELOG.md`. If there are no
commits since `$LAST`, say so and stop, unless a dependency bump (step 3) is
the reason for the release.

## 2. Propose a version and let the user decide

Derive it from the changes since `$LAST` (conventional commits and the PR
content, not only the prefix):

| Change | Bump |
|---|---|
| `!` after the type, `BREAKING CHANGE:`, a removed or renamed option, a changed default that alters behaviour, a dependency pin that requires a breaking upgrade | major (minor while the version is `0.x`) |
| `feat`, a new option, a dependency pin that brings features | minor |
| `fix`, `perf`, security fixes, dependency pins with fixes only | patch |
| only `chore`, `ci`, `docs`, `test`, `build` | usually nothing to release; ask |

A prerelease is `X.Y.Z-rc.N`, only when the user asks for one or wants to test
before a stable release. `N` starts at 1 and continues after the highest
existing `-rc.N` of that `X.Y.Z`.

**Ask the user** with a question (the AskUserQuestion tool when available):
the proposed version as the first option, with a one-line reason
("minor: 2 features, 3 fixes, no breaking change"), the next lower and higher
bump, and the release candidate variant. Never continue on a guessed version.

## 3. Check every EduIDE dependency

This repository pins no other EduIDE release, so there is nothing to check in
this step. Say so to the user in one line and continue with step 4.

## 4. Write the release notes into CHANGELOG.md

Move the content of `## [Unreleased]` under a new heading and leave an empty
`## [Unreleased]` above it. release.yml copies exactly this section into the
GitHub Release, so write it for the people who install or use the release,
not for the people who wrote the code:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Breaking changes

- What changed, what a user has to do about it ([#123](https://github.com/EduIDE/scorpio/pull/123))

### Features

- What a user can now do, in one sentence ([#124](https://github.com/EduIDE/scorpio/pull/124))

### Fixes

- What was wrong, as the user saw it, and that it no longer happens ([#125](https://github.com/EduIDE/scorpio/pull/125))

### Dependencies

- EduIDE-Cloud 1.3.0 -> 1.4.0: operator metrics ([release](https://github.com/EduIDE/EduIDE-Cloud/releases/tag/v1.4.0))
```

Rules:

- Every entry links its pull request. Find it with `gh pr list --search <sha>`
  when the Unreleased entry has none.
- Leave out empty groups. Merge entries that describe one change. Leave out
  pure CI, test and refactoring changes unless a user can notice them.
- Keep existing per-entry conventions of this file (for example `[eduide]`
  prefixes in EduIDE-Helm, `**Security:**` markers).
- Add `### Upgrade notes` when an operator has to do something beyond
  installing the new version.
- Use hyphens, never em or en dashes.

## 5. Open the release pull request

On a branch `release/X.Y.Z` from the latest `origin/main`:

1. Bump every row of "Version files" to `X.Y.Z` (skip if there are none).
2. Write the CHANGELOG section from step 4.
3. Run the repository's checks: `npm run lint && npm test && npm run build`.

Show the user the diff and ask before committing and pushing. Then:

```bash
git commit -m "chore(release): X.Y.Z"
git push -u origin release/X.Y.Z
gh pr create -R EduIDE/scorpio --title "chore(release): X.Y.Z" --body-file <notes plus the dependency table>
```

Give the user the PR link, watch CI and fix failures. Do not merge it yourself
unless the user asks.

**Release candidate shortcut:** a `-rc.N` needs no release pull request.
release.yml does not check version files for a prerelease and falls back to the
Unreleased section for the notes. Dispatch it from the branch to test
(step 6 with `--ref <branch>`).

## 6. Run release.yml after the merge

```bash
gh workflow run release.yml -R EduIDE/scorpio --ref main -f version=X.Y.Z
sleep 5
RUN=$(gh run list -R EduIDE/scorpio --workflow release.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" -R EduIDE/scorpio --exit-status
```

If a job waits for an environment approval (`prod`), tell the user to approve
it in the run page. If `validate` fails, the message says what to fix; fix it
in a new pull request, never by editing tags. If a later job fails, fix the
cause and use "Re-run failed jobs": the tag stays, nothing is published twice.
Never delete a tag or a release once something was published under it; ship
the next patch version instead.

## 7. Verify what was published

Check every row of "What a release publishes", for example:

```bash
gh release view vX.Y.Z -R EduIDE/scorpio --json url,isPrerelease,assets --jq '{url, isPrerelease, assets: [.assets[].name]}'
crane manifest ghcr.io/eduide/<image>:X.Y.Z | jq -r '[.manifests[].platform.architecture] | join(",")'   # amd64 and arm64
helm show chart oci://ghcr.io/eduide/charts/<chart> --version X.Y.Z
curl -fsS https://open-vsx.org/api/<namespace>/<name>/X.Y.Z | jq -r .version
```

Report to the user: the release link, the artifacts with their check result,
and every row of "Who pins this repository" with its current pin, so they can
decide whether to bump it next (that repository's release skill does it).

## Notes for scorpio

- The `publish` job runs in environment `prod`, which has required reviewers
  (EduIDE Maintainers). Tell the user to approve the run on its page.
- A release candidate publishes the vsix to a GitHub prerelease only, never to
  Open VSX. Dispatch it from the branch that holds the change to test.
- The Open VSX publisher is bound to `release.yml` in this repository and to
  environment `prod`. If publishing fails with an authorization error, check
  the trusted publisher settings on open-vsx.org before anything else.
