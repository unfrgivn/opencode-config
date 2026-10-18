---
description: Remove stale cache files, broken symlinks, and unused plugins from OpenCode's plugin cache
---
Clean up stale artifacts left behind by @unfrgivn/opencode-config and OpenCode's plugin cache.

OpenCode's plugin cache is append-only in a few places. `~/.cache/opencode/package.json` never removes plugins you've uninstalled from `opencode.json`, and `~/.cache/opencode/packages/` can keep older per-plugin installs around. This command fixes both issues, along with other accumulated cruft.

## Instructions

Run each cleanup step below in order. Report what was found and what was removed. Use the Bash tool for filesystem operations.

### 1. Remove old git-clone cache (legacy architecture)

The plugin used to clone the bundled config repo via git. That was replaced by bundled npm assets. The entire `repos/` directory is inert.

```
rm -rf ~/.cache/opencode/fellowship/repos/
rm -f ~/.cache/opencode/fellowship/opencode-config.sync-status.json
```

Report the size freed if the directory existed.

### 2. Prune unused plugins from OpenCode's npm cache

Read `~/.config/opencode/opencode.json` to get the active `plugin` list. Then read `~/.cache/opencode/package.json` to get cached dependencies.

Any dependency in the cache that is NOT in the active plugin list AND is NOT `opencode-anthropic-auth` (OpenCode's built-in default plugin) should be removed:
- Delete the entry from `~/.cache/opencode/package.json`
- Delete the package directory from `~/.cache/opencode/node_modules/<pkg>/`
- Delete `~/.cache/opencode/bun.lock` so Bun re-resolves cleanly on next startup

List each removed package by name and version.

**Important**: Also check for project-level `.opencode/opencode.json` plugin entries (in the current working directory) so you don't accidentally prune a plugin that's declared at the project level rather than the user level.

### 3. Clear active plugin package caches so OpenCode fetches latest versions

OpenCode also keeps per-plugin package installs under `~/.cache/opencode/packages/`. These can pin an active plugin to an older version even after npm has a newer release. Always remove cache directories for active npm plugins so OpenCode re-resolves and downloads the newest allowed version on next startup.

Using the active plugin list from step 2, remove package-cache directories for each active npm plugin entry. Skip local/file plugins such as `./plugin.ts`, `/absolute/plugin.ts`, and `file:` URLs.

For each active npm plugin, remove all matching cache directories that may represent the package name or the configured spec, including unversioned and `@latest` forms. Examples:

- `~/.cache/opencode/packages/@unfrgivn/opencode-config/`
- `~/.cache/opencode/packages/@unfrgivn/opencode-config@latest/`
- `~/.cache/opencode/packages/opencode-some-plugin/`
- `~/.cache/opencode/packages/opencode-some-plugin@latest/`

Delete `~/.cache/opencode/bun.lock` if any package-cache directory was removed. Report each removed cache directory with its size.

### 4. Fix broken symlinks

Check these locations for symlinks whose targets no longer exist:
- `~/.config/opencode/skill/_plugins/opencode-config/*/`
- `~/.config/opencode/plugin/_remote_opencode-config_*`
- `~/.config/opencode/plugins/_remote_opencode-config_*`
- `~/.config/opencode/mcp/_plugins/opencode-config/*/`

Remove any broken symlinks. Report each one removed.

### 5. Clean stale orchestration task files

Check `~/.cache/opencode/fellowship/orchestration-tasks/` for session files older than 7 days:

```bash
find ~/.cache/opencode/fellowship/orchestration-tasks/ -name "ses_*.json" -mtime +7
```

Remove them and report the count.

### 6. Rotate plugin log

If `~/.cache/opencode/fellowship/plugin.log` is larger than 1MB, truncate it to the last 200 lines.

## Output Format

Present a summary table:

| Category | Found | Cleaned | Details |
|----------|-------|---------|---------|
| Git clone cache | ... | ... | ... |
| Unused cached plugins | ... | ... | ... |
| Active plugin package caches | ... | ... | ... |
| Broken symlinks | ... | ... | ... |
| Stale task files | ... | ... | ... |
| Plugin log | ... | ... | ... |

End with either "All clean, no restart needed." or "Restart OpenCode to pick up changes." if any cached plugins, active plugin package caches, or symlinks were removed.
