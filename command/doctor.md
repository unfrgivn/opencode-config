---
description: Run deep Fellowship config, asset, and orchestration doctor checks
---
Run a deep health check for Fellowship config files, package/schema assets, status files, command/plugin assets, orchestration wiring, and runtime state.

Instructions:
1. Call `fellowship_orchestration` with `action="diagnostics"`.
2. Present all reported PASS/WARN/FAIL checks and remediation steps.
3. If any check fails or warns, call out each fix in a short numbered list.
