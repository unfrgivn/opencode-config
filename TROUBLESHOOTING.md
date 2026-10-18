# Troubleshooting

Common issues and solutions for @unfrgivn/opencode-config.

## Quick Diagnostics

```bash
# Check if plugin is installed
npm list -g @unfrgivn/opencode-config

# Check installed skills
ls ~/.config/opencode/skill/_plugins/opencode-config/

# Check installed plugins
ls ~/.config/opencode/plugins/ | grep remote_opencode-config

# Check installed MCPs
ls ~/.config/opencode/mcp/_plugins/opencode-config/
```

---

## Plugin Issues

### Plugin not loading on startup

**Symptoms**: No bundled skills/agents appearing

**Causes & Solutions**:

1. **Plugin not installed correctly**
   ```bash
   # Verify plugin is linked
   npm list -g @unfrgivn/opencode-config
   
   # Re-link if needed
   cd /path/to/opencode-config
   bun install && bun run build && npm link
   ```

2. **Plugin not in opencode.json**
   ```json
   // ~/.config/opencode/opencode.json
   {
     "plugins": ["@unfrgivn/opencode-config"]
   }
   ```

3. **Initialization guard triggered**
   
   The plugin only initializes once per session. Restart OpenCode completely.

### Stuck on old version

**Symptoms**: Changes merged to main aren't appearing

**Solution**: Update the plugin to the latest version:
```bash
npm install -g @unfrgivn/opencode-config@latest
# Restart OpenCode
```

The bundled asset version is tied to the installed plugin version. Updating the plugin updates the assets.

---

## Asset Issues

### Skill not appearing

**Symptoms**: Bundled skill doesn't show in OpenCode

**Causes & Solutions**:

1. **Skill is disabled**
   ```bash
   # Check your disable list
   cat ~/.config/opencode/fellowship.json
   ```

2. **Local conflict**
   
   If you have `~/.config/opencode/skill/<name>/`, it blocks the bundled skill. Remove or rename your local version.

3. **Broken symlink**
   ```bash
   # Check if the symlink is valid
   ls -la ~/.config/opencode/skill/_plugins/opencode-config/
   
   # Clean up and restart if broken
   rm -rf ~/.config/opencode/skill/_plugins
   ```

### Agent/Command not working

**Symptoms**: Bundled agent or command not available

**Causes & Solutions**:

1. **Disabled in config**
   ```bash
   grep -i "<name>" ~/.config/opencode/fellowship.json
   ```

2. **Overridden locally**
   
   Check `~/.config/opencode/opencode.json` for a local definition with the same name.

3. **Invalid frontmatter**
   
   The agent/command markdown file may have invalid YAML frontmatter. Check OpenCode logs for parse errors.

### Instruction not injected

**Symptoms**: Bundled instruction not in agent context

**Causes & Solutions**:

1. **Not in manifest.json**
   
   Instructions must be explicitly listed in the repo's `manifest.json`:
   ```json
   {
     "instructions": ["instruction/my-instruction.md"]
   }
   ```

2. **Disabled**
   ```bash
   grep "instruction:" ~/.config/opencode/fellowship.json
   ```

### MCP not configured

**Symptoms**: MCP server not available

**Solutions**:

1. **Check installation path**
   ```bash
   ls ~/.config/opencode/mcp/_plugins/opencode-config/
   ```

2. **Verify JSON syntax**
   
   Invalid JSON in the MCP file will cause silent failure. Check OpenCode logs.

3. **MCP server not installed**
   
   The plugin only copies config files. You must install the actual MCP server separately.

---

## Configuration Issues

### fellowship.json not loading

**Symptoms**: Disable list or other settings ignored

**Causes & Solutions**:

1. **Invalid JSON**
   ```bash
   # Validate JSON syntax
   cat ~/.config/opencode/fellowship.json | jq .
   ```

2. **Wrong location**
   
   Config is loaded from (in order):
   - `<project>/.opencode/fellowship.json` (project-specific)
   - `~/.config/opencode/fellowship.json` (global)

3. **Schema mismatch**
   
   Valid options are:
   ```json
   {
     "disable": ["type:name", "bare-name"],
     "installMethod": "link"
   }
   ```

### Disable not working

**Symptoms**: Asset appears despite being in disable list

**Causes & Solutions**:

1. **Wrong syntax**
   
   Use `type:name` format:
   ```json
   {
     "disable": [
       "skill:my-skill",
       "agent:my-agent"
     ]
   }
   ```
   
   NOT:
   ```json
   {
     "disable": ["skill/my-skill", "agents.my-agent"]
   }
   ```

2. **Case sensitivity**
   
   Names are case-sensitive. `Skill:Name` ≠ `skill:name`

3. **Config not reloaded**
   
   **Important**: Configuration changes take effect on restart.
   The plugin reads `fellowship.json` once at startup. After modifying:
   - Disable list
   - Install method
   - Dry-run setting
   
   You must restart OpenCode for changes to take effect.
---

## Override Issues

### Local override not taking effect

**Symptoms**: Bundled version used instead of local version

**Asset-specific solutions**:

| Asset Type | Override Method |
|------------|-----------------|
| Skill | Create `~/.config/opencode/skill/<name>/SKILL.md` |
| Agent | Add to `opencode.json`: `{ "agent": { "<name>": {...} } }` |
| Command | Add to `opencode.json`: `{ "command": { "<name>": {...} } }` |
| Instruction | Cannot override, only disable. Add your version separately. |
| Plugin | Disable bundled plugin, add your own to plugins directory |
| MCP | Add to `opencode.json` MCP config directly |

### Agent override changed behavior unexpectedly

**Symptoms**: You changed one agent field (for example `model`) and lost bundled prompt/permission behavior.

**Cause**: `opencode.json` agent entries are full replacements, not partial merges.

**Fix**:

1. Use `fellowship.json` `agentOverrides` for patch-style partial updates:
   ```json
   {
     "agentOverrides": {
       "planner": {
         "temperature": 0.2
       }
     }
   }
   ```
2. Restart OpenCode after config changes.

### Override causes duplicate

**Symptoms**: Both local and bundled versions appear

**This shouldn't happen.** The plugin checks for local conflicts before installing. If you see duplicates:

1. Check if the names are actually identical (case-sensitive)
2. Clean up and restart:
   ```bash
   rm -rf ~/.config/opencode/skill/_plugins
   ```

---

## Performance Issues

### Slow startup

**Symptoms**: OpenCode takes long to start

**Causes & Solutions**:

1. **Symlink traversal**
   
   Consider using `installMethod: "copy"` if symlink traversal is slow:
   ```json
   {
     "installMethod": "copy"
   }
   ```

2. **Too many assets**
   
   Discovery has limits (100 files max per type). If you're hitting these, consolidate assets.

---

## Getting Help

1. **Search existing issues**
   
   https://github.com/unfrgivn/opencode-config/issues

2. **File a new issue**
   
   Include:
   - Your fellowship.json config
   - Steps to reproduce
   - Expected vs actual behavior
