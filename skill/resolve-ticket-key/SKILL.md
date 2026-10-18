---
name: resolve-ticket-key
description: "Internal helper — called by other skills. Resolve a Jira ticket key from explicit user context, branch name, or a user prompt. Returns a single ticket key string."
---

# Resolve Ticket Key

Resolve a confirmed Jira ticket key. Skills receive context through prompt text,
so callers should state any known ticket key or Jira URL in plain language when
loading or invoking this helper.

## Steps

1. If the caller or user already provided a ticket key or Jira URL:
   - If it looks like a URL, extract the ticket key from the path (e.g. `PROJ-456` from `https://example.atlassian.net/browse/PROJ-456`).
   - Otherwise normalize and use the ticket key directly.
2. If no ticket key is provided, extract a ticket key from the current branch name:
   ```bash
   git branch --show-current
   ```
   Look for a pattern like `PROJ-12345` (uppercase letters followed by a hyphen and digits) in the branch name.
3. If still unresolved, ask the user for the ticket key and wait.

## Output

A single ticket key string, e.g. `PROJ-456`.
