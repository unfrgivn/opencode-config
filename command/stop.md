---
description: Stop continuous loop and active tracked orchestration work
---
Stop autonomous orchestration for the current session.

Instructions:
1. Call `fellowship_orchestration` with `action="stop"`.
2. Confirm the loop is disabled, active tracked orchestration tasks are marked stopped, and tmux panes are cleaned up.
3. Await explicit user instruction before continuing.
