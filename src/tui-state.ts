import { createHash, randomUUID } from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { REPO_SHORT_NAME, STORAGE_DIR_NAME } from "./constants"

export interface TuiSnapshot {
  version: 1
  updatedAt: string
  pluginVersion: string | null
  activePreset: string | null
  presetNames: string[]
  configPaths: string[]
  agentModels: Record<string, string>
  assetCounts: {
    skills: number
    plugins: number
    runtimePlugins: number
    mcps: number
    agents: number
    commands: number
    instructions: number
  }
  warnings: {
    skippedConflicts: number
    stagedSkillUpdates: number
    dirtySkillCopies: number
    disabledAssets: number
    pluginsChanged: boolean
    lastError: string | null
  }
}

export interface TuiSnapshotInput {
  pluginVersion: string | null
  activePreset: string | null
  presetNames: string[]
  configPaths: string[]
  agentModels: Record<string, string>
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
  lastError?: string | null
}

function dataDir(): string {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

function projectScope(projectDir: string): string {
  return createHash("sha256").update(path.resolve(projectDir)).digest("hex").slice(0, 12)
}

export function getTuiStatePath(projectDir: string = process.cwd()): string {
  return path.join(
    dataDir(),
    "opencode",
    "storage",
    STORAGE_DIR_NAME,
    projectScope(projectDir),
    `${REPO_SHORT_NAME}.tui-state.json`,
  )
}

export function createEmptyTuiSnapshot(): TuiSnapshot {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    pluginVersion: null,
    activePreset: null,
    presetNames: [],
    configPaths: [],
    agentModels: {},
    assetCounts: {
      skills: 0,
      plugins: 0,
      runtimePlugins: 0,
      mcps: 0,
      agents: 0,
      commands: 0,
      instructions: 0,
    },
    warnings: {
      skippedConflicts: 0,
      stagedSkillUpdates: 0,
      dirtySkillCopies: 0,
      disabledAssets: 0,
      pluginsChanged: false,
      lastError: null,
    },
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item
  }
  return result
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function parseSnapshot(content: string): TuiSnapshot {
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createEmptyTuiSnapshot()

  const record = parsed as Record<string, unknown>
  if (record.version !== 1) return createEmptyTuiSnapshot()

  const assetCounts =
    record.assetCounts && typeof record.assetCounts === "object" && !Array.isArray(record.assetCounts)
      ? (record.assetCounts as Record<string, unknown>)
      : {}
  const warnings =
    record.warnings && typeof record.warnings === "object" && !Array.isArray(record.warnings)
      ? (record.warnings as Record<string, unknown>)
      : {}

  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    pluginVersion: typeof record.pluginVersion === "string" ? record.pluginVersion : null,
    activePreset: typeof record.activePreset === "string" ? record.activePreset : null,
    presetNames: stringArray(record.presetNames),
    configPaths: stringArray(record.configPaths),
    agentModels: stringRecord(record.agentModels),
    assetCounts: {
      skills: numberValue(assetCounts.skills),
      plugins: numberValue(assetCounts.plugins),
      runtimePlugins: numberValue(assetCounts.runtimePlugins),
      mcps: numberValue(assetCounts.mcps),
      agents: numberValue(assetCounts.agents),
      commands: numberValue(assetCounts.commands),
      instructions: numberValue(assetCounts.instructions),
    },
    warnings: {
      skippedConflicts: numberValue(warnings.skippedConflicts),
      stagedSkillUpdates: numberValue(warnings.stagedSkillUpdates),
      dirtySkillCopies: numberValue(warnings.dirtySkillCopies),
      disabledAssets: numberValue(warnings.disabledAssets),
      pluginsChanged: warnings.pluginsChanged === true,
      lastError: typeof warnings.lastError === "string" ? warnings.lastError : null,
    },
  }
}

export function readTuiSnapshot(projectDir: string = process.cwd()): TuiSnapshot {
  try {
    return parseSnapshot(fs.readFileSync(getTuiStatePath(projectDir), "utf-8"))
  } catch {
    return createEmptyTuiSnapshot()
  }
}

export async function readTuiSnapshotAsync(projectDir: string = process.cwd()): Promise<TuiSnapshot> {
  try {
    return parseSnapshot(await fs.promises.readFile(getTuiStatePath(projectDir), "utf-8"))
  } catch {
    return createEmptyTuiSnapshot()
  }
}

function writeTuiSnapshot(snapshot: TuiSnapshot, projectDir: string): void {
  const statePath = getTuiStatePath(projectDir)
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  const tempPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`)
    fs.renameSync(tempPath, statePath)
  } finally {
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // State is best-effort; a stale temporary file is harmless.
    }
  }
}

export function recordTuiError(message: string, projectDir: string = process.cwd()): void {
  try {
    const snapshot = readTuiSnapshot(projectDir)
    snapshot.updatedAt = new Date().toISOString()
    snapshot.warnings.lastError = message
    writeTuiSnapshot(snapshot, projectDir)
  } catch {
    // The sidebar is best-effort status, never a startup blocker.
  }
}

export function recordTuiSnapshot(input: TuiSnapshotInput, projectDir: string = process.cwd()): void {
  const snapshot: TuiSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pluginVersion: input.pluginVersion,
    activePreset: input.activePreset,
    presetNames: [...input.presetNames],
    configPaths: [...input.configPaths],
    agentModels: { ...input.agentModels },
    assetCounts: {
      skills: input.skillNames.length,
      plugins: input.pluginNames.length,
      runtimePlugins: input.runtimePluginNames.length,
      mcps: input.mcpNames.length,
      agents: input.agentNames.length,
      commands: input.commandNames.length,
      instructions: input.instructionNames.length,
    },
    warnings: {
      skippedConflicts: input.skippedConflicts.length,
      stagedSkillUpdates: input.stagedSkillUpdates.length,
      dirtySkillCopies: input.dirtySkillCopies.length,
      disabledAssets: input.disabledAssets.length,
      pluginsChanged: input.pluginsChanged,
      lastError: input.lastError ?? null,
    },
  }

  try {
    const existing = readTuiSnapshot(projectDir)
    const comparableSnapshot = { ...snapshot, updatedAt: existing.updatedAt }
    if (JSON.stringify(existing) === JSON.stringify(comparableSnapshot)) return

    writeTuiSnapshot(snapshot, projectDir)
  } catch {
    // The sidebar is best-effort status, never a startup blocker.
  }
}
