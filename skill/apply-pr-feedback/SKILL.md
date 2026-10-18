---
name: apply-pr-feedback
description: Apply GitHub Copilot PR review feedback. Resolves PR number → fetches Copilot comments → applies fixes → wrapup → commit/push.
---

# Apply PR Feedback

Apply code review suggestions from GitHub Copilot on the current PR.

## Arguments

- `$1` — PR number or URL. Optional.

## Workflow

### 1. Resolve PR number

If `$1` is provided, extract the number (from a URL if needed) and use it.
Otherwise, look up the PR for the current branch:
```bash
gh pr view --json number -q .number
```
If no PR exists, report that and stop.

### 2. Fetch Copilot suggestions

```bash
gh api /repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pulls/<PR-NUMBER>/comments | \
  jq '.[] | select(.user.login == "Copilot")'
```

If no Copilot comments exist, report that and stop.

### 3. Apply each fix systematically

For each Copilot suggestion:
1. Read the suggestion and understand the requested change.
2. Locate the code at the referenced file and line.
3. Apply the fix.
4. Update related tests if needed.

### 4. Validate changes

Run the project's standard format/lint/test workflow (e.g. load the `wrapup` skill if available, or follow the project's AGENTS.md testing instructions). Fix any failures iteratively until all pass.

### 5. Commit and push

**Ask the user before proceeding:**
> All fixes applied and tests pass. Commit and push? (y/n)

Wait for confirmation. If confirmed:

```bash
git add .
git commit -m "fix: apply Copilot PR feedback"
git push
```

If declined, report that changes are ready but uncommitted.
