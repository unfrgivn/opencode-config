---
name: agent-creator
description: Guide for creating new agents in the @unfrgivn/opencode-config plugin with both descriptive and LOTR name support
---

# Agent Creator

Use this skill when adding a new agent to the `@unfrgivn/opencode-config` plugin.

## Overview

Agents are markdown files in `agent/` with YAML frontmatter. Each agent has:

- A **descriptive filename** (the canonical name on disk)
- A **LOTR character name** for the optional LOTR theme
- A **role** used as a template variable for cross-references

## Step-by-step

### 1. Pick a descriptive name

Choose a short, lowercase name that describes the agent's function. This becomes the filename.

Examples: `explorer`, `researcher`, `implementer`, `architect`, `analyst`

Rules:

- Lowercase, no spaces
- Characters: `a-z`, `0-9`, `-`, `_` only
- Must be unique across all agents

### 2. Pick a LOTR character

Choose a Tolkien character whose traits match the agent's persona. The character should feel like a natural fit, not a forced mapping.

Already taken:
| Role | LOTR Character | Why |
|------|----------------|-----|
| orchestrator | gandalf | Guides and coordinates the fellowship |
| explorer | legolas | Keen-eyed scout and pathfinder |
| researcher | radagast | Scholar of the natural world |
| planner | treebeard | Deliberate, patient, thorough |
| implementer | celebrimbor | Master craftsman and maker |
| architect | elrond | Wise counselor on strategy |
| analyst | galadriel | Sees patterns others miss |
| tdd | aragorn | Disciplined ranger, test-first warrior |

Available characters that could work well:

- **gimli** - stubborn, thorough, good for auditing or security
- **faramir** - measured judgment, good for code review
- **eowyn** - determined, good for migration or refactoring
- **tom bombadil** - unconstrained, good for creative/exploratory work
- **glorfindel** - powerful specialist, good for performance optimization

### 3. Create the agent markdown file

Create `agent/<descriptive-name>.md`:

```markdown
---
model: github-copilot/claude-sonnet-4.6
description: One-line description of what this agent does
temperature: 0.1
mode: subagent
---

You are <LOTR Name>, the <descriptive role>.

<Agent system prompt goes here>

Cross-reference other agents using template variables:

- Use {{explorer}} not "legolas" or "explorer" directly
- Use {{researcher}} not "radagast" or "researcher" directly
- This ensures references resolve correctly under any theme
```

#### Frontmatter fields

| Field         | Required | Values                                                               | Notes                                  |
| ------------- | -------- | -------------------------------------------------------------------- | -------------------------------------- |
| `model`       | yes      | `github-copilot/claude-opus-4.6`, `github-copilot/claude-sonnet-4.6` | opus for primary, sonnet for subagents |
| `description` | yes      | string                                                               | Short, shown in agent picker           |
| `temperature` | no       | `0.0` - `1.0`                                                        | Lower = more focused (default: 0.1)    |
| `mode`        | no       | `primary`, `subagent`                                                | Only one agent should be `primary`     |

#### Template variables

When referencing other agents in prompts, use `{{role}}` syntax:

```
Delegate to {{explorer}} for codebase search.
Use {{researcher}} for external docs.
Ask {{planner}} to review the plan.
```

These resolve at discovery time based on the active theme:

- `"descriptive"` theme: `{{explorer}}` becomes `explorer`
- `"lotr"` theme: `{{explorer}}` becomes `legolas`

The `{{$arguments}}` syntax used by OpenCode commands is NOT affected (the `$` character is not matched by the template regex).

### 4. Add to the name mapping table

Edit `src/agent-names.ts` and add a new entry to `AGENT_NAME_TABLE`:

```typescript
const AGENT_NAME_TABLE: readonly AgentNameEntry[] = [
  // ... existing entries ...
  {
    canonical: "<descriptive-name>",
    role: "<descriptive-name>",
    themed: { lotr: "<lotr-name>", descriptive: "<descriptive-name>" },
  },
] as const;
```

Also add the role to the `AgentRole` type union:

```typescript
export type AgentRole =
  | "orchestrator"
  | "explorer"
  // ... existing roles ...
  | "<descriptive-name>";
```

### 5. Update the orchestrator agent (if needed)

If the new agent should be available for delegation, update `agent/orchestrator.md`:

1. Add a delegation routing entry:

   ```
   - `{{<role>}}` for <what this agent does>.
   ```

2. Add to the delegation routing table in the agent description section if one exists.

### 6. Update README.md

Add the new agent to the agent name mapping table in the README:

```markdown
| <descriptive-name> | <lotr-name> | <one-line description> |
```

### 7. Write tests

Add test cases in `src/agent-names.test.ts` to verify:

- `resolveAgentName("<descriptive-name>", "lotr")` returns `"<lotr-name>"`
- `resolveAgentName("<descriptive-name>", "descriptive")` returns `"<descriptive-name>"`
- Template variable `{{<role>}}` resolves correctly under both themes

### 8. Verify

```bash
bun run typecheck    # No type errors
bun test             # All tests pass
```

## Checklist

- [ ] Descriptive filename chosen and unique
- [ ] LOTR character chosen and not already taken
- [ ] `agent/<name>.md` created with proper frontmatter
- [ ] Cross-references use `{{role}}` template vars, not hardcoded names
- [ ] Entry added to `AGENT_NAME_TABLE` in `src/agent-names.ts`
- [ ] Role added to `AgentRole` type union
- [ ] Orchestrator updated (if agent should be delegated to)
- [ ] README mapping table updated
- [ ] Tests added and passing
- [ ] `bun run typecheck && bun test` passes
