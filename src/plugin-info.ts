/**
 * Information about a plugin discovered in a repository.
 * Plugins are self-contained .ts or .js files that export OpenCode hooks.
 */
export interface PluginInfo {
  /** Plugin name (derived from file path, e.g., "notify" or "utils-logger") */
  name: string
  /** Full path to the plugin file */
  path: string
  /** Repository short name (for namespacing in symlinks) */
  repoShortName: string
  /** File extension (.ts or .js) */
  extension: string
}
