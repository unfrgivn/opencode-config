---
description: List all bundled assets from fellowship config
---
List all available bundled assets from the installed @unfrgivn/opencode-config plugin.

## Instructions

1. Check the installed asset locations:
   - Skills: ~/.config/opencode/skill/_plugins/opencode-config/
   - Plugins: ~/.config/opencode/plugins/ (files matching _remote_opencode-config_*)
   - MCPs: ~/.config/opencode/mcp/_plugins/opencode-config/

2. For each asset type, list what's available:

### Skills (skill/ directory)
- Show each skill name and its description from SKILL.md frontmatter
- Mark if it's installed or skipped due to local conflict
- Mark copied managed skills with staged updates under `_plugins/opencode-config/.updates/`

### Agents (agent/ directory)
- Show each agent name and description
- These are injected into OpenCode automatically

### Commands (command/ directory)
- Show each command name and description
- These are available as /command-name

### Instructions (instruction/ directory, listed in manifest.json)
- Show each instruction file
- These are appended to agent system prompts

### Runtime Plugins (compiled into package root)
- Show each plugin and whether it's loaded

### MCPs (mcp/ directory)
- Show each MCP configuration

{{$arguments}}

## Filtering

If the user specified a filter (like "skills" or "agents"), only show that type.

## Output Format

Use a clean markdown table or list format showing:
- Asset name
- Type
- Status (installed/available/disabled/conflict)
- Brief description
