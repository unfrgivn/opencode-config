---
description: Show status for fellowship bundled config
---
Read the status file at ~/.cache/opencode/fellowship/opencode-config.plugin-status.json and report:

1. **Plugin Version** - The installed version of @unfrgivn/opencode-config
2. **Last Load Time** - When the bundled config was last loaded
3. **Installed Assets** (with names):
   - Skills (symlinked to local skill directory)
   - Runtime Plugins (compiled into the package root)
   - MCPs (configured MCP servers)
   - Agents (bundled agent definitions)
   - Commands (bundled slash commands)
   - Instructions (bundled instructions)
4. **Runtime Plugins** - Plugins injected into config.plugin[] (e.g. @tarquinen/opencode-dcp@latest)
5. **Issues** (if any):
   - Skipped conflicts (local skills that blocked bundled skills, listed by name)
   - Staged skill updates (copied managed skills with local edits that were not overwritten)
   - Dirty managed skill copies (copied bundled skills that differ from the last installed version)
   - Disabled assets (explicitly disabled in fellowship.json, listed by type:name)
6. **Actions Required** - Any restart needed for plugin changes

If the file doesn't exist, report that the plugin hasn't loaded yet.

Format the output as a clean, readable summary.
