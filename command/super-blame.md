---
description: Context-aware blame — combines git blame, PR history, and Jira context to explain why code exists
---

Use the `@skill/super-blame/SKILL.md` skill to analyze the blame target: {{$arguments}}

The target can be a file path with line range (e.g., `src/auth/login.ts:42-58`),
a file with function name (e.g., `src/auth/login.ts::handleLogin`), or a natural
language description (e.g., "the retry logic in the API client").

Follow the skill exactly, stay read-only, and run the full super-blame workflow.
