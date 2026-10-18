---
name: github-review-analyzer
description: >-
  Triage GitHub pull request review comments into real blockers, worthwhile follow-ups,
  and safe-to-ignore noise using PR URLs, PR numbers, or owner/repo#123 references.
  Use this whenever a user wants to understand which review comments actually matter,
  what to fix first on a PR, which feedback is stale or non-blocking, or how to draft
  calm replies to review threads, even if they do not explicitly ask for "review triage."
---

# GitHub PR Review Analysis

Use this skill to turn noisy GitHub PR review feedback into a clear action plan.

> **Core insight:** GitHub review queues contain a mix of real blockers, stale noise, personal preference, and already-resolved discussion. The job is not to summarize everything. The job is to surface the comments that still deserve action.

## Goal

Fetch all relevant review feedback from a PR, filter out resolved or stale noise, and categorize the remaining comments into:

- Must Do
- Consider
- Safely Ignore

The value of this skill is judgment, not just retrieval. The user should come away knowing what is actually blocking, what is worth considering, and what can be skipped.

## When to use this skill

Use this skill when the user wants to:

- triage GitHub PR review comments
- decide which comments are actually blocking
- understand whether review feedback is stale, resolved, or still relevant
- convert review noise into a prioritized fix list
- draft short, respectful replies to review threads

Do not use this skill for general code review of a branch with no PR review feedback yet. This skill is specifically for analyzing existing GitHub review comments and threads.

## Inputs to support

Accept PR references in any of these forms:

- `owner/repo#123`
- `https://github.com/owner/repo/pull/123`
- `#123` when already inside the repo

If the reference is ambiguous, resolve it before continuing.

If the user does not provide a PR reference but the current repo context strongly suggests one, ask one short clarifying question instead of guessing.

## Preflight

Before doing any analysis:

1. Confirm you can identify `owner`, `repo`, and PR `number`.
2. Confirm `gh` access works.
3. Stay read-only throughout.

Use `gh` for GitHub access. If authentication or repo access fails, stop and report the problem clearly.

## Tooling guidance

- Use `gh` via the shell for GitHub data retrieval.
- Stay read-only.
- When inspecting local code, prefer dedicated file tools for reading and searching rather than shell text-processing commands.
- Read the narrowest relevant diff or file context before judging a comment.

## Core workflow

1. Parse the PR reference.
2. Fetch PR metadata for title, status, author, base branch, and head branch.
3. Fetch review threads and top-level reviews with `gh` so you can reliably inspect:
   - `isResolved`
   - `isOutdated`
   - review `state`
4. Filter out noise:
   - resolved threads
   - outdated threads
   - CI/tooling bot comments (but keep AI reviewer bot comments — see filtering rules)
   - pure praise with no action requested
5. Read the full surviving thread context before judging any comment.
6. Inspect the relevant code or diff when a comment references a file or line.
7. Judge whether the concern still applies to the current PR state.
8. Categorize each remaining comment into exactly one tier.
9. Produce the final report in the required format.

## Retrieval workflow

Prefer GraphQL for thread-aware review analysis because thread resolution and outdated state are necessary for correct triage.

### 1. Confirm access

```bash
gh auth status
```

### 2. Fetch PR metadata

```bash
gh pr view <number> --repo <owner/repo> --json title,body,state,baseRefName,headRefName,author,mergeable
```

### 3. Fetch reviews and review threads

Use GraphQL, not the REST API, because thread resolution and outdated state are critical to correct triage.

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      state
      reviews(first: 100) {
        nodes {
          author { login }
          state
          body
          createdAt
          url
        }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          comments(first: 50) {
            nodes {
              author { login }
              body
              path
              line
              createdAt
              url
            }
          }
        }
      }
    }
  }
}' -f owner="<owner>" -f repo="<repo>" -F number=<number>
```

If there are more than 100 reviews or threads, paginate with `endCursor` and `hasNextPage` until all data is collected.

If you need changed-file context, fetch file metadata too:

```bash
gh pr view <number> --repo <owner/repo> --json files
```

Do not stop at top-level review summaries. A correct analysis requires thread-level context.

## Filtering rules

Exclude comments or threads that should not be actioned:

- Threads with `isResolved: true`
- Threads with `isOutdated: true`
- CI/tooling bot authors (filter these out entirely):
  - `github-actions[bot]`
  - `codecov[bot]`
  - `dependabot[bot]`
  - `sonarcloud[bot]`
  - `renovate[bot]`
  - any `[bot]` login that only posts CI status, coverage, or dependency updates
- Comments that are only praise or acknowledgment, such as:
  - `LGTM`
  - `Looks good!`
  - `Nice work`

**Do not filter out AI reviewer bots.** The following are AI-powered code reviewers whose comments should be analyzed by technical merit like any other reviewer:

- `copilot-pull-request-reviewer[bot]` (GitHub Copilot)
- `coderabbitai[bot]` (CodeRabbit)
- `sourcery-ai[bot]` (Sourcery)
- `ellipsis-dev[bot]` (Ellipsis)
- Any `[bot]` login that posts line-level code review comments with technical substance

When you encounter an unfamiliar `[bot]` author, inspect the comment content before deciding:

- If the comment is a CI status check, coverage report, or dependency alert → filter it out.
- If the comment is a line-level code review with technical feedback (bug, suggestion, question) → keep it and analyze it normally.

When in doubt about a bot author, keep the comment and analyze it. It is better to include a low-value AI comment in `Safely Ignore` with an explanation than to silently discard a valid finding.

Also treat a thread as effectively resolved if the back-and-forth clearly shows the concern was addressed, even if GitHub still shows it as unresolved.

Be conservative with this rule. Only mark an unresolved thread as effectively resolved when the thread itself contains strong evidence that the concern was handled.

## How to analyze surviving comments

For each remaining item, evaluate:

- Who left it
- Whether it came from a `CHANGES_REQUESTED`, `COMMENTED`, or `APPROVED` review
- Whether it is a bug, concern, question, suggestion, nit, or preference
- Whether the comment is technically valid
- Whether there is a concrete action the PR author can take
- Whether the impact is correctness, security, performance, maintainability, readability, or style only

Also evaluate:

- Whether the reviewer is reacting to old code that has already changed
- Whether the suggestion conflicts with visible project conventions
- Whether the thread contains clarification that narrows or softens the original ask
- Whether the user asked for triage only, or also wants suggested reply language

### Severity guidance

- Comments inside a `CHANGES_REQUESTED` review deserve more weight because the reviewer explicitly signaled blocking intent.
- Comments inside an `APPROVED` review are often non-blocking unless they identify a real correctness or safety issue.
- If a suggestion is weak, subjective, or based on a misunderstanding, do not inflate it.
- A technically valid comment can still belong in `Consider` if the impact is low.
- A reviewer's blocking intent matters, but technical merit matters more.

## Code inspection guidance

When a comment references a file or line, inspect the current diff or local code before judging it.

Prefer the narrowest useful context:

```bash
gh pr diff <number> --repo <owner/repo>
```

Then inspect the referenced file or surrounding code in the local repo when available.

Only use broader PR context when the comment depends on cross-file behavior.

Use local file reads or search when helpful, but remember the PR diff is often the most reliable source for what the reviewer actually commented on.

If you cannot inspect the relevant code, say so and lower confidence rather than pretending certainty.

## Categorization rules

Place every analyzed comment into exactly one category.

### Must Do

Use only for genuinely blocking issues, such as:

- bugs
- correctness problems
- security vulnerabilities
- data loss risks
- explicit request-changes items with strong technical basis

Keep this category strict. If ignoring the comment would not cause real harm, it probably does not belong here.

Use `Must Do` only when you can explain the concrete downside of not fixing it.

### Consider

Use for non-blocking but worthwhile feedback, such as:

- valid improvement ideas
- low-impact bugs
- readability improvements
- convention-backed consistency fixes
- reasonable questions that need answers

When unsure, prefer `Consider` over `Safely Ignore`.

### Safely Ignore

Use for comments that are not worth actioning, such as:

- pure nitpicks without substance
- subjective preferences with no project convention behind them
- incorrect suggestions
- comments based on misunderstanding
- redundant feedback already covered elsewhere

If multiple comments raise the same issue, keep the strongest representative item and note duplicates briefly instead of repeating the same concern many times.

## Confidence and disagreement handling

When the evidence is mixed:

- Say what is clear
- Say what is uncertain
- Prefer `Consider` over `Must Do`
- Explain the missing evidence that would change the call

If reviewer intent and technical merit diverge, optimize for technical merit while acknowledging reviewer intent.

Examples:

- `CHANGES_REQUESTED` + weak stylistic preference -> usually `Consider` or `Safely Ignore`
- `APPROVED` + real correctness issue -> can still be `Must Do`

## Optional reply help

If the user wants help replying to review comments, add a short follow-up section after the triage report:

```markdown
## Suggested Replies

- **@reviewer**: <brief respectful reply>
```

Keep replies factual, calm, and specific. Do not be defensive.

## Report format

Use this exact structure:

```markdown
# PR Review Analysis: <PR title> (#<number>)

**PR:** <owner/repo>#<number>
**Status:** <open/merged/closed>
**Author:** @<author>
**Base:** <base> <- <head>

**Filtered out:** X resolved threads · Y outdated threads · Z CI/tooling bot comments
**AI reviewers included:** <list logins, or "none">
**Analyzed:** N comments across M threads
**Confidence:** <high/medium/low>

---

## Must Do (N)

> Blocking issues that should be addressed before merge

### 1. [<file>:<line>] <Brief summary>

**Reviewer:** @<login>
**Type:** <bug/security/correctness/data-loss>

> <Original comment text, quoted>

**Why this matters:** <1-2 sentence explanation of the real impact>
**Suggested action:** <What specifically to do>

---

## Consider (N)

> Non-blocking but worth reviewing — good suggestions that improve quality

### 1. [<file>:<line>] <Brief summary>

**Reviewer:** @<login>
**Type:** <improvement/style/readability/question>

> <Original comment text, quoted>

**Why:** <Brief rationale for why it's worth considering>

---

## Safely Ignore (N)

> Nitpicks, incorrect suggestions, or subjective preferences

### 1. [<file>:<line>] <Brief summary>

**Reviewer:** @<login>

> <Original comment text, quoted>

**Why safe to skip:** <Brief reason>

---

_Analysis complete. Comments are categorized by impact — verify "Must Do" items first._
```

If a tier has no items, still include the header and write:

```markdown
No items in this category.
```

If no comments survive filtering, use:

```markdown
# PR Review Analysis: <PR title> (#<number>)

**PR:** <owner/repo>#<number>
**Status:** <open/merged/closed>

**Filtered out:** X resolved · Y outdated · Z CI/tooling bot comments

## All Clear

No actionable unresolved comments remain on this PR. All review threads are either resolved, outdated, or addressed in conversation.
```

## Error handling

- If `gh` is not authenticated, report: `Error: gh CLI is not authenticated. Run gh auth login to authenticate.`
- If the PR cannot be accessed, report: `Error: Could not access PR <reference>. Verify the PR exists and you have access.`
- If the PR has no review comments at all, report: `This PR has no review comments.`
- If the PR reference is ambiguous, ask one concise clarifying question before doing more work.
- Handle GraphQL pagination silently and continue until all relevant data is gathered.

## Guardrails

- Stay read-only.
- Never push code.
- Never approve or dismiss reviews.
- Never resolve conversations.
- Never fabricate comments or thread state.
- Always quote the original comment text so the user can verify your judgment.
- Do not overuse `Must Do`.
- Do not confuse reviewer preference with project requirement unless you have evidence of a convention.
- Do not claim a comment is stale or resolved without evidence from thread state, thread content, or current code.

The user is relying on triage quality. Be skeptical of weak feedback, but cautious about missing real blockers.
