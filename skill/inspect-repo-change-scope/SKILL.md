---
name: inspect-repo-change-scope
description: "Internal helper — called by other skills. Inspect the current repo to determine branch, base ref, committed diff, uncommitted changes, and untracked files. Returns a structured change summary."
---

# Inspect Repo Change Scope

Gather the full picture of what has changed relative to a base ref.

## Inputs

- Base ref for comparison. Defaults to `origin/main`.

## Steps

1. Get the current branch:
   ```bash
   git branch --show-current
   ```
2. Get working tree status:
   ```bash
   git status --short
   ```
3. Get committed diff stat (if branch differs from the base ref):
   ```bash
   git diff --no-ext-diff --stat <BASE_REF>...HEAD
   ```
4. Get uncommitted changes (if working tree is dirty):
   ```bash
   git diff --no-ext-diff --stat
   ```
5. Get untracked files:
   ```bash
   git ls-files --others --exclude-standard
   ```

## Output

A structured summary:

```
- Branch: <name>
- Base ref: <ref>
- Working tree dirty: yes/no
- Committed changes: <file list with stats, or "none">
- Uncommitted changes: <file list with stats, or "none">
- Untracked files: <file list, or "none">
```
