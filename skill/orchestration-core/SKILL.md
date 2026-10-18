---
name: orchestration-core
description: Continuous loop orchestration, delegation visibility, and diagnostics workflow
---

# Orchestration Core

Use this workflow for deep autonomous execution with strong operator control.

## Control Commands

- `/continue` enables continuous loop mode
- `/stop` halts running/queued work
- `/tasks` lists active/recent delegated tasks
- `/task <id>` inspects one task
- `/diagnostics` validates full orchestration setup

## Delegation Pattern

1. Delegate atomic tasks with explicit success criteria.
2. Track task state transitions and surface concise activity updates.
3. Retry failures with bounded backoff.
4. Keep final output deterministic and verifiable.

## Verification Pattern

- Run `/diagnostics` after configuration changes.
- Ensure provider mode and command wiring pass.
- Confirm loop control and task visibility are operational.
