---
name: create-pr
description: >-
  Create GitHub pull requests from the current branch with clear, concise PR titles
  and descriptions. Use when the user asks to open, draft, prepare, or create a PR,
  especially when they want the PR body to focus on the problem and solution rather
  than a file-by-file change log.
---

# Create PR

## Overview

Create PRs that explain why the change exists and how it solves the problem. Keep the body useful for reviewers, not a transcript of local git state.

## Core rules

- Use `gh` for all GitHub operations.
- Inspect the branch diff and commits before writing the PR.
- Write for reviewers who need context, not for robots counting files.
- Prefer simple language: problem, solution, and validation.
- Do not include a list of changed files.
- Do not mention unstaged or untracked files that are not part of the PR.
- Do not pad the body with obvious implementation details that are clear from the diff.
- Never overstate the obvious.
- For ticket-driven work, include the Jira ticket link when available.

## Workflow

1. Identify the current branch and base branch.
2. Confirm the branch has committed changes relative to the base.
3. Check whether the branch already has an open PR.
4. Push the branch if it is not on the remote yet.
5. Draft a concise title and body from the committed diff and commit history.
6. Create the PR with `gh pr create`.
7. Return the PR URL.

Use these commands as the normal discovery path:

```bash
git status --short
git branch --show-current
git remote show origin
git log --oneline --decorate --max-count=20
git diff --stat <base>...HEAD
git diff <base>...HEAD
gh pr view --json url,state,title
```

If `gh pr view` finds an existing PR, report it and ask whether to update it instead of creating another one.

If the current branch is the base branch, stop and ask the user to create or switch to a feature branch.

## PR body format

Use this shape unless the repository has a stronger convention:

For fixes:

```markdown
## Problem

- <What was broken, missing, risky, or painful.>

## Solution

- <How this change addresses the problem.>

## Validation

- <How the change was tested, or what evidence supports it.>
```

For features or larger changes:

```markdown
<Description or TL;DR of the change.>

- <Supporting bullets or notes>

## Validation

- <How the change was tested, or what evidence supports it.>
```

Keep each section concise. Prefer bullets for readability and clarity. If validation was not run, do not include that section. For ticket-driven work, include the Jira ticket link once in the most natural place, usually near the summary or problem statement.

## Title guidance

- Use an imperative phrase, for example `Add PR creation skill` or `Fix schema install fallback`.
- Avoid ticket soup unless the repo clearly requires ticket prefixes.
- Prefer the user's requested title when provided, unless it is misleading.

## Creation command

Use a heredoc so markdown formatting survives shell quoting:

```bash
gh pr create --base <base> --head <branch> --title "<title>" --body "$(cat <<'EOF'
<PR summary goes here>
EOF
)"
```

Add `--draft` only when the user asks for a draft PR or the work is explicitly not ready for review.
