# Fellowship Orchestration Runtime

Use the fellowship orchestration control surface for long-running and delegated work.

## Core Controls

- `/continue` enables continuous loop mode for the session.
- `/stop` marks active work in the current parent session stopped, then waits for further instruction.
- `/tasks` shows active/recent subagent tasks.
- `/task <id>` shows one task record.
- `/diagnostics` runs full orchestration diagnostics.

## Delegation Discipline

When using delegated execution:

1. Provide a short, specific task title.
2. Include expected outcome and verification criteria.
3. Start with at most one child. Add parallel children only for independent work when active capacity remains.
4. Keep updates concise and state-driven: started, completed, failed, interrupted, stopped.
5. Monitor active and recent task health during long-running work.
6. Cancel disposable background work once its value is exhausted.

Raw task calls are admitted before launch under a local filesystem lock. Defaults are 3 active tasks per session and 5 active tasks globally across local OpenCode processes. Optional `limits.providerMaxConcurrent.copilot` and `.native` values can lower provider-specific capacity. Rejections are final for that call and create no queued task record.

Foreground capacity is released on terminal task tool updates. Background launches retain capacity until a matching synthetic child result or child session error arrives. Idle signals are observational and do not release capacity; duplicate terminal signals are ignored.

## Provider Routing

- Default provider mode is `copilot`.
- 408, 429, 503, and 504 failures configured in `runtimeFallback.retryOnErrors` reduce shared provider capacity and establish the configured cooldown. Successful completions recover capacity additively.
- If service quality or budget requires it, switch to `native` in `fellowship.json`:

```json
{
  "orchestration": {
    "providerMode": "native",
    "categories": {
      "routing": {
        "quick": "native"
      },
      "maxConcurrent": {
        "quick": 1
      }
    }
  }
}
```

## Recovery

- Startup recovery is enabled by default (`orchestration.recovery.autoResumeOnStart = true`).
- Running task records owned by a live process remain active across plugin instances.
- Abandoned running records and legacy queued/retrying records become terminal `interrupted` records. The plugin cannot safely replay an original task call, so it does not create a dispatch queue.

```json
{
  "orchestration": {
    "recovery": {
      "autoResumeOnStart": true
    }
  }
}
```

## Tmux Runtime

- Enable tmux session management with `orchestration.tmux.enabled`.
- The default `mode: "window"` creates a dedicated tmux session (`{sessionPrefix}-{opencode-session-id}`) for each OpenCode session.
- Each subagent task gets its own window inside that session, keeping your working window clean.
- Use `tmux switch-client -t fellowship-*` to peek at agent work.
- Use `mode: "pane"` for oh-my-opencode-slim style behavior: each task opens as a pane in the current tmux window, then Fellowship applies `layout` and `mainPaneSize`.

```json
{
  "orchestration": {
    "tmux": {
      "enabled": true,
      "mode": "window",
      "sessionPrefix": "fellowship"
    }
  }
}
```

Slim-style pane layout parity:

```json
{
  "orchestration": {
    "tmux": {
      "enabled": true,
      "mode": "pane",
      "layout": "main-vertical",
      "mainPaneSize": 60
    }
  }
}
```

- Supported layouts are `main-horizontal`, `main-vertical`, `tiled`, `even-horizontal`, and `even-vertical`.
- `/tasks` reports the tmux mode, layout, main pane size, agent session name, and active window/pane count.
- `/diagnostics` checks tmux wiring, binary availability, and window reconciliation.
