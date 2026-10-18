# Changelog

## [3.0.6](https://github.com/unfrgivn/opencode-config/compare/v3.0.5...v3.0.6) (2026-10-18)


### Bug Fixes

* **companion:** restart a companion left running by an older version ([#10](https://github.com/unfrgivn/opencode-config/issues/10)) ([5e7b077](https://github.com/unfrgivn/opencode-config/commit/5e7b077841c6ea324e4bfa1d26f73f275e20f9f7))
* **install:** keep generated installs out of git with in-folder ignore files ([#8](https://github.com/unfrgivn/opencode-config/issues/8)) ([e6cbcc9](https://github.com/unfrgivn/opencode-config/commit/e6cbcc96a9adf56440a515acc1df8bdd4ed5d79c))
* **orchestration:** keep shared state until the last location unloads ([#9](https://github.com/unfrgivn/opencode-config/issues/9)) ([781c369](https://github.com/unfrgivn/opencode-config/commit/781c369fadb7dcc63a597c81a53077d7c8b5d855))

## [3.0.5](https://github.com/unfrgivn/opencode-config/compare/v3.0.4...v3.0.5) (2026-10-18)


### Bug Fixes

* keep the plugin active across location reloads ([#6](https://github.com/unfrgivn/opencode-config/issues/6)) ([bfc064c](https://github.com/unfrgivn/opencode-config/commit/bfc064c9d5cb8fbf81a8fe68e2de4c29c6a80a23))

## [3.0.4](https://github.com/unfrgivn/opencode-config/compare/v3.0.3...v3.0.4) (2026-10-18)


### Bug Fixes

* **vision:** run analysis on the analyst model and nest it under the caller ([40b0966](https://github.com/unfrgivn/opencode-config/commit/40b09663b963c5d508a53e13937655dfbe2a4522))

## [3.0.3](https://github.com/unfrgivn/opencode-config/compare/v3.0.2...v3.0.3) (2026-10-18)


### Bug Fixes

* **tui:** read OpenCode 2 theme tokens in the sidebar ([c85710e](https://github.com/unfrgivn/opencode-config/commit/c85710e52aeac4f1eb37f287fd5d57648e0d4ba8))

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
