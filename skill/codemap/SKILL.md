---
name: codemap
description: Create or update concise repository codemaps for unfamiliar codebases. Use when the user explicitly asks to map a repo, document architecture, generate a codebase atlas, onboard to an unfamiliar project, or refresh an existing codemap after meaningful structural changes.
---

# Codemap

Codemap creates a durable map of a repository so future humans and agents can
find the right files without spelunking through the same cave every session.

This is intentionally bounded. A codemap is a navigation aid, not a second
codebase written in Markdown.

## When to Use

Use this skill when the user explicitly asks to:

- generate a codemap, repo map, repository atlas, or architecture map;
- document an unfamiliar codebase before implementation;
- update an existing `codemap.md` after structural changes;
- create onboarding documentation for where important code lives.

Do not use this for every implementation task. Prefer targeted exploration when
the user only needs one file, one call path, or one bug fixed.

## Guardrails

- Respect `.gitignore` and avoid dependency/build outputs such as
  `node_modules/`, `dist/`, `build/`, coverage output, vendored code, and caches.
- Exclude generated files unless they are the public interface users edit or
  consume.
- Keep summaries factual and tied to files you inspected.
- Mark uncertainty instead of guessing.
- Do not rewrite `AGENTS.md`, README files, or project docs unless the user asked
  for documentation changes or approves the proposed edit.
- For very large repos, map the top-level architecture first, then expand only
  the directories relevant to the user’s goal.

## Workflow

### 1. Check Existing Maps

Before generating anything new, look for:

- root `codemap.md`;
- nested `codemap.md` files;
- `AGENTS.md` repository map sections;
- `docs/architecture*`, `docs/*overview*`, README architecture sections;
- diagrams or runbooks that already describe the system.

If an existing map is current enough, summarize it and ask whether the user wants
an update instead of duplicating it.

### 2. Define Scope

Clarify whether the requested map should cover:

- the whole repository;
- only application source;
- infrastructure, CI, tests, or deployment paths;
- one subsystem or feature area.

If scope is not specified, start with the whole repo at a shallow level and note
which areas need deeper follow-up.

### 3. Inventory the Repository

Use fast file discovery first:

- top-level files and directories;
- package/build files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`,
  `justfile`, Makefiles, workflow files);
- app entry points;
- route/API definitions;
- data models and migrations;
- tests and fixtures;
- infrastructure and deployment files.

Prefer `glob` and targeted `grep` searches over reading everything. Delegate
parallel exploration for large repos when useful.

### 4. Identify Architecture

For each important directory, record:

- **Responsibility:** what the directory owns;
- **Entry points:** files a maintainer should open first;
- **Key flows:** how data or control moves through the system;
- **Integration points:** external services, CLIs, databases, queues, APIs, MCPs,
  plugins, or runtime hooks;
- **Tests:** where behavior is verified;
- **Operational notes:** build, deploy, migrations, scheduled jobs, or release
  concerns;
- **Risks and unknowns:** confusing areas, missing tests, or generated code.

Use concrete paths and symbol names. Avoid vague summaries like "contains
business logic" unless you also say what business logic.

### 5. Write the Codemap

For a root `codemap.md`, use this structure:

```markdown
# Codemap: <repo-name>

## Purpose
<one paragraph describing what this repo does>

## Entry Points
- `<path>`: <why it matters>

## Directory Map
| Path | Responsibility | Start Here |
|------|----------------|------------|
| `<dir>/` | <summary> | `<file>` |

## Core Flows
### <flow name>
1. `<file>` / `<symbol>`: <step>
2. `<file>` / `<symbol>`: <step>

## Build, Test, and Run
- <commands or repo docs, with source paths>

## Integration Points
- <service/tool/protocol>: <paths and notes>

## Tests and Quality Gates
- `<path>`: <coverage responsibility>

## Risks and Unknowns
- <thing to verify later>

## Maintenance Notes
- Last mapped: <date>
- Update when: <trigger>
```

For nested `codemap.md` files, keep them shorter:

```markdown
# <directory>

## Responsibility
<specific role>

## Key Files
- `<file>`: <why it matters>

## Flows
- <flow with concrete paths/symbols>

## Tests
- `<path>`: <what it covers>

## Notes
- <important caveat>
```

### 6. Register Discoverability Carefully

If the user wants future agents to automatically find the map, propose adding a
small `AGENTS.md` section:

```markdown
## Repository Map

Start with `codemap.md` for architecture, entry points, and directory
responsibilities. For focused work, read the nested `codemap.md` in the relevant
directory when one exists.
```

Only edit `AGENTS.md` after confirming it fits the repo’s existing instructions.

## Updating an Existing Codemap

When refreshing a map:

1. Read the current codemap first.
2. Compare it against current file structure and entry points.
3. Update only stale sections unless the user asks for a full rewrite.
4. Remove references to deleted files.
5. Add a maintenance note with the update date and reason.

## Output Before Writing

If the user has not explicitly asked you to write files, return a plan first:

```text
Codemap plan
- Scope: <repo/subsystem>
- Existing docs found: <paths or none>
- Proposed outputs: <files to create/update>
- Expensive areas to skip or sample: <paths>
```

If writing files, finish with:

```text
Codemap complete
- Created/updated: <paths>
- Key entry points: <short list>
- Follow-ups: <unknowns or suggested deeper maps>
```
