# Changelog

## [3.0.2](https://github.com/unfrgivn/opencode-config/compare/v3.0.1...v3.0.2) (2026-10-18)


### Bug Fixes

* load on OpenCode 2 by depending on @opencode/plugin ([daa5471](https://github.com/unfrgivn/opencode-config/commit/daa547190402b05bc187cead8f20899c8645eb05))

## [3.0.1](https://github.com/unfrgivn/opencode-config/compare/v3.0.0...v3.0.1) (2026-10-18)


### Miscellaneous Chores

* verify trusted publishing ([5665919](https://github.com/unfrgivn/opencode-config/commit/56659194931b100d227b77cd954664c3aa27a7c9))

## [3.0.0](https://github.com/unfrgivn/opencode-config/releases/tag/v3.0.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* the package is published as @unfrgivn/opencode-config. Configuration lives in fellowship.json or fellowship.jsonc, validated by fellowship.schema.json. Tools are fellowship_orchestration and fellowship_preset, environment variables use the FELLOWSHIP_ prefix, the status commands are /fellowship-status, /fellowship-list, and /fellowship-cleanup, and runtime state lives under ~/.cache/opencode/fellowship.

### Features

* publish as @unfrgivn/opencode-config ([197ffc2](https://github.com/unfrgivn/opencode-config/commit/197ffc26c28452b78c7fcb2f3d7560117d1fe3f3))
