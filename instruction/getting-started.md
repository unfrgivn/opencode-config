# Getting Started with Fellowship OpenCode

Welcome to the Fellowship OpenCode configuration.

## Quick Start

1. Install the plugin
2. Restart OpenCode
3. All bundled configs will be synced automatically

## Configuration

Create `~/.config/opencode/fellowship.json` (or `~/.config/opencode/fellowship.jsonc`) to customize globally:

```json
{
  "$schema": "./schemas/fellowship.schema.json",
  "disable": ["skill:example"],
  "installMethod": "link"
}
```

Add the `$schema` property for autocompletion and inline validation in VS Code, Cursor, and other JSON-aware editors. The plugin automatically copies `fellowship.schema.json` into `~/.config/opencode/schemas/` on startup, so the relative path above works out of the box — no need to clone the source repo or reference a remote URL.

Project-specific settings can live in `.opencode/fellowship.json` or `.opencode/fellowship.jsonc`. Global config loads first, then project config is merged on top, so projects can override bundled-local preferences without duplicating the whole file. If both `.json` and `.jsonc` exist in the same directory, `.jsonc` wins.

## Optional TUI Sidebar

The package also ships a small OpenCode TUI sidebar that reads the plugin's local status snapshot. Add the package to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["@unfrgivn/opencode-config/tui"]
}
```

Use the `/tui` subpath for TUI config. The package root is the server plugin for `opencode.json`; the TUI sidebar lives at `@unfrgivn/opencode-config/tui`. Restart OpenCode after changing `cli.json`. The sidebar shows plugin version, loaded config files, asset counts, agent models, and warnings such as local skill conflicts or plugin changes that need a restart.

## Desktop Companion

Fellowship can mirror session activity to a companion state file and launch a bundled companion process. This gives desktop overlays the same basic protocol slim uses: active agents, waiting-for-input state, session cwd, and presentation preferences.

```jsonc
{
  "companion": {
    "enabled": true,
    "binaryPath": "/path/to/fellowship-companion",
    "position": "bottom-right",
    "size": "medium",
    "gifPack": "default",
    "loopStyle": "classic",
    "speed": 1,
    "debug": false
  }
}
```

If `binaryPath` is omitted, Fellowship first checks `$XDG_DATA_HOME/opencode/storage/fellowship/bin/fellowship-companion` (or `~/.local/share/opencode/storage/fellowship/bin/fellowship-companion`) and then falls back to the companion binary bundled in the npm package. State is written to `opencode-config.companion-state.json`; the bundled companion watches that file, writes `opencode-config.companion-runtime.json` plus a small log in the same storage directory, and opens stacked chromeless macOS desktop image tiles for busy or waiting agents. Idle state stays hidden. Set `binaryPath` only when replacing the bundled companion with a custom one.

Companion agent labels and artwork follow `agentNames`. With `"agentNames": "descriptive"`, active agents use role names such as `orchestrator` and `researcher`; with `"agentNames": "lotr"`, they use `gandalf`, `radagast`, and the rest of the Fellowship LOTR theme. The package includes original SNES-style SVG sprite sheets under `companion/art/descriptive`, `companion/art/lotr`, and `companion/art/common`; each tile bakes the agent name into the art and the bundled macOS overlay cycles through the sprite panels. Restart OpenCode after changing companion config or `agentNames`.

## Runtime Presets

Use presets to switch model and orchestration profiles without rewriting your config by hand:

```jsonc
{
  "preset": "fast",
  "presets": {
    "fast": {
      "description": "Cheaper/faster defaults for routine work",
      "models": {
        "orchestrator": "github-copilot/gpt-5-mini"
      },
      "orchestration": {
        "providerMode": "copilot",
        "limits": {
          "maxConcurrent": 2,
          "maxConcurrentGlobal": 3
        }
      }
    }
  }
}
```

Run `/preset` to list presets, `/preset <name>` to choose one, or `/preset default` to clear the runtime selection. Preset changes apply after restarting OpenCode. `FELLOWSHIP_PRESET=<name>` overrides both the saved runtime selection and config default for that startup.

## Tmux Multiplexer

Enable Fellowship's tmux runtime under `orchestration.tmux`. The default `mode: "window"` keeps subagents in a dedicated tmux session. Use `mode: "pane"` for oh-my-opencode-slim style pane splitting and layout control:

```jsonc
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

`mainPaneSize` is the Fellowship equivalent of slim's `main_pane_size`. Supported layouts are `main-horizontal`, `main-vertical`, `tiled`, `even-horizontal`, and `even-vertical`.

## Per-Agent Policy Controls

Use `agentOverrides.<agent>.policy` to narrow a bundled agent's tools, MCP-derived tool permissions, or skills without replacing the whole agent. Built-in bundled agents accept either descriptive or LOTR names:

```jsonc
{
  "agentOverrides": {
    "researcher": {
      "policy": {
        "tools": { "bash": false },
        "permission": { "edit": "deny" },
        "mcps": ["context7", "exa", "!chrome-devtools"],
        "skills": ["*", "!terraform"]
      }
    }
  }
}
```

`mcps` and `skills` use allow entries by default and deny entries when prefixed with `!`. A list with positive entries becomes an allowlist for known bundled assets; a deny-only list becomes a blocklist. These controls are applied to the bundled agent before OpenCode sees it. A local `opencode.json` agent with the same name still wins completely.

## Overriding Bundled Configs

To override a bundled skill/agent/command, create a local file with the same name in your personal config directory.

If you use `installMethod: "copy"` and edit a copied bundled skill under `_plugins/opencode-config`, startup will preserve your edited copy and stage the package update under `_plugins/opencode-config/.updates/` for manual review instead of overwriting it.
