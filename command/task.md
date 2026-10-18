---
description: Show details for one subagent orchestration task
---
Display one task detail record for the current session by task id, background task id, or board alias.

Instructions:
1. Read the task id, background task id, or board alias from arguments.
2. Call `fellowship_orchestration` with `action="task"` and `task_id` set to that value.
3. Return the output as-is.

{{$arguments}}
