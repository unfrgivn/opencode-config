# Development Roadmap

This document outlines planned improvements for @unfrgivn/opencode-config.

## Overview

The plugin is functional with solid foundations (schema validation, security measures, conflict detection). The roadmap addresses gaps in: user visibility, override flexibility, and future enhancements.

---

## Completed Work

### Initial Release (v0.1.0)
- [x] Core asset discovery and installation
- [x] Support for all asset types (skills, agents, commands, plugins, instructions, MCPs)
- [x] Configuration via fellowship.json
- [x] Local conflict detection for skills
- [x] Stale asset cleanup
- [x] Plugin change detection
- [x] Security measures (disabled JS frontmatter, path traversal protection)
- [x] Safety limits (100 files/type, 256KB/file, 10 dir depth)

### Stability
- [x] Integration test suite with temp directories
- [x] MCP schema validation (validate JSON before installation)
- [x] 422 unit tests

### Visibility
- [x] `fellowship-status` slash command (last sync time, installed assets, errors)
- [x] `fellowship-list` slash command (list all assets, show override status)
- [x] TROUBLESHOOTING.md, CHANGELOG.md, expanded README

### Flexibility
- [x] Glob pattern support for disable list (`*`, `**`, negation)
- [x] Instruction override detection (local files with same name skip bundled version)
- [x] Dry-run mode (preview changes without installing)

### Architecture (v1.1.0)
- [x] Removed git clone machinery (assets bundled in npm package)
- [x] Assets discovered from installed package via `import.meta.dir`
- [x] Asset version tied to plugin version (no separate sync)
- [x] Removed lock file, retry logic, cache directory

---

## Future Improvements

### Rollback Mechanism
**Priority**: Low
**Status**: Deferred

- [ ] Store last known-good state
- [ ] Add `fellowship rollback` command
- [ ] Auto-rollback option on install failure

**Note**: Deferred. Since assets are now bundled with the npm package, rollback is just `npm install @unfrgivn/opencode-config@<previous-version>`.

---

## Contributing

To work on a roadmap item:

1. Check if there's an existing issue/PR
2. Create an issue if one doesn't exist
3. Reference this document in your PR
4. Update the checkbox when complete

## Prioritization

Items are prioritized based on:
- **Critical**: Blocks reliable use of the plugin
- **High**: Significant user pain point
- **Medium**: Nice to have, improves experience
- **Low**: Minor improvement, can wait
