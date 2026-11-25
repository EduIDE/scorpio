# AGENTS.md - Scorpio

VS Code extension in the EduIDE session IDE: prepares the project at session start (clone, template copy, git identity, Gradle warmup).
See `README.md` for features, `README_THEIA.md` for the variables it reads and `README_DEVELOPER.md` for the layout and release.

## Terminology

Use the terms of the [EduIDE glossary](https://eduide.github.io/Docs/glossary) in code, UI texts, docs, values and comments, in exactly the meaning it gives.
Do not introduce synonyms (environment, instance, workspace, launch, lecturer, start page) for a term the glossary defines, and never write "frontend" or "backend".
When a new term is needed or a term changes, update the glossary in `EduIDE/Docs` first.
Most relevant here: session, launch data, template (an `IDETemplate`; the `TEMPLATE` value names a starter project), idle instance, start strategy. "Gradle warmup" is not pool warm-up.
