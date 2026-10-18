/**
 * Status tracking and reporting for the fellowship plugin.
 *
 * Tracks plugin state to provide status information to users via commands/tools.
 */

import * as fs from "fs"
import * as path from "path"
import { REPO_SHORT_NAME } from "./constants"
import { logDebug } from "./logging"
import { moduleDir } from "./module-path"
import { fellowshipCacheDir } from "./paths"

const STATUS_BASE = fellowshipCacheDir()

/**
 * Plugin status data persisted between runs
 */
export interface PluginStatus {
  /** Last successful load timestamp (ISO 8601) */
  lastLoadTime: string | null
  /** Installed plugin version */
  pluginVersion: string | null
  /** Active runtime/config preset */
  activePreset: string | null
  /** Configured preset names */
  presetNames: string[]
  /** Names of installed skills */
  skillNames: string[]
  /** Names of installed bundled plugins (symlinked into plugins dir) */
  pluginNames: string[]
  /** Names of runtime plugins injected into config.plugin[] */
  runtimePluginNames: string[]
  /** Names of installed MCPs */
  mcpNames: string[]
  /** Names of injected agents */
  agentNames: string[]
  /** Names of injected commands */
  commandNames: string[]
  /** Names of injected instructions (basenames) */
  instructionNames: string[]
  /** Names of skills skipped due to local conflicts */
  skippedConflicts: string[]
  /** Names of copied managed skills with staged upstream updates */
  stagedSkillUpdates: string[]
  /** Names of copied managed skills whose live copy has local edits */
  dirtySkillCopies: string[]
  /** Names of disabled assets (type:name format) */
  disabledAssets: string[]
  /** Last error (if any) */
  lastError: string | null
  /** Whether plugins changed and require restart */
  pluginsChanged: boolean
}

/**
 * Asset info for list command
 */
export interface AssetListItem {
  /** Asset type */
  type: "skill" | "agent" | "command" | "instruction" | "plugin" | "mcp"
  /** Asset name */
  name: string
  /** Source: "bundled" or "local" */
  source: "bundled" | "local"
  /** Whether the asset is currently installed/active */
  installed: boolean
  /** Whether the asset is disabled in fellowship.json */
  disabled: boolean
  /** Override status: "local-overrides-bundled" | "bundled-only" | "local-only" */
  overrideStatus: "local-overrides-bundled" | "bundled-only" | "local-only"
  /** Path to the asset file/directory */
  path: string
}

/**
 * Get the path to the plugin status file
 */
export function getStatusFilePath(): string {
  return path.join(STATUS_BASE, `${REPO_SHORT_NAME}.plugin-status.json`)
}

/**
 * Read the current plugin status
 */
export function readPluginStatus(): PluginStatus | null {
  const statusPath = getStatusFilePath()
  try {
    const content = fs.readFileSync(statusPath, "utf-8")
    return JSON.parse(content) as PluginStatus
  } catch {
    return null
  }
}

/**
 * Write plugin status to disk
 */
export function writePluginStatus(status: PluginStatus): void {
  const statusPath = getStatusFilePath()
  const dir = path.dirname(statusPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
  logDebug(`Wrote plugin status to ${statusPath}`)
}

/**
 * Resolve the installed plugin version from its own package.json.
 */
export function getPluginVersion(): string | null {
  try {
    const pkgPath = path.resolve(moduleDir(import.meta.url), "..", "package.json")
    const content = fs.readFileSync(pkgPath, "utf-8")
    const pkg = JSON.parse(content) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

/**
 * Update status after a successful asset load
 */
export function updatePluginStatus(data: {
  activePreset: string | null
  presetNames: string[]
  skillNames: string[]
  pluginNames: string[]
  runtimePluginNames: string[]
  mcpNames: string[]
  agentNames: string[]
  commandNames: string[]
  instructionNames: string[]
  skippedConflicts: string[]
  stagedSkillUpdates: string[]
  dirtySkillCopies: string[]
  disabledAssets: string[]
  pluginsChanged: boolean
}): void {
  const status: PluginStatus = {
    lastLoadTime: new Date().toISOString(),
    pluginVersion: getPluginVersion(),
    activePreset: data.activePreset,
    presetNames: data.presetNames,
    skillNames: data.skillNames,
    pluginNames: data.pluginNames,
    runtimePluginNames: data.runtimePluginNames,
    mcpNames: data.mcpNames,
    agentNames: data.agentNames,
    commandNames: data.commandNames,
    instructionNames: data.instructionNames,
    skippedConflicts: data.skippedConflicts,
    stagedSkillUpdates: data.stagedSkillUpdates,
    dirtySkillCopies: data.dirtySkillCopies,
    disabledAssets: data.disabledAssets,
    lastError: null,
    pluginsChanged: data.pluginsChanged,
  }
  writePluginStatus(status)
}

/**
 * Format plugin status as a human-readable string
 */
export function formatPluginStatus(status: PluginStatus | null): string {
  if (!status) {
    return "Fellowship Status: Plugin has not loaded yet."
  }

  const lines: string[] = [
    "# Fellowship Status",
    "",
  ]

  // Plugin version
  if (status.pluginVersion) {
    lines.push(`**Plugin Version**: ${status.pluginVersion}`)
  }

  const presetNames = status.presetNames ?? []
  lines.push(`**Active Preset**: ${status.activePreset ?? "default"}`)
  if (presetNames.length > 0) {
    lines.push(`**Available Presets**: ${presetNames.join(", ")}`)
  }

  // Last load time
  if (status.lastLoadTime) {
    const date = new Date(status.lastLoadTime)
    const relative = getRelativeTime(date)
    lines.push(`**Last Loaded**: ${date.toLocaleString()} (${relative})`)
  } else {
    lines.push("**Last Loaded**: Never")
  }

  // Error status
  if (status.lastError) {
    lines.push(`**Last Error**: ${status.lastError}`)
  }

  // Installed assets
  lines.push("")
  lines.push("## Installed Assets")
  formatAssetSection(lines, "Skills", status.skillNames)
  formatAssetSection(lines, "Bundled Plugins", status.pluginNames)
  formatAssetSection(lines, "MCPs", status.mcpNames)
  formatAssetSection(lines, "Agents", status.agentNames)
  formatAssetSection(lines, "Commands", status.commandNames)
  formatAssetSection(lines, "Instructions", status.instructionNames)

  // Runtime plugins (injected into config.plugin[])
  if (status.runtimePluginNames.length > 0) {
    lines.push("")
    lines.push("## Runtime Plugins")
    for (const name of status.runtimePluginNames) {
      lines.push(`- ${name}`)
    }
  }

  // Warnings
  const skippedConflicts = status.skippedConflicts ?? []
  if (skippedConflicts.length > 0) {
    lines.push("")
    lines.push(`**Note**: ${skippedConflicts.length} skill(s) skipped due to local conflicts: ${skippedConflicts.join(", ")}`)
  }

  const stagedSkillUpdates = status.stagedSkillUpdates ?? []
  if (stagedSkillUpdates.length > 0) {
    lines.push("")
    lines.push(`**Staged Skill Updates**: ${stagedSkillUpdates.join(", ")}`)
    lines.push("Review staged copies under `~/.config/opencode/skill/_plugins/opencode-config/.updates/` before replacing local edits.")
  }

  const dirtySkillCopies = status.dirtySkillCopies ?? []
  if (dirtySkillCopies.length > 0) {
    lines.push("")
    lines.push(`**Dirty Managed Skill Copies**: ${dirtySkillCopies.join(", ")}`)
  }

  if (status.pluginsChanged) {
    lines.push("")
    lines.push("**Action Required**: Plugins changed. Restart OpenCode to apply.")
  }

  return lines.join("\n")
}

/**
 * Append a labeled asset section to the output lines.
 * Shows "Label: none" for empty lists, or "Label (N):" with bullet items.
 */
function formatAssetSection(lines: string[], label: string, names: string[]): void {
  if (names.length === 0) {
    lines.push(`- ${label}: none`)
  } else {
    lines.push(`- ${label} (${names.length}): ${names.join(", ")}`)
  }
}

/**
 * Get relative time string (e.g., "2 minutes ago")
 */
function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}
