---
description: Enable continuous orchestration loop for current session
---
Enable continuous orchestration mode for the current session.

Instructions:
1. Call `fellowship_orchestration` with `action="continue"`.
2. Confirm loop mode is enabled.
3. Use `/tasks` when you need task counts, shared capacity, provider cooldowns, aliases, and tmux runtime state.
4. Continue execution autonomously until completion or `/stop`.
