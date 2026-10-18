# Agent Instructions

This is **@unfrgivn/opencode-config**, a public OpenCode plugin that bundles skills, agents, commands, instructions, and MCP configurations for local use.

## Development Commands

```bash
bun install             # Install dependencies
bun run build           # Build plugin (outputs to dist/)
bun test                # Run all tests
bun run typecheck       # TypeScript type checking
bun run verify:release  # Load the packed plugin in the matching OpenCode release (run after dependency changes)
bun run update:opencode # Move the OpenCode SDK pins to the latest release, in lockstep
npm link                # Link for local testing
```

## Quality Gates (MUST pass before commit)

```bash
bun test                # All tests must pass
bun run typecheck       # No type errors
```

## Architecture

### Discovery Flow
1. Plugin loads on OpenCode startup
2. `loadConfig()` — reads `fellowship.json` from project or user config
3. `discoverAssets()` — scans bundled asset directories in the npm package via `import.meta.dir`
4. `performSync()` — installs assets, respecting disable list
5. Config hook injects agents/commands/instructions into OpenCode runtime

### Key Concepts
- **Local wins**: User's local configs always override bundled configs
- **Disable list**: `fellowship.json` can disable specific assets by `type:name`
- **Symlink install**: Skills/plugins use symlinks by default (`installMethod: "link"`)
- **Safety limits**: Max 100 files per type, 256KB per file, 10 dir levels
- **Bundled assets**: Asset version is tied to the installed npm package version
- **JSON Schema**: `fellowship.schema.json` is automatically materialized to `~/.config/opencode/schemas/` on startup; users add `"$schema": "./schemas/fellowship.schema.json"` to `fellowship.json` for editor autocompletion

### Asset Types

| Type | Location | Format | Override Method |
|------|----------|--------|-----------------|
| Skill | `skill/<name>/SKILL.md` | Markdown + frontmatter | Local skill dir blocks bundled |
| Agent | `agent/<name>.md` | Markdown + frontmatter | Add to opencode.json |
| Command | `command/<name>.md` | Markdown + frontmatter | Add to opencode.json |
| Runtime plugin | `src/<name>-plugin.ts` | TypeScript | Compose from root setup |
| Instruction | `instruction/<name>.md` | Markdown (in manifest.json) | Disable only |
| MCP | `mcp/<name>.json` | JSON | Add to opencode.json |

## Adding Bundled Assets

### Add a Skill
```bash
mkdir skill/my-skill
cat > skill/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: What this skill does
---
Skill content here...
EOF
```

### Add an Agent
```bash
cat > agent/my-agent.md << 'EOF'
---
model: claude-sonnet-4-20250514
description: Agent description
temperature: 0.7
---
Agent system prompt here...
EOF
```

### Add a Command
```bash
cat > command/my-command.md << 'EOF'
---
description: Command description
---
Command template with {{$arguments}}
EOF
```

### Add an Instruction
```bash
# Create the file
cat > instruction/my-instruction.md << 'EOF'
# My Instruction
Content here...
EOF

# IMPORTANT: Add to manifest.json
# Edit manifest.json and add "instruction/my-instruction.md" to the instructions array
```

## Code Style

- **No `any`**: Use proper types, never `as any` or `@ts-ignore`
- **Error handling**: Handle all errors, no empty catch blocks
- **Tests**: Add tests for new functionality, keep at bottom of file in `describe` blocks

## Testing Philosophy

- **No mocks of internal logic**: Test real implementations
- **Unit + E2E only**: No mock tests that invent fake behaviors
- **Run only changed tests**: Use `bun test <file>` during development
- **Full suite before commit**: Run `bun test` to verify all pass
- **Sandboxed home**: `bun test` preloads `src/test-preload.ts` (via `bunfig.toml`), which points `HOME` and `XDG_*` at a temp dir. Resolve home, config, cache, and data paths through `src/paths.ts`, never `os.homedir()` directly: Bun's `os.homedir()` ignores the sandbox, so tests would write into the developer's real OpenCode directories.
- **No module mocks**: Bun's `mock.module` is process-wide. A stub leaks into every test file loaded after it, so results depend on file order, and macOS and Linux order files differently. Inject the dependency instead (see `runTmuxCommand` in `src/orchestration-plugin.ts`).

## Session Completion

**When ending a work session**, complete ALL steps:

1. **Run quality gates**:
   ```bash
   bun test && bun run typecheck
   ```

2. **Commit and push**:
   ```bash
   git add -A
   git commit -m "descriptive message"
   git push origin main
   git status  # MUST show "up to date with origin"
   ```

3. **Verify**: All changes committed AND pushed

**CRITICAL**: Work is NOT complete until `git push` succeeds. Never leave work stranded locally.
