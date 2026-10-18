---
name: start-ticket
description: Pick up a Jira ticket, set up the workspace, implement the work, and deliver a PR. Chains resolve-project-key → fetch ticket → transition → branch → summarize-ticket → implement → wrapup → commit → PR → transition to In Review.
---

# Start Ticket

Pick up a ticket, prepare the workspace, implement the work, and deliver a pull request.

## Inputs

- Jira project key (e.g. `PROJ`). Optional, defaults through `resolve-project-key`.
- Ticket key (e.g. `PROJ-123`). Optional.

## Workflow

### 1. Resolve project key

Load the `resolve-project-key` skill and include any project key the user already provided in the instruction. It should resolve from explicit context, repo context, or branch name, and ask the user with the `question` tool if no project key can be resolved.

### 2. Resolve ticket key

If the user already provided a ticket key, use it directly.
Otherwise, fetch the oldest backlog ticket using the Jira runtime available in
the current session. Prefer Atlassian MCP if `atlassian_searchJiraIssuesUsingJql`
is registered; otherwise use `acli`.

JQL:

```jql
project = <PROJECT_KEY> AND assignee = currentUser() AND sprint in openSprints() AND status = "Backlog" ORDER BY created ASC
```

MCP path, search via `atlassian_searchJiraIssuesUsingJql`:

- Cloud ID: use the value from `AGENTS.md` → Atlassian Defaults (or ask the user)
- JQL: use the query above
- Fields: `summary`, `status`, `priority`
- Max results: `1`
- Response content format: `markdown`

`acli` path:

```bash
acli jira auth status
acli jira workitem search --jql '<JQL>' --fields "key,summary,status,priority" --limit 1 --json
```

Take the first result (oldest backlog ticket).

### 3. Fetch ticket details

Fetch the full ticket using the same runtime path.

MCP path, use `atlassian_getJiraIssue`:

- Cloud ID: use the value from `AGENTS.md` → Atlassian Defaults (or ask the user)
- Issue ID or key: the resolved ticket key
- Fields: `summary`, `description`, `status`, `priority`, `components`
- Response content format: `markdown`

`acli` path:

```bash
acli jira workitem view <TICKET_KEY> --fields "summary,description,status,priority,components" --json
```

### 4. Transition to In Progress

Load the `transition-jira-ticket` skill and include the ticket key and target status `In Progress` in the instruction.

### 5. Prepare main branch and create feature branch

First check for uncommitted changes:

```bash
git status --short
```

If the working tree is dirty, **stop** and ask the user:

> You have uncommitted changes. Stash them, commit them, or discard them before starting a new ticket.

Only proceed if the working tree is clean:

```bash
git checkout main
git fetch origin && git pull --rebase origin main
git checkout -b <TICKET_KEY>-<short-slug>
```

Derive a short slug from the ticket summary (e.g. `PROJ-123-fix-zero-spend`).

### 6. Summarize ticket

Load the `summarize-ticket` skill and present the implementation-ready summary.

### 7. Ask clarifying questions

If anything in the ticket is ambiguous, ask the user before writing any code.

### 8. Execute the work

Implement the ticket following all conventions in the nearest `AGENTS.md`.

### 9. Add new tests

Write tests covering the changed behaviour.

### 10. Run the `wrapup` skill (if available)

If the `wrapup` skill is available, load it to format, lint, and verify tests pass. Fix any failures before proceeding.

If the `wrapup` skill is not available, manually run the project's format, lint, and test commands as described in `AGENTS.md`.

### 11. Review implementation quality

- **Django projects only:** If a `django-efficiency-checker` skill is available, load it to review ORM usage and database access patterns. Fix any issues found.
- Load the `acceptance-criteria-checker` skill to verify the implementation satisfies the ticket's ACs. Address any gaps before proceeding.

### 12. Commit and push

```bash
git add .
git commit -m "feat(<scope>): <TICKET_KEY> <short description>"
git push -u origin HEAD
```

Use conventional commit format. Common types: `feat`, `fix`, `refactor`, `test`, `chore`.
Use a short scope that identifies the app or area (e.g. `bbo`, `reporting`).

### 13. Create a pull request

Load the `create-pr` skill and use it to create the PR. Provide the ticket key, ticket summary, and Jira link as context so the PR title and body follow ticket-driven repository conventions.

### 14. Move the ticket to In Review

Load the `transition-jira-ticket` skill and include the ticket key and target status `In Review` in the instruction.

## Output

A delivered pull request: feature branch pushed, PR created, ticket in "In Review" status.
