# Orchestration Feature Milestones

This tracks the incremental rollout of orchestration runtime improvements inspired by `oh-my-opencode`.

## Milestones

1. [x] Enhanced doctor diagnostics and remediation output
2. [x] Runtime fallback policy and visibility
3. [x] Background delegation limits and stale-timeout health checks
4. [x] Persistent task graph (cross-session records)
5. [x] Hook toggles and lightweight observability
6. [x] Task completion/failure notification stream
7. [x] Tmux task pane lifecycle (attach/cleanup)
8. [x] Deferred tmux attachment queue + reconciliation checks
9. [x] Tmux diagnostics and task visibility integration

## Scope Note

Dynamic context pruning is intentionally excluded because we already install `@tarquinen/opencode-dcp@latest` as a runtime plugin.
