---
name: summarize-ticket
description: "Internal helper — called by other skills. Produce a concise implementation-ready summary of a Jira ticket including ACs, implementation details, and QA steps."
---

# Summarize Ticket

Given a fetched Jira ticket, produce a structured summary for implementation.

## Inputs

- Ticket key. Required.
- Ticket fields from the fetched Jira issue, including summary, description, status, priority, and components. Required.

## Steps

1. Extract the **summary** and **status**.
2. Load the `extract-acceptance-criteria` skill and include the description in the instruction.
3. Load the `extract-qa-steps` skill and include the description in the instruction.
4. Extract any **Implementation Details** section from the description.

## Output

A structured summary:

```
## <TICKET_KEY>: <summary>
**Status:** <status> | **Priority:** <priority>

### Acceptance Criteria
1. ...

### Implementation Details
...

### QA Steps
...
```
