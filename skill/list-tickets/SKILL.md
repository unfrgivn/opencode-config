---
name: list-tickets
description: List Jira sprint backlog tickets and let the user select one. Returns the selected ticket key.
---

# List Tickets

Display backlog tickets from the active sprint and let the user pick one.

## Inputs

- Jira project key (e.g. `PROJ`). Optional, defaults through `resolve-project-key`.
- Assignee username or `currentUser()`. Defaults to `currentUser()`.

## Workflow

### 1. Resolve project key
Load the `resolve-project-key` skill and include any project key the user already provided in the instruction. It should resolve from explicit context, repo context, or branch name, and ask the user with the `question` tool if no project key can be resolved.

### 2. Fetch backlog tickets

Use the Jira runtime available in the current session. Prefer Atlassian MCP if
`atlassian_searchJiraIssuesUsingJql` is registered; otherwise use `acli`.

JQL:

```jql
project = <PROJECT_KEY> AND assignee = <ASSIGNEE> AND sprint in openSprints() AND status = "Backlog" ORDER BY created ASC
```

MCP path, search via `atlassian_searchJiraIssuesUsingJql`:
- Cloud ID: use the value from `AGENTS.md` → Atlassian Defaults (or ask the user)
- JQL: use the query above
- Fields: `summary`, `status`, `priority`
- Max results: `50`
- Response content format: `markdown`

`acli` path:

```bash
acli jira auth status
acli jira workitem search --jql '<JQL>' --fields "key,summary,status,priority" --limit 50 --json
```

### 3. Display a numbered list
One per line:
```
1. PROJ-101 [High]    Add campaign budget floor
2. PROJ-102 [Medium]  Fix ROAS rounding error
3. PROJ-103 [Low]     Refactor optimizer factory
```
Include ticket key, priority in brackets, and summary.

### 4. Ask the user to select
Let the user pick by number or type a ticket key directly.

## Output

The selected ticket key, e.g. `PROJ-123`.
