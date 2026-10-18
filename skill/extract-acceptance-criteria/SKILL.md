---
name: extract-acceptance-criteria
description: "Internal helper — called by other skills. Extract and normalize acceptance criteria from a Jira ticket description into a flat numbered list of testable statements."
---

# Extract Acceptance Criteria

Parse a Jira ticket's description and return a structured list of acceptance criteria.

## Inputs

- Ticket description text from Jira. Required. Markdown, ADF-rendered markdown, or readable plain text are all acceptable.

## Steps

1. Search the description for acceptance criteria. They commonly appear under:
   - "Acceptance Criteria", "AC", "ACs"
   - Checkbox lists (`- [ ]` or `* [ ]`)
   - Numbered requirement lists
   - Table cells labelled "Acceptance Criteria"
2. Normalize into a flat, numbered list of atomic criteria — one testable statement per item.
3. Light normalization is allowed (fix formatting, split compound statements) but do not invent or rewrite criteria.
4. If the ticket has no clear acceptance criteria, quote the most relevant description text, note that ACs are ambiguous or missing, and stop.

## Output

A numbered list of acceptance criteria, e.g.:

```
1. The system must do X when Y happens.
2. Error Z is handled gracefully with a user-facing message.
```

Or a note that ACs are ambiguous/missing, with the relevant quoted text.
