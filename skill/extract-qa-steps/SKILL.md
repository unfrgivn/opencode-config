---
name: extract-qa-steps
description: "Internal helper — called by other skills. Extract QA steps from a Jira ticket description. Returns the QA steps text or empty if none found."
---

# Extract QA Steps

Parse a Jira ticket's description and return the QA steps section.

## Inputs

- Ticket description text from Jira. Required. Markdown, ADF-rendered markdown, or readable plain text are all acceptable.

## Steps

1. Look for a section headed **QA Steps** (also matches `QA Steps:`, `### QA Steps`, `## QA Steps`, `**QA Steps**`).
2. If found, extract the text from that heading to the next heading or end of description.
3. Strip excess whitespace and Jira/Confluence-specific markup where practical.
4. If no QA Steps section is found, return an empty string.

## Output

The QA steps text (cleaned up), or empty string.
