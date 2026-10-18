---
name: close-released-tickets
description: Transition all of the current user's "Ready for Release" sprint tickets to "Done". Use when the user wants to close out their released tickets after a deployment.
---

# Close Released Tickets

Move all of your "Ready for Release" tickets to "Done".

Chains: resolve-project-key → fetch tickets → confirm → (per ticket) transition-jira-ticket.

## Inputs

- Jira project key (e.g. `PROJ`). Optional, defaults through `resolve-project-key`.

## Workflow

### 1. Resolve project key
Load the `resolve-project-key` skill and include any project key the user already provided in the instruction. It should resolve from explicit context, repo context, or branch name, and ask the user with the `question` tool if no project key can be resolved.

### 2. Fetch your Ready for Release tickets

Use the Jira runtime available in the current session. Prefer Atlassian MCP if
`atlassian_searchJiraIssuesUsingJql` is registered; otherwise use `acli`.

JQL:

```jql
project = <PROJECT_KEY> AND assignee = currentUser() AND sprint in openSprints() AND status = "Ready for Release" ORDER BY created ASC
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

If no tickets are found, report that and stop.

### 3. Confirm with the user

Display the tickets:
```
These tickets will be moved to Done:

1. PROJ-18602  Follow up: Errors being hidden
2. PROJ-18559  Do not raise error when budgets are close enough
```

Ask: **Move all to Done? (y/n)**

Wait for confirmation before proceeding.

### 4. Transition each ticket to Done

For each ticket, load the `transition-jira-ticket` skill and include the ticket key and target status `Done` in the instruction.

If a transition fails for a ticket, report the error and continue with the remaining tickets.

### 5. Report results

```
Moved to Done:
  ✓ PROJ-18602  Follow up: Errors being hidden
  ✓ PROJ-18559  Do not raise error when budgets are close enough
  ✗ PROJ-18499  (failed: no "Done" transition available)
```
