---
name: transition-jira-ticket
description: "Internal helper — called by other skills. Transition a Jira ticket to a new status (e.g. In Progress, In Review, Ready for Release)."
---

# Transition Jira Ticket

Move a Jira ticket to a new workflow status.

## Inputs

- Ticket key (e.g. `PROJ-123`). Required.
- Target status name (e.g. `In Progress`, `In Review`). Required.

## Steps

1. Use the Jira runtime available in the current session. Prefer Atlassian MCP if
   `atlassian_getTransitionsForJiraIssue` and `atlassian_transitionJiraIssue`
   are registered; otherwise use `acli`.
2. MCP path: get available transitions using `atlassian_getTransitionsForJiraIssue`:
   - Cloud ID: use the value from the project's `AGENTS.md` → Atlassian Defaults (or ask the user if not available)
   - Issue ID or key: the provided ticket key
3. MCP path: find the transition whose `to.name` matches the target status.
4. MCP path: if no matching transition exists, report the available transitions and stop.
5. MCP path: execute the transition using `atlassian_transitionJiraIssue`:
   - Cloud ID: same as step 1
   - Issue ID or key: the provided ticket key
   - Transition ID: the matched transition's ID
6. `acli` path: first check auth with `acli jira auth status`, then run:
   ```bash
   acli jira workitem transition --key "<TICKET_KEY>" --status "<TARGET_STATUS>" --json --yes
   ```
   If the transition fails, report the error and do not guess a different status.

## Output

Confirmation that the ticket was transitioned, or an error with available transitions.
