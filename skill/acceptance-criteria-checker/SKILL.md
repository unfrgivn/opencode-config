---
name: acceptance-criteria-checker
description: Check whether the current branch or working tree satisfies a Jira ticket's acceptance criteria. Use this whenever the user asks whether a ticket is done, whether a PR/branch covers the Jira ACs, whether implementation matches acceptance criteria, or wants a code-vs-ticket verification before review or QA — even if they just say "does this satisfy the ticket?".
---

# Acceptance Criteria Checker

Produce a read-only, evidence-based report showing whether the current code addresses each acceptance criterion from the Jira ticket.

Chains: resolve-ticket-key → fetch ticket → extract-acceptance-criteria → inspect-repo-change-scope → (subagent review).

## Inputs

- Ticket key (e.g. `PROJ-123`) or Jira URL. Optional; if missing, resolve from the branch or ask the user.
- Base ref for comparison. Defaults to `origin/main`.

## Workflow

### 1. Resolve ticket key
Load the `resolve-ticket-key` skill and include any ticket key or Jira URL the user already provided in the instruction.

### 2. Fetch the Jira ticket (main session)

This step runs in the main session. Prefer Atlassian MCP if
`atlassian_getJiraIssue` is registered; otherwise use `acli`.

MCP path, fetch via `atlassian_getJiraIssue`:
- Cloud ID: use the value from `AGENTS.md` → Atlassian Defaults (or ask the user)
- Issue ID or key: the resolved ticket key
- Fields: `summary`, `description`, `status`, `priority`
- Response content format: `markdown`

`acli` path:

```bash
acli jira auth status
acli jira workitem view <TICKET_KEY> --fields "summary,description,status,priority" --json
```

### 3. Extract acceptance criteria
Load the `extract-acceptance-criteria` skill and include the ticket description in the instruction.
If ACs are ambiguous or missing, stop and report.

### 4. Inspect repo change scope
Load the `inspect-repo-change-scope` skill and include the requested base ref in the instruction, or use `origin/main` when the user did not provide one.

### 5. Spawn the `general` subagent

Pass it the following prompt, filling in placeholders. Include the full extracted acceptance
criteria and ticket summary so the subagent does not need Jira access.

> ## Task
>
> Check whether the code on branch **`<BRANCH_NAME>`** (base ref: `<BASE_REF>`) satisfies the
> following acceptance criteria for **`<TICKET_KEY>`**.
> Working tree is dirty: **yes/no**.
>
> ### Ticket
> - **Summary:** <summary>
> - **Status:** <jira status>
>
> ### Acceptance criteria
> 1. <criterion 1>
> 2. <criterion 2>
> 3. ...
>
> ## Step 1 — Review the code
>
> ```bash
> git diff --no-ext-diff --stat <BASE_REF>...HEAD
> ```
>
> For each changed file, read the relevant sections. Also read related test files.
> If a criterion mentions a concept not obviously in the diff, use Grep to search the
> codebase for it — the implementation might exist outside the changed files.
>
> If the working tree is dirty, also review uncommitted changes:
> ```bash
> git diff --no-ext-diff
> ```
>
> Also check for untracked files:
> ```bash
> git ls-files --others --exclude-standard
> ```
>
> While reviewing, note any changed or untracked files that are **not related** to any
> acceptance criterion. These are "unrelated changes" — they may be incidental refactors,
> formatting fixes, new files for a different effort, or work belonging to a different ticket.
>
> ## Step 2 — Evaluate each criterion
>
> Assign exactly one status per AC:
>
> | Status | Meaning |
> |---|---|
> | Met | Code and/or tests clearly satisfy this criterion |
> | Partially met | Some evidence exists but there is a gap |
> | Not demonstrated | No supporting code or test found |
> | Unclear | The criterion itself is ambiguous — cannot evaluate |
>
> Rules:
> - Never mark `Met` without citing a specific file path, line range, or test name.
> - Never treat comments, TODOs, or variable naming alone as proof of implementation.
> - Prefer `Unclear` over overstating confidence.
> - Do not invent or rewrite acceptance criteria beyond light normalization.
>
> ## Step 3 — Produce the report
>
> ```
> # <TICKET_KEY> — Acceptance Criteria Check
>
> ## Ticket
> - **Summary:** <summary>
> - **Status:** <jira status>
> - **Branch:** <branch name>
> - **Base ref:** <BASE_REF>
>
> ## Criteria
>
> | # | Acceptance Criterion | Status | Evidence | Notes |
> |---|---|---|---|---|
> | 1 | <criterion> | Met | `path/file.py:42-57`; `tests/test_x.py::test_y` | <why> |
> | 2 | <criterion> | Partially met | `path/file.py:10` | <gap> |
> | 3 | <criterion> | Not demonstrated | — | <what is missing> |
>
> ## Unrelated changes
> List any changed or untracked files that do not map to any acceptance criterion.
> For each, give a one-line description of what changed. If there are none,
> write "None detected."
>
> | File | What changed |
> |---|---|
> | `path/to/file.py` | <brief description> |
>
> ## Gaps and risks
> - <missing implementation or test coverage>
> - <ticket ambiguity worth flagging>
>
> ## Verdict
> - **Ready for review:** yes / no / needs clarification
> - **Confidence:** high / medium / low
> ```

### 6. Present the report

Show the subagent's report to the user without modification.
