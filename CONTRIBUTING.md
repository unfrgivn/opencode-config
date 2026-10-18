# Contributing to @unfrgivn/opencode-config

This guide explains how to add new skills, agents, commands, runtime plugins, instructions, and MCP configs to the bundled repository.

## Quick Reference

| Asset Type | Location | Format |
|------------|----------|--------|
| Skills | `skill/<name>/SKILL.md` | Directory with SKILL.md |
| Agents | `agent/<name>.md` | Markdown with YAML frontmatter |
| Commands | `command/<name>.md` | Markdown with YAML frontmatter |
| Runtime plugins | `src/<name>-plugin.ts` | Native OpenCode V2 plugin |
| Instructions | `instruction/<name>.md` | Markdown (add to manifest.json) |
| MCPs | `mcp/<name>.json` | JSON config file |

## Adding a Skill

Create a directory in `skill/` with a `SKILL.md` file:

```
skill/
└── my-new-skill/
    └── SKILL.md
```

### SKILL.md Format

```markdown
---
name: my-new-skill
description: Brief description of what this skill does
---

# My New Skill

Detailed instructions for when and how to use this skill.

## When to Use

- Use case 1
- Use case 2

## Instructions

Step-by-step guidance for the agent.

## Examples

Show example inputs and outputs.
```

### Required Fields

- `name`: Must match the directory name
- `description`: Short description (shown in skill listings)

## Adding an Agent

Create a markdown file in `agent/`:

```
agent/
└── my-agent.md
```

### Agent Format

```markdown
---
model: claude-sonnet-4-20250514
description: What this agent specializes in
temperature: 0.7
# Optional fields:
# top_p: 0.9
# tools: { "bash": true, "read": true }
# disable: false
# mode: subagent
# steps: 50
# maxSteps: 100
---

You are a specialized agent that...

Your responsibilities:
1. First thing
2. Second thing

Guidelines:
- Be concise
- Follow existing patterns
```

### Common Models

- `claude-sonnet-4-20250514` — Fast, good for most tasks
- `claude-opus-4-20250514` — Slower, better for complex reasoning

## Adding a Command

Create a markdown file in `command/`:

```
command/
└── my-command.md
```

### Command Format

```markdown
---
description: What this command does
# Optional fields:
# agent: specific-agent
# model: claude-sonnet-4-20250514
# subtask: true
---

Command template goes here.

User provided: {{$arguments}}

Do the thing based on the user's input.
```

### Template Variables

- `{{$arguments}}` — Everything the user typed after the command name

## Adding a Plugin

Create a TypeScript module in `src/` and compose its setup function from `src/index.ts`:

```
src/
└── my-plugin.ts
```

### Plugin Format

```typescript
import { Plugin } from "@opencode/plugin"

export const MyPlugin = Plugin.define({
  id: "@unfrgivn/opencode-config:my-plugin",
  setup: async (ctx) => {
    const registration = await ctx.tool.transform((tools) => {
      // Register V2 capabilities here.
    })
    return () => registration.dispose()
  },
})
```

### Important Notes

- Runtime plugins may share typed modules under `src/`.
- Compose setup and cleanup through the package root so one package entry activates every capability.
- Add a package-load test proving the built root entrypoint contains the capability.

## Adding an Instruction

1. Create a markdown file in `instruction/`:

```
instruction/
└── my-guide.md
```

2. Add the path to `manifest.json`:

```json
{
  "instructions": [
    "instruction/getting-started.md",
    "instruction/my-guide.md"
  ]
}
```

### Instruction Format

Standard markdown. These files are appended to the agent's context, similar to AGENTS.md.

## Adding an MCP Config

Create a JSON file in `mcp/`:

```
mcp/
└── my-server.json
```

### MCP Format

Follow the MCP configuration schema for the specific server you're configuring. The plugin copies these files as-is (no validation).

```json
{
  "name": "my-mcp-server",
  "command": "npx",
  "args": ["-y", "@my-org/mcp-server"],
  "env": {
    "API_KEY": "${MCP_API_KEY}"
  }
}
```

## Testing Your Changes

### Local Testing

1. Make your changes
2. Build the plugin: `bun run build`
3. Link locally: `npm link`
4. Restart OpenCode
5. Verify your asset appears

### Verify Syntax

```bash
# Type check
bun run typecheck

# Run tests
bun test
```

### Verify in OpenCode

`bun run verify:release` packs the plugin, installs it with npm the way OpenCode does, then boots the OpenCode release matching the `@opencode/plugin` pin in a sandboxed home and checks that the plugin loads. OpenCode gives plugins its own `effect` and `@opencode/plugin` at runtime, so importing the package under plain Bun cannot catch an incompatible SDK; only the real host can.

- `OPENCODE_VERSION=latest bun run verify:release` tests the current build against a different OpenCode release.
- `OPENCODE_BIN="$(command -v opencode)" bun run verify:release` uses an installed binary instead of downloading one.

## Pull Request Process

1. Create a feature branch
2. Add your asset(s)
3. Test locally
4. Submit PR with description of what you added
5. Open a pull request for review
6. Merge to main

## Naming Conventions

- Use kebab-case for all names: `my-new-skill`, `api-helper`
- Be descriptive but concise
- Avoid generic names like `helper` or `util`

## Versioning

We use semantic versioning:

- **Patch** (1.0.x): Bug fixes, typo corrections
- **Minor** (1.x.0): New skills, agents, commands
- **Major** (x.0.0): Breaking changes, removed assets

Create a release tag when shipping significant changes.

## Questions?

Ask in the #opencode Slack channel.
