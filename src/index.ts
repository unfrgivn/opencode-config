import { Model, Plugin, type Mcp } from "@opencode/plugin"
import type { Plugin as V2Plugin } from "@opencode/plugin/promise/plugin"
import type { Registration } from "@opencode/plugin/promise/registration"
import { loadConfigWithLocation, type UserConfig } from "./config"
import { discoverAssets, type DiscoveryResult } from "./assets"
import type { AgentConfig } from "./agent"
import type { CommandConfig } from "./command"
import {
  createInstallsForRepo,
  cleanupStaleInstalls,
  hasLocalConflict,
  ignoreGeneratedInstallDirs,
  ensurePluginsDir,
  getExistingInstallsForRepo,
  materializeSchema,
  type InstallMethod,
} from "./install"
import {
  getRemotePluginInstallsForRepo,
  cleanupStalePluginInstallsForRepo,
  findBrokenUnmanagedPluginLinks,
} from "./plugin-install"
import {
  createMcpInstallsForRepo,
  cleanupStaleMcpInstallsForRepo,
  ensureMcpPluginsDirForRepo,
  getExistingMcpInstallsForRepo,
} from "./mcp-install"
import type { PluginInfo } from "./plugin-info"
import { createDisableMatcher, type AssetType } from "./disable"
import { log, logError, logDebug, logWarn } from "./logging"
import * as path from "path"
import { readFileSync } from "fs"
import { filterValidMcps, validateMcpFile, type McpConfig } from "./mcp-schema"
import { updatePluginStatus, formatPluginStatus, readPluginStatus, getPluginVersion } from "./status"
import { deepMerge } from "./deep-merge"
import { lookupAgentAlias } from "./agent-names"
import { recordTuiError, recordTuiSnapshot } from "./tui-state"
import { presetTool } from "./preset-tool"
import { applyAgentPolicy } from "./agent-policy"
import { CompanionActivityTracker, CompanionManager } from "./companion"
import { moduleDir } from "./module-path"
import { VisionToolPlugin } from "./vision-tool-plugin"
import { FellowshipOrchestrationPlugin } from "./orchestration-plugin"
import { claimLocation, isLocalDevRoot, releaseLocation, type InitClaimStore } from "./init-guard"

/** Resolve the package root directory (one level up from dist/) */
const PACKAGE_ROOT = path.resolve(moduleDir(import.meta.url), "..")

/**
 * Claims live on globalThis instead of module state because separately loaded
 * copies of this package (npm cache, a local dev build, or an older version
 * during an update) are distinct module instances that must share one store.
 */
const INIT_GUARD_KEY = Symbol.for("@unfrgivn/opencode-config:initialized")

function getInitStore(): InitClaimStore {
  const existing: unknown = Reflect.get(globalThis, INIT_GUARD_KEY)
  if (existing instanceof Map) return existing

  const store: InitClaimStore = new Map()
  Reflect.set(globalThis, INIT_GUARD_KEY, store)
  return store
}

/** Collected remote agents for config injection */
interface RemoteAgent {
  config: AgentConfig
  source: string
}

/** Collected remote commands for config injection */
interface RemoteCommand {
  config: CommandConfig
  source: string
}

/** Collected remote MCPs for config injection */
interface RemoteMcp {
  config: McpConfig
  source: string
}

interface LoadOutput {
  result: DiscoveryResult
  skippedConflicts: string[]
  totalSkills: number
  remoteAgents: Map<string, RemoteAgent>
  remoteCommands: Map<string, RemoteCommand>
  remoteMcps: Map<string, RemoteMcp>
  remoteInstructions: string[]
  pluginsChanged: boolean
  totalPlugins: number
  totalMcps: number
  dryRun?: DryRunReport
}

const DEFAULT_OPENCODE_AGENTS_TO_DISABLE = ["build", "plan", "general", "explore"] as const

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K]
}

type PermissionInfo = {
  action: string
  resource: string
  effect: "ask" | "allow" | "deny"
}


function toContent(content: string): { content: string } {
  return { content }
}

/** Dry-run report: what would change without actually changing */
export interface DryRunReport {
  wouldInstall: {
    skills: string[]
    plugins: string[]
    mcps: string[]
  }
  wouldRemove: {
    skills: string[]
    plugins: string[]
    mcps: string[]
  }
  wouldInject: {
    agents: string[]
    commands: string[]
    instructions: string[]
  }
  wouldSkip: {
    conflicts: string[]
    disabled: string[]
    overridden: string[]
  }
}


/**
 * Load bundled assets and create symlinks/installs
 */
async function performLoad(
  config: UserConfig,
  configPaths: string[] = [],
  activePreset: string | null = null,
  projectDir: string = process.cwd(),
): Promise<LoadOutput> {
  const disableMatcher = createDisableMatcher(config.disable)

  log(config.dryRun ? "[DRY-RUN] Analyzing bundled configuration..." : "Loading bundled configuration...")

  // Discover assets from package directory
  const result = await discoverAssets(PACKAGE_ROOT, config.agentNames)

  if (!config.dryRun) {
    const brokenUnmanagedLinks = findBrokenUnmanagedPluginLinks()
    if (brokenUnmanagedLinks.length > 0) {
      const plural = brokenUnmanagedLinks.length === 1 ? "" : "s"
      logError(`⚠ Found ${brokenUnmanagedLinks.length} broken unmanaged plugin symlink${plural}; this may affect plugin loading`)
      for (const link of brokenUnmanagedLinks.slice(0, 3)) {
        logError(`  - ${link.path} -> ${link.targetPath}`)
      }
      if (brokenUnmanagedLinks.length > 3) {
        logError(`  ...and ${brokenUnmanagedLinks.length - 3} more`)
      }
    }
  }

  // Track disabled and conflicting assets for dry-run report
  const disabledAssets: string[] = []
  const skippedConflicts: string[] = []
  const stagedSkillUpdates: string[] = []
  const dirtySkillCopies: string[] = []

  // Track skills we're installing (to clean up stale ones)
  const currentSkills = new Set<string>()
  let totalSkills = 0

  // Filter out disabled and conflicting skills
  const skillsToInstall = result.skills.filter((skill) => {
    if (disableMatcher.isDisabled("skill", skill.name)) {
      logDebug(`Skipping disabled skill: ${skill.name}`)
      disabledAssets.push(`skill:${skill.name}`)
      return false
    }
    if (hasLocalConflict(skill.name)) {
      skippedConflicts.push(skill.name)
      return false
    }
    return true
  })

  // Filter disabled plugins
  const pluginsToInstall = result.plugins.filter((plugin) => {
    if (disableMatcher.isDisabled("plugin", plugin.name)) {
      logDebug(`Skipping disabled plugin: ${plugin.name}`)
      disabledAssets.push(`plugin:${plugin.name}`)
      return false
    }
    return true
  })

  // Filter disabled MCPs and validate schema
  const mcpsToInstall = filterValidMcps(
    result.mcps.filter((mcp) => {
      if (disableMatcher.isDisabled("mcp", mcp.name)) {
        logDebug(`Skipping disabled MCP: ${mcp.name}`)
        disabledAssets.push(`mcp:${mcp.name}`)
        return false
      }
      return true
    })
  )

  // Collect agents (filter disabled)
  const remoteAgents = new Map<string, RemoteAgent>()
  const discoveredAgentNames = new Set(result.agents.map((agent) => agent.name))
  const discoveredAgentNameRecord = Object.fromEntries(
    [...discoveredAgentNames].map((agentName) => [agentName, true] as const),
  )

  const unknownAgentOverrides = Object.keys(config.agentOverrides).filter((name) =>
    lookupAgentAlias(discoveredAgentNameRecord, name) === null,
  )
  if (unknownAgentOverrides.length > 0) {
    logWarn(
      `Ignoring ${unknownAgentOverrides.length} unknown agent override${unknownAgentOverrides.length === 1 ? "" : "s"}: ${unknownAgentOverrides.join(", ")}`
    )
  }

  for (const agent of result.agents) {
    if (disableMatcher.isDisabled("agent", agent.name)) {
      logDebug(`Skipping disabled agent: ${agent.name}`)
      disabledAssets.push(`agent:${agent.name}`)
      continue
    }

    const overrideMatch = lookupAgentAlias(config.agentOverrides, agent.name)
    const override = overrideMatch?.value
    const mergedConfig = override === undefined
      ? agent.config
      : deepMerge(agent.config, override) as AgentConfig

    if (override !== undefined) {
      logDebug(`Applied agent override for '${agent.name}' via key '${overrideMatch?.key}'`)
    }

    remoteAgents.set(agent.name, {
      config: mergedConfig,
      source: result.shortName,
    })
  }

  // Collect commands (filter disabled)
  const remoteCommands = new Map<string, RemoteCommand>()
  for (const command of result.commands) {
    if (disableMatcher.isDisabled("command", command.name)) {
      logDebug(`Skipping disabled command: ${command.name}`)
      disabledAssets.push(`command:${command.name}`)
      continue
    }
    remoteCommands.set(command.name, {
      config: command.config,
      source: result.shortName,
    })
  }

  // Collect MCPs for config injection
  const remoteMcps = new Map<string, RemoteMcp>()
  for (const mcp of mcpsToInstall) {
    const validation = validateMcpFile(mcp.path)
    if (!validation.valid || !validation.config) {
      continue
    }

    remoteMcps.set(mcp.name, {
      config: validation.config,
      source: result.shortName,
    })
  }

  // Collect instructions (filter disabled)
  const remoteInstructions: string[] = []
  for (const instruction of result.instructions) {
    if (disableMatcher.isDisabled("instruction", instruction.name)) {
      logDebug(`Skipping disabled instruction: ${instruction.name}`)
      disabledAssets.push(`instruction:${instruction.name}`)
      continue
    }
    remoteInstructions.push(instruction.path)
  }

  let appliedAgentPolicyCount = 0
  const availableMcpNames = [...remoteMcps.keys()]
  for (const [name, remoteAgent] of remoteAgents) {
    if (remoteAgent.config.policy === undefined) continue

    remoteAgent.config = applyAgentPolicy(remoteAgent.config, { availableMcps: availableMcpNames })
    appliedAgentPolicyCount++
    logDebug(`Applied agent policy controls for '${name}'`)
  }

  // ============ DRY-RUN MODE ============
  if (config.dryRun) {
    // Get existing installs to calculate what would be removed
    const existingSkills = getExistingInstallsForRepo(result.shortName)
    const existingPlugins = new Set(getRemotePluginInstallsForRepo(result.shortName))
    const existingMcps = getExistingMcpInstallsForRepo(result.shortName)

    // Calculate what would be installed (not already present)
    const wouldInstallSkills = skillsToInstall
      .map(s => s.name)
      .filter(name => !existingSkills.has(`${result.shortName}/${name}`))
    const wouldInstallPlugins = pluginsToInstall
      .map(p => p.name)
      .filter(name => !existingPlugins.has(name))
    const wouldInstallMcps = mcpsToInstall
      .map(m => m.name)
      .filter(name => !existingMcps.has(name))

    // Calculate what would be removed (exists but not in current set)
    const currentSkillNames = new Set(skillsToInstall.map(s => `${result.shortName}/${s.name}`))
    const currentPluginNames = new Set(pluginsToInstall.map(p => p.name))
    const currentMcpNames = new Set(mcpsToInstall.map(m => m.relativePath))

    const wouldRemoveSkills = [...existingSkills.keys()].filter(k => !currentSkillNames.has(k))
    const wouldRemovePlugins = [...existingPlugins].filter(p => !currentPluginNames.has(p))
    const wouldRemoveMcps = [...existingMcps.keys()].filter(m => !currentMcpNames.has(m))

    const dryRunReport: DryRunReport = {
      wouldInstall: {
        skills: wouldInstallSkills,
        plugins: wouldInstallPlugins,
        mcps: wouldInstallMcps,
      },
      wouldRemove: {
        skills: wouldRemoveSkills,
        plugins: wouldRemovePlugins,
        mcps: wouldRemoveMcps,
      },
      wouldInject: {
        agents: [...remoteAgents.keys()],
        commands: [...remoteCommands.keys()],
        instructions: remoteInstructions.map(p => p.split('/').pop() || p),
      },
      wouldSkip: {
        conflicts: skippedConflicts,
        disabled: disabledAssets,
        overridden: [], // Filled in by config hook, not available here
      },
    }

    // Log dry-run summary
    log("[DRY-RUN] === What Would Change ===")
    if (dryRunReport.wouldInstall.skills.length > 0) {
      log(`[DRY-RUN] Would install ${dryRunReport.wouldInstall.skills.length} skills: ${dryRunReport.wouldInstall.skills.join(', ')}`)
    }
    if (dryRunReport.wouldInstall.plugins.length > 0) {
      log(`[DRY-RUN] Would install ${dryRunReport.wouldInstall.plugins.length} plugins: ${dryRunReport.wouldInstall.plugins.join(', ')}`)
    }
    if (dryRunReport.wouldInstall.mcps.length > 0) {
      log(`[DRY-RUN] Would install ${dryRunReport.wouldInstall.mcps.length} MCPs: ${dryRunReport.wouldInstall.mcps.join(', ')}`)
    }
    if (dryRunReport.wouldRemove.skills.length > 0) {
      log(`[DRY-RUN] Would remove ${dryRunReport.wouldRemove.skills.length} skills: ${dryRunReport.wouldRemove.skills.join(', ')}`)
    }
    if (dryRunReport.wouldRemove.plugins.length > 0) {
      log(`[DRY-RUN] Would remove ${dryRunReport.wouldRemove.plugins.length} plugins: ${dryRunReport.wouldRemove.plugins.join(', ')}`)
    }
    if (dryRunReport.wouldRemove.mcps.length > 0) {
      log(`[DRY-RUN] Would remove ${dryRunReport.wouldRemove.mcps.length} MCPs: ${dryRunReport.wouldRemove.mcps.join(', ')}`)
    }
    if (dryRunReport.wouldInject.agents.length > 0) {
      log(`[DRY-RUN] Would inject ${dryRunReport.wouldInject.agents.length} agents: ${dryRunReport.wouldInject.agents.join(', ')}`)
    }
    if (dryRunReport.wouldInject.commands.length > 0) {
      log(`[DRY-RUN] Would inject ${dryRunReport.wouldInject.commands.length} commands: ${dryRunReport.wouldInject.commands.join(', ')}`)
    }
    if (dryRunReport.wouldInject.instructions.length > 0) {
      log(`[DRY-RUN] Would inject ${dryRunReport.wouldInject.instructions.length} instructions: ${dryRunReport.wouldInject.instructions.join(', ')}`)
    }
    if (dryRunReport.wouldSkip.conflicts.length > 0) {
      log(`[DRY-RUN] Would skip ${dryRunReport.wouldSkip.conflicts.length} due to conflicts: ${dryRunReport.wouldSkip.conflicts.join(', ')}`)
    }
    if (dryRunReport.wouldSkip.disabled.length > 0) {
      log(`[DRY-RUN] Would skip ${dryRunReport.wouldSkip.disabled.length} disabled assets: ${dryRunReport.wouldSkip.disabled.join(', ')}`)
    }
    log("[DRY-RUN] === No changes made ===")

    return {
      result,
      skippedConflicts,
      totalSkills: skillsToInstall.length,
      remoteAgents,
      remoteCommands,
      remoteMcps,
      remoteInstructions,
      pluginsChanged: false,
      totalPlugins: pluginsToInstall.length,
      totalMcps: mcpsToInstall.length,
      dryRun: dryRunReport,
    }
  }

  // Install skills (using configured method: link or copy)
  const filteredResult = { ...result, skills: skillsToInstall }
  const installResults = await createInstallsForRepo(filteredResult, config.installMethod)

  // Track which skills we installed
  for (const sr of installResults) {
    if (!sr.error) {
      currentSkills.add(`${result.shortName}/${sr.skillName}`)
      totalSkills++
      if (sr.staged) stagedSkillUpdates.push(sr.skillName)
      if (sr.dirty) dirtySkillCopies.push(sr.skillName)
    } else {
      logError(`✗ Failed to install skill ${sr.skillName}: ${sr.error}`)
    }
  }

  log(`✓ ${result.shortName} - ${totalSkills} skills`)

  // Clean up stale installs (works for both symlinks and copied directories)
  const cleanup = cleanupStaleInstalls(currentSkills)
  if (cleanup.removed.length > 0) {
    log(`Cleaned up ${cleanup.removed.length} stale skill installs`)
  }

  // Log conflicts
  for (const conflict of skippedConflicts) {
    log(`⚠ Conflict: '${conflict}' exists locally, skipping`)
  }

  for (const staged of stagedSkillUpdates) {
    log(`⚠ Staged update for copied skill '${staged}' because the installed copy has local edits`)
  }

  if (remoteAgents.size > 0) {
    log(`Discovered ${remoteAgents.size} remote agents`)
  }

  if (appliedAgentPolicyCount > 0) {
    log(`Applied ${appliedAgentPolicyCount} agent policy control${appliedAgentPolicyCount === 1 ? "" : "s"}`)
  }

  if (remoteCommands.size > 0) {
    log(`Discovered ${remoteCommands.size} remote commands`)
  }

  if (remoteMcps.size > 0) {
    log(`Discovered ${remoteMcps.size} remote MCP configs`)
  }

  if (remoteInstructions.length > 0) {
    log(`Discovered ${remoteInstructions.length} remote instructions`)
  }

  // Get existing plugin installs before making changes
  const existingPluginInstalls = new Set(getRemotePluginInstallsForRepo(result.shortName))

  // V2 loads this package as a single plugin entry. Installing bundled plugin
  // files into ~/.config/opencode/plugin makes OpenCode auto-load them as
  // standalone config-directory plugins, which produces schema errors.
  const newPluginInstalls = new Set<string>()
  if (pluginsToInstall.length > 0) {
    log(`Discovered ${pluginsToInstall.length} bundled plugins`)
  }

  // Clean up stale plugin installs
  const pluginCleanup = cleanupStalePluginInstallsForRepo(result.shortName, newPluginInstalls)
  if (pluginCleanup.removed.length > 0) {
    log(`Cleaned up ${pluginCleanup.removed.length} stale plugin installs`)
  }

  // Detect if plugins changed (for restart notification)
  const pluginsChanged = !setsEqual(existingPluginInstalls, newPluginInstalls)
  const totalPlugins = newPluginInstalls.size

  // Install MCPs (using configured method: link or copy)
  const newMcpInstalls = new Set<string>()
  if (mcpsToInstall.length > 0) {
    ensureMcpPluginsDirForRepo(result.shortName)
    const mcpInstallResults = createMcpInstallsForRepo(result.shortName, mcpsToInstall, undefined, config.installMethod)
    for (let i = 0; i < mcpInstallResults.length; i++) {
      const sr = mcpInstallResults[i]
      const mcp = mcpsToInstall[i]
      if (!sr.error) {
        newMcpInstalls.add(mcp.relativePath)
      } else {
        logError(`✗ Failed to install MCP ${sr.mcpName}: ${sr.error}`)
      }
    }
    log(`Discovered ${mcpsToInstall.length} remote MCP configs`)
  }

  // Clean up stale MCP installs
  const mcpCleanup = cleanupStaleMcpInstallsForRepo(result.shortName, newMcpInstalls)
  if (mcpCleanup.removed.length > 0) {
    log(`Cleaned up ${mcpCleanup.removed.length} stale MCP installs`)
  }

  const totalMcps = newMcpInstalls.size

  const skillNames = skillsToInstall.map(s => s.name)
  const pluginNames = pluginsToInstall.map(p => p.name)
  const runtimePluginNames = [
    "@unfrgivn/opencode-config:orchestration",
    ...(config.orchestration.features.vision ? ["@unfrgivn/opencode-config:vision-tool"] : []),
  ]
  const mcpNames = [...remoteMcps.keys()]
  const agentNames = [...remoteAgents.keys()]
  const commandNames = [...remoteCommands.keys()]
  const instructionNames = remoteInstructions.map(p => p.split("/").pop() ?? p)
  const agentModels = getAgentModels(remoteAgents, config)

  // Update plugin status for status command and TUI sidebar
  updatePluginStatus({
    activePreset,
    presetNames: Object.keys(config.presets),
    skillNames,
    pluginNames,
    runtimePluginNames,
    mcpNames,
    agentNames,
    commandNames,
    instructionNames,
    skippedConflicts,
    stagedSkillUpdates,
    dirtySkillCopies,
    disabledAssets,
    pluginsChanged,
  })
  recordTuiSnapshot({
    pluginVersion: getPluginVersion(),
    configPaths,
    activePreset,
    presetNames: Object.keys(config.presets),
    agentModels,
    skillNames,
    pluginNames,
    runtimePluginNames,
    mcpNames,
    agentNames,
    commandNames,
    instructionNames,
    skippedConflicts,
    stagedSkillUpdates,
    dirtySkillCopies,
    disabledAssets,
    pluginsChanged,
  }, projectDir)

  return {
    result,
    skippedConflicts,
    totalSkills,
    remoteAgents,
    remoteCommands,
    remoteMcps,
    remoteInstructions,
    pluginsChanged,
    totalPlugins,
    totalMcps,
  }
}

function getAgentModels(remoteAgents: Map<string, RemoteAgent>, config: UserConfig): Record<string, string> {
  const agentModels: Record<string, string> = {}

  for (const [name, { config: agentConfig }] of remoteAgents) {
    const modelOverride = lookupAgentAlias(config.models, name)?.value
    const model = modelOverride || agentConfig.model
    agentModels[name] = typeof model === "string" && model.length > 0 ? model : "default"
  }

  return agentModels
}

/**
 * Check if two sets are equal
 */
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

function disableDefaultOpencodeAgents(
  config: Record<string, unknown>
): number {
  if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
    logError("config.agent is not an object, skipping default agent disable")
    return 0
  }

  if (config.agent === undefined) {
    config.agent = {}
  }

  const agentConfig = config.agent as Record<string, unknown>
  let changedCount = 0

  for (const agentName of DEFAULT_OPENCODE_AGENTS_TO_DISABLE) {
    const current = agentConfig[agentName]
    const currentRecord =
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)
        : {}
    const wasSubagent = currentRecord.mode === "subagent"
    const wasHidden = currentRecord.hidden === true

    agentConfig[agentName] = {
      ...currentRecord,
      mode: "subagent",
      hidden: true,
      description:
        typeof currentRecord.description === "string"
          ? currentRecord.description
          : "Hidden by @unfrgivn/opencode-config plugin",
    }

    if (!wasSubagent || !wasHidden) {
      changedCount++
    }
  }

  return changedCount
}

function toV2Permissions(permission: AgentConfig["permission"]): PermissionInfo[] {
  if (permission === undefined) return []
  if (typeof permission === "string") return [{ action: "*", resource: "*", effect: permission }]

  const permissions: PermissionInfo[] = []
  for (const [action, rule] of Object.entries(permission)) {
    if (typeof rule === "string") {
      permissions.push({ action, resource: "*", effect: rule })
      continue
    }
    for (const [resource, effect] of Object.entries(rule)) {
      permissions.push({ action, resource, effect })
    }
  }
  return permissions
}

function applyAgentConfig(draft: Record<string, unknown>, name: string, agentConfig: AgentConfig, modelOverride?: string): void {
  draft.name = name
  if (agentConfig.description !== undefined) draft.description = agentConfig.description
  if (agentConfig.prompt !== undefined) draft.system = agentConfig.prompt
  if (agentConfig.mode !== undefined) draft.mode = agentConfig.mode
  if (agentConfig.disable !== undefined) draft.hidden = agentConfig.disable
  if (agentConfig.color !== undefined) draft.color = agentConfig.color
  const steps = agentConfig.steps ?? agentConfig.maxSteps
  if (steps !== undefined) draft.steps = steps

  const model = modelOverride || agentConfig.model
  if (model) draft.model = Model.Ref.parse(model)

  const permissions = toV2Permissions(agentConfig.permission)
  if (permissions.length > 0) draft.permissions = permissions

  const request = typeof draft.request === "object" && draft.request !== null
    ? draft.request as Record<string, unknown>
    : {}
  const body = typeof request.body === "object" && request.body !== null
    ? request.body as Record<string, unknown>
    : {}

  if (agentConfig.temperature !== undefined) body.temperature = agentConfig.temperature
  if (agentConfig.top_p !== undefined) body.top_p = agentConfig.top_p
  if (agentConfig.options !== undefined) {
    request.body = { ...body, ...agentConfig.options }
  } else {
    request.body = body
  }
  draft.request = request
}

function applyCommandConfig(draft: Record<string, unknown>, name: string, commandConfig: CommandConfig): void {
  draft.name = name
  draft.template = commandConfig.template
  if (commandConfig.description !== undefined) draft.description = commandConfig.description
  if (commandConfig.agent !== undefined) draft.agent = commandConfig.agent
  if (commandConfig.model !== undefined) draft.model = Model.Ref.parse(commandConfig.model)
  if (commandConfig.subtask !== undefined) draft.subtask = commandConfig.subtask
}

function toV2McpConfig(config: McpConfig): Mcp.ServerConfig {
  if (config.type === "local") {
    return {
      type: "local",
      command: config.command,
      ...(config.environment === undefined ? {} : { environment: config.environment }),
      ...(config.enabled === undefined ? {} : { disabled: !config.enabled }),
      ...(config.timeout === undefined ? {} : { timeout: { catalog: config.timeout, execution: config.timeout } }),
    }
  }

  return {
    type: "remote",
    url: config.url,
    ...(config.headers === undefined ? {} : { headers: config.headers }),
    ...(config.enabled === undefined ? {} : { disabled: !config.enabled }),
  }
}

/**
 * Fellowship OpenCode Config Plugin
 *
 * Loads bundled configuration from the bundled opencode-config package,
 * making skills, agents, commands, plugins, instructions, and MCPs available
 * to all users without polluting their local config directories.
 */
async function setupFellowshipConfigPlugin(ctx: Parameters<V2Plugin["setup"]>[0]): Promise<() => Promise<void>> {
  const projectDir = ctx.location.directory

  const initStore = getInitStore()
  const outcome = claimLocation(initStore, projectDir, PACKAGE_ROOT)
  if (outcome.status === "yielded") {
    logDebug(`Skipping duplicate initialization for ${projectDir} (local dev build already loaded from ${outcome.holder.packageRoot})`)
    return async () => {}
  }
  const { claim, replaced } = outcome
  if (replaced) {
    logDebug(isLocalDevRoot(PACKAGE_ROOT) && !isLocalDevRoot(replaced.packageRoot)
      ? `Local dev build taking priority over npm-cached instance at ${replaced.packageRoot}`
      : `Replacing earlier instance for ${projectDir} (${replaced.packageRoot})`)
  }

  try {
  // Load user configuration
  const { config: userConfig, configPaths, activePreset } = loadConfigWithLocation(projectDir)
  const companionManager = new CompanionManager(
    `proc_${process.pid}_${ctx.location.project.id}`,
    projectDir,
    userConfig.companion,
    {
      agentNameTheme: userConfig.agentNames,
    },
  )
  const companionActivity = new CompanionActivityTracker(companionManager)

  // Log the installation method being used
  if (userConfig.installMethod === "copy") {
    logDebug("Using copy mode for skill/plugin/MCP installation")
  } else {
    logDebug("Using symlink mode for skill/plugin/MCP installation")
  }

  // Ensure the _plugins directory exists
  ensurePluginsDir()

  try {
    const writtenIgnoreFiles = ignoreGeneratedInstallDirs()
    for (const ignoreFile of writtenIgnoreFiles) {
      logDebug(`Created generated-install ignore file at ${ignoreFile}`)
    }
  } catch (error) {
    logWarn(`Generated-install ignore setup failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Materialize JSON schema for IDE autocompletion
  const schemaResult = materializeSchema(PACKAGE_ROOT)
  if (schemaResult.error) {
    logWarn(`Schema materialization failed: ${schemaResult.error}`)
  }

  // Load bundled assets from bundled package
  const {
    totalSkills,
    skippedConflicts,
    remoteAgents,
    remoteCommands,
    remoteMcps,
    remoteInstructions,
    pluginsChanged,
    totalPlugins,
    totalMcps,
  } = await performLoad(userConfig, configPaths, activePreset, projectDir)

  companionManager.onLoad()

  // Notify user if plugins changed (requires restart to take effect)
  if (pluginsChanged) {
    log("⚠ Plugin changes detected. Restart OpenCode to apply.")
  }

  // Build summary message
  const skippedCount = skippedConflicts.length
  const parts: string[] = []
  if (totalSkills > 0) parts.push(`${totalSkills} skills`)
  if (totalPlugins > 0) parts.push(`${totalPlugins} plugins`)
  if (totalMcps > 0) parts.push(`${totalMcps} MCPs`)
  if (remoteInstructions.length > 0) parts.push(`${remoteInstructions.length} instructions`)

  let message: string
  if (parts.length === 0) {
    message = "No remote config found"
  } else {
    message = `${parts.join(", ")} available`
    if (skippedCount > 0) {
      message += ` (${skippedCount} skills skipped due to conflicts)`
    }
  }
  log(message)

  const registrations: Registration[] = []
  const runtimeCleanups: Array<() => Promise<void> | void> = []

  if (userConfig.orchestration.features.vision) {
    const cleanup = await VisionToolPlugin(ctx)
    if (cleanup) runtimeCleanups.push(cleanup)
  }
  const orchestrationCleanup = await FellowshipOrchestrationPlugin.setup(ctx)
  if (orchestrationCleanup) runtimeCleanups.push(orchestrationCleanup)

  registrations.push(await ctx.tool.transform((tools) => {
    tools.add(presetTool)
  }))

  registrations.push(await ctx.agent.transform((agents) => {
    for (const agentName of DEFAULT_OPENCODE_AGENTS_TO_DISABLE) {
      agents.update(agentName, (agent) => {
        agent.mode = "subagent"
        agent.hidden = true
        agent.description = agent.description ?? "Hidden by @unfrgivn/opencode-config plugin"
      })
    }

    let injectedAgentCount = 0
    let modelOverrideCount = 0
    for (const [name, { config: agentConfig }] of remoteAgents) {
      if (agents.get(name) !== undefined) continue

      const modelOverrideMatch = lookupAgentAlias(userConfig.models, name)
      const modelOverride = modelOverrideMatch?.value || undefined
      agents.update(name, (agent) => applyAgentConfig(agent as unknown as Record<string, unknown>, name, agentConfig, modelOverride))
      if (modelOverride !== undefined) modelOverrideCount++
      injectedAgentCount++
    }

    if (modelOverrideCount > 0) log(`Applied ${modelOverrideCount} model override(s) from fellowship.json`)
    if (injectedAgentCount > 0) log(`Injected ${injectedAgentCount} remote agents into config`)
  }))

  registrations.push(await ctx.command.transform((commands) => {
    let injectedCommandCount = 0
    for (const [name, { config: commandConfig }] of remoteCommands) {
      const commandDraft: object = commands
      if ("get" in commandDraft && typeof commandDraft.get === "function" && "update" in commandDraft && typeof commandDraft.update === "function") {
        if (commandDraft.get(name) !== undefined) continue
        commandDraft.update(name, (command: unknown) => applyCommandConfig(command as Record<string, unknown>, name, commandConfig))
        injectedCommandCount++
      } else if ("add" in commandDraft && typeof commandDraft.add === "function") {
        commandDraft.add({
          name,
          description: commandConfig.description,
          execute: async (input: { sessionID: string }) => {
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: commandConfig.template,
            })
          },
        })
        injectedCommandCount++
      }
    }
    if (injectedCommandCount > 0) log(`Injected ${injectedCommandCount} remote commands into config`)
  }))

  registrations.push(await ctx.mcp.transform((mcps) => {
    let injectedMcpCount = 0
    for (const [name, { config: mcpConfig }] of remoteMcps) {
      if (mcps.get(name) !== undefined) continue
      mcps.set(name, toV2McpConfig(mcpConfig))
      injectedMcpCount++
    }
    if (injectedMcpCount > 0) log(`Injected ${injectedMcpCount} remote MCPs into config`)
  }))

  registrations.push(await ctx.session.hook("context", (event) => {
    companionActivity.onContext(event)
    for (const instructionPath of remoteInstructions) {
      try {
        event.system.push({ type: "text", text: readFileSync(instructionPath, "utf-8") })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logWarn(`Could not load remote instruction '${instructionPath}': ${message}`)
      }
    }
  }))

  const controller = new AbortController()
  const eventTask = (async () => {
    try {
      for await (const rawEvent of ctx.event.subscribe({ signal: controller.signal })) {
        companionActivity.onEvent(rawEvent)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        logWarn(`Event subscription stopped: ${message}`)
      }
    }
  })()

  return async () => {
    try {
      controller.abort()
      await eventTask
      for (const registration of registrations.reverse()) {
        await registration.dispose()
      }
      for (const cleanup of runtimeCleanups.reverse()) {
        await cleanup()
      }
    } finally {
      companionManager.onExit()
      releaseLocation(initStore, projectDir, claim)
    }
  }
  } catch (error) {
    recordTuiError(error instanceof Error ? error.message : String(error), projectDir)
    releaseLocation(initStore, projectDir, claim)
    throw error
  }
}

export const FellowshipConfigPlugin = Plugin.define({
  id: "@unfrgivn/opencode-config",
  setup: setupFellowshipConfigPlugin,
})

// Keep backward compatible export name for consumers that import it directly.
export const RemoteSkillsPlugin = FellowshipConfigPlugin

export default FellowshipConfigPlugin

// Export types and utilities for external use
export type { UserConfig } from "./config"
export type { DiscoveryResult, SkillInfo, AgentInfo, CommandInfo, McpInfo } from "./assets"
export type { AgentConfig } from "./agent"
export type { CommandConfig } from "./command"
export type { DisableMatcher, AssetType } from "./disable"

// Export for testing
export { performLoad }
