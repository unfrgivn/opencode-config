---
name: merge-pr
description: >-
  Merge GitHub pull requests safely using gh, always rebasing the source branch
  onto the destination branch first, then squash merging with a conventional
  commit title that ends in the PR number, a cleaned-up commit body, and no co-author trailers.
  Use whenever the user asks to merge a PR, land a pull request, squash a PR,
  clean up a merge commit message, or remove co-authored-by lines from a GitHub
  PR merge, even if they do not explicitly say "squash."
---

# Merge PR

## Overview

Use this skill to land GitHub PRs with consistent commit history: first rebase the source branch on the destination branch, then create one squash commit with a conventional commit title, the PR number suffix, a concise human-written body, and no `Co-authored-by:` trailers.

The default posture is cautious: inspect first, merge only after the PR is mergeable and the user has clearly asked to merge it.

## Required behavior

- Always use GitHub CLI (`gh`) for GitHub operations.
- Always rebase the PR source branch onto the destination branch immediately before squash merging.
- Reconcile rebase conflicts before merging. If the rebase rewrites the source branch, push it with `--force-with-lease`.
- Always squash merge. Never create a merge commit or rebase merge.
- Always use a conventional commit title ending with the PR number in parentheses: `<type>(<scope>): <summary> (#<PR>)` or `<type>: <summary> (#<PR>)`.
- Always clean the commit body before merging.
- Always remove `Co-authored-by:` trailers and any prose that describes co-authors.
- Do not push, force-push, close, edit, or merge anything other than the requested PR source branch.
- Never force-push the destination branch. Only use `git push --force-with-lease` for the PR source branch after a successful rebase.
- If the target PR is ambiguous, ask one short clarifying question.

## Inputs to support

Accept PR references in any of these forms:

- `owner/repo#123`
- `https://github.com/owner/repo/pull/123`
- `#123` when already inside the repository
- no argument, when the current branch has exactly one associated PR

If no PR is provided, resolve the PR for the current branch:

```bash
gh pr view --json number,url,headRefName,baseRefName,state,isDraft,mergeable,title,body,statusCheckRollup
```

If no PR exists or more than one PR is plausible, stop and ask which PR to merge.

## Preflight

Before merging:

1. Confirm `gh` is authenticated and can access the repo.
2. Fetch PR metadata.
3. Verify the PR is open and not a draft.
4. Verify it is mergeable or report the merge-blocking reason.
5. Inspect status checks and warn if required checks are failing or pending.
6. Confirm the source branch can be checked out locally and safely rebased.
7. Inspect the PR title/body and commits enough to draft a clean squash commit message.
8. Show the final title and body to the user before merging unless the user explicitly requested a fully automated merge.

Useful commands:

```bash
gh auth status
gh pr view <number> --repo <owner/repo> --json url,number,title,body,state,isDraft,mergeable,baseRefName,headRefName,author,commits,statusCheckRollup,reviewDecision
```

## Rebase the source branch first

Immediately before squash merging, rebase the PR source branch onto the latest destination branch. This keeps the destination branch history clean and ensures the final squash commit is based on current destination state.

Use a local checkout of the PR branch:

```bash
gh pr checkout <number> --repo <owner/repo>
git fetch origin <base-branch>
git rebase origin/<base-branch>
```

If the rebase succeeds and rewrote commits, update the PR source branch:

```bash
git push --force-with-lease origin HEAD:<head-branch>
```

Conflict handling:

- Stop and inspect each conflict. Resolve from first principles, preserving both the PR intent and destination branch changes.
- Run the relevant formatter/tests for files touched while resolving conflicts.
- Continue with `git rebase --continue` until the rebase completes.
- If the conflict cannot be resolved confidently, stop and explain the blocking files and choices.
- After a successful conflict resolution rebase, push with `--force-with-lease` to the PR source branch.

Safety rules:

- Never use plain `--force`; use `--force-with-lease` only.
- Never force-push `main`, `master`, or the destination branch.
- If the PR source branch is from a fork and cannot be pushed, report that the branch must be updated by the PR author before merging.
- After pushing the rebased source branch, refetch PR metadata and re-check mergeability/status checks before merging.

## Conventional commit title

Draft a title from the PR title, branch name, commit subjects, and changed-files context. Always append the PR number suffix: ` (#<PR>)`.

Allowed common types:

- `feat`: new user-facing capability
- `fix`: bug fix
- `docs`: documentation only
- `test`: tests only or test infrastructure
- `refactor`: behavior-preserving code restructuring
- `perf`: performance improvement
- `build`: build, dependency, packaging, or release plumbing
- `ci`: CI workflow changes
- `chore`: maintenance that does not fit above

Rules:

- Prefer the most specific accurate type over `chore`.
- Use a scope only when it is obvious and helpful.
- Keep the summary imperative, lowercase unless a proper noun requires caps, and under roughly 72 characters before the PR suffix when practical.
- Remove ticket prefixes, branch prefixes, reviewer tags, emoji, and noisy punctuation.
- Include exactly one PR number suffix at the end, such as `(#40)`.
- If the title already contains a PR number elsewhere, remove it and add the canonical suffix at the end.

Examples:

- `feat(orchestration): add task recovery diagnostics (#40)`
- `fix(sync): preserve local skill overrides (#41)`
- `docs: clarify plugin configuration schema (#42)`

## Clean commit body

Write a concise body that explains why the change exists and the meaningful impact. Keep it to 1-3 short paragraphs or bullets.

Remove all of the following:

- `Co-authored-by:` trailers
- `Signed-off-by:` trailers unless the repo explicitly requires DCO signoff
- Generated-by statements, AI attribution lines, or pair-programming credits
- PR template leftovers, empty headings, checklists, screenshots sections, deployment notes with no content
- Long commit lists that repeat the PR commits
- Reviewer discussion, acknowledgements, and co-author descriptions

Keep useful context:

- user-facing behavior changes
- bug cause and fix summary
- compatibility or migration notes
- test or validation summary if important

If there is no useful body after cleanup, use an empty body rather than filler.

## Merge workflow

1. Resolve the PR reference.
2. Fetch and inspect PR metadata.
3. Rebase the PR source branch onto the latest destination branch.
4. Reconcile any rebase conflicts, run relevant validation, and push the rebased source branch with `--force-with-lease` if needed.
5. Refetch PR metadata and confirm the PR is still mergeable.
6. Draft the squash commit title and body.
7. Present the merge plan:
   - PR URL
   - base branch
   - head branch
   - rebase result and whether the source branch was force-pushed with lease
   - review/check status summary
   - final commit title
   - final commit body, or `(empty)`
8. If the user has not already clearly authorized merging, ask for confirmation.
9. Run the squash merge command.
10. Verify the PR is merged.
11. Report the merged PR URL and final commit title.

Command template:

```bash
gh pr merge <number> \
  --repo <owner/repo> \
  --squash \
  --subject "<conventional commit title with PR suffix>" \
  --body "<cleaned commit body>"
```

If the body is empty, pass an empty body intentionally:

```bash
gh pr merge <number> \
  --repo <owner/repo> \
  --squash \
  --subject "<conventional commit title with PR suffix>" \
  --body ""
```

Do not use `--delete-branch` unless the user asks for branch cleanup.

## Verification

After merging, verify with:

```bash
gh pr view <number> --repo <owner/repo> --json state,mergedAt,mergeCommit,url
```

The final response must include:

- whether the PR merged successfully
- the PR URL
- the final squash commit title
- whether the source branch was rebased and whether `--force-with-lease` was used
- whether the body was empty or cleaned
- any warnings, such as pending checks that the user explicitly chose to override
