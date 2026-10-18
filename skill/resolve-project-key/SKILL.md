---
name: resolve-project-key
description: "Internal helper — called by other skills. Resolve the Jira project key from explicit user context, repo context, or branch name. Ask the user when it cannot be determined safely."
---

# Resolve Project Key

Resolve a Jira project key without stalling the caller. Skills receive context
through prompt text, so callers should state any known project key in plain
language when loading or invoking this helper.

## Steps

1. If the caller or user already provided a project key, normalize it to uppercase and use it directly.
2. Otherwise, read the nearest `AGENTS.md` only if it is already in the current workspace/repo context. Extract an explicit Jira project key if one is documented.
   - Look for labels such as `Jira project`, `Project key`, or `Atlassian Defaults`.
   - Do not search the user's home directory or unrelated parent directories.
3. If still unresolved, check the current git branch name for a Jira project key prefix (e.g. `PROJ-123-fix-thing` → `PROJ`).
4. If still unresolved, ask the user for the project key with the `question` tool. Never guess a default.

## Output

A single project key string, e.g. `PROJ`.
