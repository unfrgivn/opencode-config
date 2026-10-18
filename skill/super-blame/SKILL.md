---
name: super-blame
description: >-
  Context-aware code blame that combines git blame, PR history, Jira tickets,
  and commit context into a unified narrative explaining why code exists and who
  was involved. Use this skill whenever a user asks "why does this code exist",
  "who wrote this and why", "what's the history behind this file/function/line",
  "blame this code", "give me context on this change", wants to understand the
  story behind a code region, or asks about the provenance of specific lines —
  even if they don't explicitly say "blame." Also use when investigating
  regressions, understanding legacy code decisions, or onboarding onto unfamiliar
  code areas.
---

# Super Blame

Turn `git blame` from a list of commit hashes into a rich narrative that explains
**why** code exists, **who** was involved, and **what decisions** shaped it.

> **Core insight:** `git blame` tells you *who* and *when*. The real question is
> always *why*. This skill stitches together git history, pull request
> discussions, and issue tracker context to answer that question.

## When to use this skill

- "Why does this code exist?"
- "Who wrote this and what was the context?"
- "What's the history behind this function/file/block?"
- "Blame these lines for me"
- "Help me understand this legacy code"
- "What PR introduced this change?"
- "What Jira ticket is this related to?"
- Investigating a regression: "when did this behavior change and why?"
- Onboarding onto unfamiliar code

Do **not** use this skill for general code review, refactoring suggestions, or
performance analysis — those are separate concerns. This skill is specifically
about understanding the provenance and rationale behind existing code.

## Inputs to support

Accept blame targets in any of these forms:

- **File + line range:** `src/auth/login.ts:42-58` or `src/auth/login.ts L42-L58`
- **File + function name:** `src/auth/login.ts::handleLogin`
- **Whole file:** `src/auth/login.ts`
- **Natural language:** "the retry logic in the API client"

If the target is ambiguous, ask one short clarifying question. If the user
provides a function name, use grep/search to locate it before proceeding.

Optionally, the user may also provide:
- A Jira project prefix (e.g., `PROJ`) to help match ticket references
- A specific depth of history to explore (default: follow the meaningful trail)

## Preflight

Before doing any analysis:

1. Confirm you are inside a git repository.
2. Confirm `gh` CLI access works (`gh auth status`).
3. Check if `acli` is available for Jira access (`which acli`). If not available,
   skip the Jira enrichment step and note it in the output.
4. Stay **read-only** throughout. Never modify files, commits, or remote state.

## Core workflow

### Phase 1: Git blame and commit discovery

#### Step 1a: Check for renames

Before running blame, check whether the file has been renamed or moved during
its history. This is important because many codebases reorganize files over time,
and `git blame` alone won't show you the full story across renames.

```bash
git log --follow --diff-filter=R --summary -- <file>
```

If this shows rename events, note them — they're part of the story. The original
path and the rename commit often explain architectural decisions (e.g., moving a
file from `sources/` to `dags/` signals a responsibility shift).

#### Step 1b: Run blame with rename detection

```bash
git blame -l --line-porcelain -C -C <file> -L <start>,<end>
```

The `-C -C` flags enable copy/rename detection, so blame can attribute lines to
their true origin even if the file was moved. This is essential for files that
have been reorganized.

#### Step 1c: Trace full history through renames

Always use `--follow` when getting the file's commit history to capture the
complete evolution, including pre-rename commits:

```bash
git log --follow --format='%H %ai %an <%ae> %s' -- <file>
```

For whole-file or deep-investigation blames, this is the primary history source.
Without `--follow`, you'll miss the origin story of files that were moved.

#### Step 1d: Gather commit details and trace the causal chain

Deduplicate the commit SHAs from blame output. For each unique commit, gather:

```bash
git log -1 --format='%H%n%an <%ae>%n%ai%n%s%n%n%b' <sha>
```

If a line range spans many commits, focus on the **most significant** ones —
prioritize commits that changed the logic (not whitespace/formatting commits).

**Critical — follow the causal chain:** The blame output only shows the *last*
commit to touch each line. But the real story often spans multiple commits that
built on, fixed, or replaced each other. After gathering the immediate blame
commits:

1. Read the commit messages and PR bodies for references to **earlier behavior
   being changed** (e.g., "remove the guard," "fix the previous approach,"
   "revert," "replace the old logic"). These indicate predecessor commits.
2. Use `git log --follow --all -- <file>` filtered to the relevant line range's
   function or code block to find **earlier commits that touched the same
   region** — especially ones that the blamed commit modified or removed.
3. For each significant predecessor commit found, gather its details too and
   include it in the timeline.

The goal is to reconstruct the **full evolution**: who introduced the feature,
who modified it, who fixed it, and why each step happened. A blame report that
only shows the final commit misses the story. For example, if a bugfix removed
an earlier guard, the report should trace back to why that guard was added and
what introduced it in the first place — creating a narrative like
"feature introduced → interim fix applied → root cause discovered → proper fix
landed."

#### Step 1e: Extract cross-references

Look for patterns in commit messages:
   - Jira ticket references: `PROJ-1234`, `[PROJ-1234]`, `fixes PROJ-1234`
   - PR references: `(#123)`, `Merge pull request #123`
   - Bitbucket-style PR references: `(pull request #123)`, `Merged in feature/branch`
   - Co-authors, signed-off-by lines
   - Revert indicators

Also note if the repo was migrated between hosting platforms (e.g., Bitbucket to
GitHub). Older commits may reference PR numbers from the previous platform — note
these as "Bitbucket PR #X (not available on GitHub)" rather than silently dropping
them.

### Phase 2: PR enrichment

For each significant commit, trace it to a pull request:

```bash
gh pr list --search "<sha>" --state merged --json number,title,author,url,body,mergedAt --limit 1
```

If that returns nothing, try the commit association endpoint:

```bash
gh api repos/{owner}/{repo}/commits/<sha>/pulls --jq '.[0] | {number, title, user: .user.login, html_url, body}'
```

For each PR found, fetch the review discussion to capture the "why" behind
decisions:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      body
      author { login }
      mergedAt
      reviews(first: 20) {
        nodes {
          author { login }
          state
          body
        }
      }
      reviewThreads(first: 50) {
        nodes {
          isResolved
          comments(first: 10) {
            nodes {
              author { login }
              body
              path
              line
            }
          }
        }
      }
      comments(first: 20) {
        nodes {
          author { login }
          body
          createdAt
        }
      }
    }
  }
}' -f owner="<owner>" -f repo="<repo>" -F number=<number>
```

Extract the most relevant discussion — especially comments that explain design
decisions, tradeoffs, or alternatives considered. Filter out CI bot noise and
resolved nitpicks (they're not relevant to understanding *why*).

### Phase 3: Jira enrichment

For each Jira ticket reference found in commit messages or PR bodies:

```bash
acli jira workitem view "<TICKET-ID>"
```

Extract:
- Summary and description (the "what was requested")
- Status and resolution
- Acceptance criteria (if present)
- Linked issues (parent epics, related bugs, blockers)
- Key comments that explain requirements or constraints

If `acli` is not available, note the ticket references and suggest the user look
them up manually. Do not fail the entire analysis over missing Jira access.

### Phase 4: Synthesis

Combine all gathered context into a coherent narrative. The goal is to answer:

1. **What** does this code do? (brief — the user can read the code)
2. **Why** does it exist? (the real value — business context, bug fix, feature request)
3. **Who** was involved? (author, reviewers, stakeholders from tickets)
4. **When** did it evolve? (timeline of significant changes)
5. **What tradeoffs** were made? (from PR discussions, review threads)
6. **What's upstream?** (linked tickets, epics, broader initiatives)

## Depth control

Not every blame needs the full treatment. Calibrate depth to what the user is asking:

- **Quick blame** ("who wrote this line?"): Phase 1 only, give commit + author + date + message
- **Standard blame** ("why does this code exist?"): Phases 1-3, full narrative
- **Deep investigation** ("help me understand all the decisions behind this module"): Phases 1-3 + follow linked PRs, parent tickets, and historical refactors

Default to **standard** unless the user signals otherwise.

## Report format

Use this structure:

```markdown
# Super Blame: <file>:<line-range>

## Summary

<1-3 sentence high-level answer to "why does this code exist?">

## File History Note

<If the file was renamed/moved, note it here with the original path and when it
was moved. If the repo was migrated from another platform, note that too.
Omit this section if neither applies.>

## Jira link handling

Derive the Jira base URL from existing ticket links in PR bodies or commits, the `acli` site configuration, or the repository's `AGENTS.md`. When the site is known, link tickets as `https://<your-site>.atlassian.net/browse/<TICKET-ID>`. When it is unknown, render the bare ticket key without a link.

## Timeline

| Date | Author | Change | PR | Ticket |
|------|--------|--------|----|--------|
| <date> | @<author> | <brief description> | [#<num>](<url>) | <TICKET-ID> |

## Key Commits

### <commit-sha-short> — <commit subject>

**Author:** @<author> | **Date:** <date>
**PR:** [#<number>](<url>) — <PR title>
**Ticket:** <TICKET-ID> — <ticket summary>

**Why this change was made:**
<Narrative synthesized from PR body, review discussion, and ticket context>

**Key decisions from review:**
- <notable discussion point or tradeoff>

---

## Context & Decisions

<Synthesized narrative tying together the timeline, explaining the evolution
of this code and the business/technical reasoning behind it>

## Upstream References

- **Jira:** <linked ticket keys with summaries, using links only when the Jira site is known>
- **PRs:** <linked PRs with titles>
- **Related code:** <other files/functions changed in the same PRs, if relevant>
```

For **quick blame**, use a condensed format:

```markdown
## Blame: <file>:<line-range>

| Line(s) | Author | Date | Commit | Message |
|---------|--------|------|--------|---------|
| <range> | @<author> | <date> | <sha-short> | <subject> |
```

## Handling renames, moves, and repo migrations

Files often get renamed or moved as codebases evolve. These transitions are part
of the story and should be surfaced in the report:

- **File renames/moves:** Always detected in Phase 1a. Include the rename in the
  Timeline table as a notable event. Explain *why* the file was moved if the
  commit message or PR provides context (e.g., "moved from sources/ to dags/ to
  align with Airflow DAG ownership").
- **Repo migrations** (e.g., Bitbucket → GitHub): Older commits may reference
  PR numbers or merge descriptions from a previous hosting platform. When GitHub
  PR lookups return nothing for older commits but the commit message references
  a PR number (e.g., "pull request #742"), note it as a pre-migration reference.
  Don't silently drop it — the PR number is still useful context.
- **Squashed merges:** When a commit looks like a squash merge (single commit
  with a PR reference), the individual commits within the PR are lost. Note this
  and use the PR body as the primary context source.

## Error handling

- If `git blame` fails (file not in repo, invalid range): report clearly and stop.
- If `gh` is not authenticated: report and skip PR enrichment, continue with git-only context.
- If `acli` is not available: report and skip Jira enrichment, continue with git + PR context.
- If a commit has no associated PR (direct push to main): note this and use the commit message as the primary context source.
- If the file has been renamed: use `git log --follow` and `git blame -C -C` to trace history through renames.

## Guardrails

- Stay **read-only**. Never modify files, branches, or remote state.
- Never fabricate commit history, PR discussions, or ticket content.
- Quote original sources (commit messages, PR comments, ticket descriptions) so the user can verify.
- If context is thin (no PR, no ticket, terse commit message), say so honestly rather than speculating.
- Respect that some commits may be from private forks or squashed merges where PR history is harder to trace — note when this is the case.
- When Jira tickets contain sensitive business context, present it factually without editorializing.

## Performance considerations

For files with very long blame histories (hundreds of commits), focus on:
1. The most recent significant changes (last 5-10 meaningful commits)
2. The original introduction of the code block
3. Any commits flagged as fixes or reverts

Avoid fetching PR details for every single commit in a long history — prioritize
the ones most likely to contain useful context (non-trivial changes, commits with
ticket references, merge commits).
