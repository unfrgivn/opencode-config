---
name: resolve-test-scope
description: "Internal helper — called by other skills. Determine which files or modules to test based on changed files. Returns one or more test paths."
---

# Resolve Test Scope

Determine the minimal set of test paths based on the files that changed.

## Arguments

- `$1` — Explicit test path override. Optional.

## Steps

1. If `$1` is provided, use it directly.
2. Otherwise, inspect changed files:
   ```bash
   git diff --no-ext-diff --name-only HEAD
   git diff --no-ext-diff --name-only
   git ls-files --others --exclude-standard
   ```
3. Check whether the project's test runner has built-in support for scoping tests to changed files. For example:
   - **Vitest:** `vitest list --changed main` lists test files related to changes vs the base branch.
   - If the test runner provides a changed-file mode, prefer it over manual scope extraction.
4. Read the project's `AGENTS.md` to understand the source layout and test conventions (e.g. Django apps under `myproject/`, feature modules under `src/features/`, workspace apps under `apps/`).
5. For each changed file, extract the relevant test scope:
   - **Django projects:** the app path (e.g. first two path segments like `myproject/bid_and_budget/`).
   - **JS/TS projects:** the feature or module directory (e.g. `src/features/dashboard/`).
   - **Monorepos:** the workspace member or app directory (e.g. `apps/budget-spend/`).
   - **Other layouts:** use the nearest test directory or module containing the changed file.
6. Deduplicate the list.
7. If no test paths can be determined, ask the user.

## Output

A list of test paths, e.g. `["myproject/bid_and_budget/"]` or `["src/features/dashboard/"]`.
