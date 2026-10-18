import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { getAgentNameTable, resolveAgentName, type AgentNameTheme } from "./agent-names"
import type { UserConfig } from "./config"
import { logDebug, logWarn } from "./logging"
import { moduleDir } from "./module-path"
import { STORAGE_DIR_NAME } from "./constants"
import { dataHomeDir } from "./paths"
import {
  decideCompanionLaunch,
  parseCompanionSpawnRecord,
  type CompanionSpawnRecord,
} from "./companion-launch"
import { getPluginVersion } from "./status"

export type CompanionConfig = UserConfig["companion"]

export interface CompanionSessionState {
  session_id: string
  cwd: string
  active_agents: string[]
  active_agent_details: CompanionAgentState[]
  status: "idle" | "busy" | "waiting-input"
  pid: number
  updated_at: string
  config: CompanionRuntimeConfig
}

export interface CompanionAgentState {
  key: string
  role: string | null
  canonical: string | null
  display_name: string
  theme: AgentNameTheme
  art_key: string
  art_path: string | null
  art_frame_count: number
  art_frame_width: number
  art_frame_height: number
}

export interface CompanionRuntimeConfig {
  enabled: boolean
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  size: "small" | "medium" | "large"
  gifPack: "default"
  loopStyle: "classic" | "smooth"
  speed: number
  debug: boolean
  agentNameTheme: AgentNameTheme
  artBasePath: string | null
}

export interface CompanionState {
  version: 1
  sessions: CompanionSessionState[]
  config: CompanionRuntimeConfig
}

const activeManagers = new Set<CompanionManager>()
let activeExitListener: (() => void) | null = null
const COMPANION_ART_FRAME_COUNT = 4
const COMPANION_ART_FRAME_WIDTH = 128
const COMPANION_ART_FRAME_HEIGHT = 160

function getStorageDir(): string {
  return path.join(dataHomeDir(), "opencode", "storage", STORAGE_DIR_NAME)
}

export function getCompanionStatePath(): string {
  return path.join(getStorageDir(), "opencode-config.companion-state.json")
}

export function getCompanionPidPath(): string {
  return path.join(getStorageDir(), "opencode-config.companion.pid")
}

export function getCompanionSpawnRecordPath(): string {
  return path.join(getStorageDir(), "opencode-config.companion-spawn.json")
}

export function getDefaultCompanionBinaryPath(): string {
  const binaryName = os.platform() === "win32" ? "fellowship-companion.exe" : "fellowship-companion"
  return path.join(getStorageDir(), "bin", binaryName)
}

export function getBundledCompanionBinaryPath(): string | null {
  if (os.platform() === "win32") return null
  const candidate = path.resolve(moduleDir(import.meta.url), "..", "companion", "bin", "fellowship-companion")
  return fs.existsSync(candidate) ? candidate : null
}

export function getCompanionArtBasePath(): string | null {
  const candidate = path.resolve(moduleDir(import.meta.url), "..", "companion", "art")
  return fs.existsSync(candidate) ? candidate : null
}

export function resolveCompanionBinaryPath(config: CompanionConfig): string | null {
  const configured = config.binaryPath?.trim()
  if (configured && configured.length > 0) return fs.existsSync(configured) ? configured : null

  const managed = getDefaultCompanionBinaryPath()
  if (fs.existsSync(managed)) return managed

  return getBundledCompanionBinaryPath()
}

export function readCompanionState(): CompanionState {
  const fallback: CompanionState = {
    version: 1,
    sessions: [],
    config: normalizeCompanionConfig({ enabled: false }),
  }

  try {
    const raw = fs.readFileSync(getCompanionStatePath(), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback
    const record = parsed as Record<string, unknown>
    if (record.version !== 1 || !Array.isArray(record.sessions)) return fallback
    return parsed as CompanionState
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined
    if (code !== "ENOENT") logDebug(`Could not read companion state: ${err instanceof Error ? err.message : String(err)}`)
    return fallback
  }
}

export function normalizeCompanionConfig(
  config: Partial<CompanionConfig>,
  options: { agentNameTheme?: AgentNameTheme } = {},
): CompanionRuntimeConfig {
  return {
    enabled: config.enabled === true,
    position: config.position ?? "bottom-right",
    size: config.size ?? "medium",
    gifPack: config.gifPack ?? "default",
    loopStyle: config.loopStyle ?? "classic",
    speed: config.speed ?? 1,
    debug: config.debug === true,
    agentNameTheme: options.agentNameTheme ?? "descriptive",
    artBasePath: getCompanionArtBasePath(),
  }
}

export function formatCompanionAgent(agentName: string, theme: AgentNameTheme): CompanionAgentState {
  const trimmed = agentName.trim()
  const special = trimmed === "intro" || trimmed === "input" ? trimmed : null
  const artBasePath = getCompanionArtBasePath()
  if (special) {
    return {
      key: special,
      role: special,
      canonical: special,
      display_name: special === "intro" ? "intro" : "input",
      theme,
      art_key: `common/${special}`,
      art_path: artBasePath ? path.join(artBasePath, "common", `${special}.svg`) : null,
      art_frame_count: COMPANION_ART_FRAME_COUNT,
      art_frame_width: COMPANION_ART_FRAME_WIDTH,
      art_frame_height: COMPANION_ART_FRAME_HEIGHT,
    }
  }

  const entry = getAgentNameTable().find((item) =>
    item.canonical === trimmed || item.themed.descriptive === trimmed || item.themed.lotr === trimmed
  )
  if (!entry) {
    return {
      key: trimmed,
      role: null,
      canonical: null,
      display_name: trimmed,
      theme,
      art_key: `common/unknown`,
      art_path: artBasePath ? path.join(artBasePath, "common", "unknown.svg") : null,
      art_frame_count: COMPANION_ART_FRAME_COUNT,
      art_frame_width: COMPANION_ART_FRAME_WIDTH,
      art_frame_height: COMPANION_ART_FRAME_HEIGHT,
    }
  }

  const displayName = resolveAgentName(entry.canonical, theme)
  return {
    key: displayName,
    role: entry.role,
    canonical: entry.canonical,
    display_name: displayName,
    theme,
    art_key: `${theme}/${displayName}`,
    art_path: artBasePath ? path.join(artBasePath, theme, `${displayName}.svg`) : null,
    art_frame_count: COMPANION_ART_FRAME_COUNT,
    art_frame_width: COMPANION_ART_FRAME_WIDTH,
    art_frame_height: COMPANION_ART_FRAME_HEIGHT,
  }
}

interface CompanionManagerOptions {
  agentNameTheme?: AgentNameTheme
}

function writeCompanionState(mutator: (state: CompanionState) => void): void {
  const filePath = getCompanionStatePath()
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const state = readCompanionState()
    state.sessions = state.sessions.filter((session) => isProcessAlive(session.pid))
    mutator(state)
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`)
    fs.renameSync(tempPath, filePath)
  } catch (err) {
    logWarn(`Could not write companion state: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM"
  }
}

function readPidFile(filePath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(filePath, "utf8").trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined
    if (code !== "ENOENT") logDebug(`Could not read companion PID file: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function readSpawnRecord(): CompanionSpawnRecord | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getCompanionSpawnRecordPath(), "utf8"))
    return parseCompanionSpawnRecord(parsed)
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined
    if (code !== "ENOENT") logDebug(`Could not read companion spawn record: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function readProcessCommand(pid: number): string | null {
  if (process.platform === "win32") return null
  try {
    const command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim()
    return command.length > 0 ? command : null
  } catch (err) {
    logDebug(`Could not inspect companion PID ${pid}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function writeSpawnRecord(record: CompanionSpawnRecord): void {
  const filePath = getCompanionSpawnRecordPath()
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tempPath, `${JSON.stringify(record)}\n`)
    fs.renameSync(tempPath, filePath)
  } catch (err) {
    logWarn(`Could not write companion spawn record: ${err instanceof Error ? err.message : String(err)}`)
    try {
      fs.rmSync(tempPath, { force: true })
    } catch (cleanupErr) {
      logDebug(`Could not remove temporary companion spawn record: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`)
    }
  }
}

function removeSpawnRecord(): void {
  try {
    fs.rmSync(getCompanionSpawnRecordPath(), { force: true })
  } catch (err) {
    logDebug(`Could not remove companion spawn record: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function isPrimaryAgent(agent: string | undefined): boolean {
  return agent === "orchestrator" || agent === "gandalf"
}

export class CompanionManager {
  private readonly sessionID: string
  private readonly cwd: string
  private readonly config: CompanionConfig
  private readonly agentNameTheme: AgentNameTheme
  private readonly busyAgentSessions = new Map<string, string>()
  private status: CompanionSessionState["status"] = "idle"
  private companionProcess: ChildProcess | null = null
  private spawnedCompanionPid: number | null = null

  constructor(sessionID: string, cwd: string, config: CompanionConfig, options: CompanionManagerOptions = {}) {
    this.sessionID = sessionID
    this.cwd = cwd
    this.config = config
    this.agentNameTheme = options.agentNameTheme ?? "descriptive"
  }

  onLoad(): void {
    if (this.config.enabled !== true) {
      CompanionManager.disposeActiveManagers(this.sessionID)
      this.removeSessionState()
      return
    }

    this.registerActiveManager()
    this.flush()
    this.spawnIfAvailable()
  }

  onSessionStatus(input: { sessionID?: string; agent?: string; status?: string }): void {
    if (this.config.enabled !== true) return
    if (!input.sessionID || (input.status !== "busy" && input.status !== "idle")) return

    if (isPrimaryAgent(input.agent)) {
      this.status = input.status
      this.flush()
      return
    }

    if (input.status === "busy") {
      if (input.agent) this.busyAgentSessions.set(input.sessionID, input.agent)
    } else {
      this.busyAgentSessions.delete(input.sessionID)
    }
    this.flush()
  }

  onSessionDeleted(sessionID: string | undefined): void {
    if (this.config.enabled !== true || !sessionID) return
    if (this.busyAgentSessions.delete(sessionID)) this.flush()
  }

  onWaitingInput(): void {
    if (this.config.enabled !== true) return
    this.status = "waiting-input"
    this.flush()
  }

  onInputResolved(): void {
    if (this.config.enabled !== true) return
    this.status = this.busyAgentSessions.size > 0 ? "busy" : "idle"
    this.flush()
  }

  onExit(): void {
    if (!activeManagers.has(this)) return

    activeManagers.delete(this)
    if (activeManagers.size === 0 && activeExitListener) {
      process.removeListener("exit", activeExitListener)
      activeExitListener = null
    }

    this.removeSessionState()
    if (this.companionProcess && this.removeOwnedPidFileIfIdle()) {
      this.companionProcess.kill()
    }
    this.companionProcess = null
  }

  private registerActiveManager(): void {
    for (const manager of [...activeManagers]) {
      if (manager !== this && manager.sessionID === this.sessionID) manager.onExit()
    }
    activeManagers.add(this)
    if (!activeExitListener) {
      activeExitListener = () => CompanionManager.disposeActiveManagers()
      process.on("exit", activeExitListener)
    }
  }

  private static disposeActiveManagers(sessionID?: string): void {
    for (const manager of [...activeManagers]) {
      if (sessionID && manager.sessionID !== sessionID) continue
      manager.onExit()
    }
  }

  private removeSessionState(): void {
    writeCompanionState((state) => {
      state.sessions = state.sessions.filter((session) => session.session_id !== this.sessionID)
      state.config = normalizeCompanionConfig(this.config, { agentNameTheme: this.agentNameTheme })
    })
  }

  private activeAgentNames(): string[] {
    const agents = [...this.busyAgentSessions.values()]
    if (agents.length > 0) return agents.slice(0, 9).map((agent) => formatCompanionAgent(agent, this.agentNameTheme).display_name)
    if (this.status === "waiting-input") return ["input"]
    if (this.status === "busy") return [resolveAgentName("orchestrator", this.agentNameTheme)]
    return ["intro"]
  }

  private activeAgentDetails(): CompanionAgentState[] {
    return this.activeAgentNames().map((agent) => formatCompanionAgent(agent, this.agentNameTheme))
  }

  private flush(): void {
    const config = normalizeCompanionConfig(this.config, { agentNameTheme: this.agentNameTheme })
    const activeAgentDetails = this.activeAgentDetails()
    const session: CompanionSessionState = {
      session_id: this.sessionID,
      cwd: this.cwd,
      active_agents: activeAgentDetails.map((agent) => agent.display_name),
      active_agent_details: activeAgentDetails,
      status: this.status,
      pid: process.pid,
      updated_at: new Date().toISOString(),
      config,
    }

    writeCompanionState((state) => {
      const existingIndex = state.sessions.findIndex((item) => item.session_id === this.sessionID)
      if (existingIndex >= 0) {
        state.sessions[existingIndex] = session
      } else {
        state.sessions.push(session)
      }
      state.config = config
    })
  }

  private spawnIfAvailable(): void {
    const pidPath = getCompanionPidPath()
    const existingPid = readPidFile(pidPath)
    const livePid = existingPid !== null && isProcessAlive(existingPid) ? existingPid : null

    if (existingPid !== null && livePid === null) {
      try {
        fs.rmSync(pidPath, { force: true })
        removeSpawnRecord()
      } catch (err) {
        logDebug(`Could not remove stale companion PID file: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const binaryPath = resolveCompanionBinaryPath(this.config)
    if (!binaryPath) {
      const expected = this.config.binaryPath?.trim() || `${getDefaultCompanionBinaryPath()} or bundled companion/bin/fellowship-companion`
      logWarn(`Companion is enabled but no binary exists at ${expected}`)
      return
    }

    const spawnRecord = readSpawnRecord()
    const decision = decideCompanionLaunch({
      livePid,
      liveCommand: livePid === null ? null : readProcessCommand(livePid),
      spawnRecord,
      desiredBinaryPath: binaryPath,
      pluginVersion: getPluginVersion(),
      recordedBinaryExists: spawnRecord === null ? false : fs.existsSync(spawnRecord.binaryPath),
    })
    if (decision.action === "reuse") {
      logDebug(`Companion already running with PID ${decision.pid}`)
      return
    }
    if (decision.action === "replace") {
      logDebug(`Replacing companion PID ${decision.pid}: ${decision.reason}`)
      try {
        process.kill(decision.pid, "SIGTERM")
      } catch (err) {
        logDebug(`Could not stop old companion PID ${decision.pid}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    try {
      fs.mkdirSync(path.dirname(pidPath), { recursive: true })
      const child = spawn(binaryPath, [], {
        detached: true,
        env: {
          ...process.env,
          FELLOWSHIP_COMPANION_SESSION_ID: this.sessionID,
          FELLOWSHIP_COMPANION_STATE_PATH: getCompanionStatePath(),
          ...(this.config.debug ? { FELLOWSHIP_COMPANION_DEBUG: "1" } : {}),
        },
        stdio: "ignore",
      })
      child.once("error", (err) => logWarn(`Companion spawn failed: ${err.message}`))
      child.unref()
      this.companionProcess = child
      if (child.pid !== undefined) {
        fs.writeFileSync(pidPath, String(child.pid))
        writeSpawnRecord({ pid: child.pid, binaryPath, pluginVersion: getPluginVersion() })
        this.spawnedCompanionPid = child.pid
      }
    } catch (err) {
      logWarn(`Companion spawn failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private removeOwnedPidFileIfIdle(): boolean {
    if (this.spawnedCompanionPid === null) return true
    const pidPath = getCompanionPidPath()
    const pid = readPidFile(pidPath)
    if (pid !== this.spawnedCompanionPid) return false
    const remainingSessions = readCompanionState().sessions.length
    if (remainingSessions > 0) return false
    try {
      fs.rmSync(pidPath, { force: true })
      removeSpawnRecord()
      return true
    } catch (err) {
      logDebug(`Could not remove companion PID file: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
}

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function eventRecord(value: unknown): Record<string, unknown> | undefined {
  return isEventRecord(value) ? value : undefined
}

function eventString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Bridges OpenCode session lifecycle signals into the companion's activity state. */
export class CompanionActivityTracker {
  private readonly manager: CompanionManager
  private readonly sessionAgents = new Map<string, string>()

  constructor(manager: CompanionManager) {
    this.manager = manager
  }

  onContext(event: { readonly sessionID: string; readonly agent: string }): void {
    this.markBusy(event.sessionID, event.agent)
  }

  onEvent(rawEvent: unknown): void {
    const event = eventRecord(rawEvent)
    if (!event) return

    const type = eventString(event, "type")
    const properties = eventRecord(event.properties)
    const data = eventRecord(event.data)
    const details = properties ?? data ?? {}

    if (type === "permission.asked" || type === "question.asked") {
      this.manager.onWaitingInput()
    }

    if (type === "permission.replied" || type === "question.replied" || type === "question.rejected") {
      this.manager.onInputResolved()
    }

    if (type === "session.step.started") {
      const sessionID = eventString(details, "sessionID")
      const agent = eventString(details, "agent")
      if (sessionID && agent) this.markBusy(sessionID, agent)
    }

    if (type === "session.status") {
      const sessionID = eventString(details, "sessionID")
      const statusRecord = eventRecord(details.status)
      const status = statusRecord ? eventString(statusRecord, "type") : undefined
      this.manager.onSessionStatus({
        sessionID,
        agent: sessionID ? this.sessionAgents.get(sessionID) : undefined,
        status,
      })
      if (sessionID && status === "idle") this.sessionAgents.delete(sessionID)
    }

    if (
      type === "session.execution.succeeded"
      || type === "session.execution.failed"
      || type === "session.execution.interrupted"
    ) {
      this.markIdle(eventString(details, "sessionID"))
    }

    if (type === "session.deleted") {
      const info = eventRecord(details.info)
      const sessionID = (info ? eventString(info, "id") : undefined) ?? eventString(details, "sessionID")
      this.manager.onSessionDeleted(sessionID)
      if (sessionID) this.sessionAgents.delete(sessionID)
    }
  }

  private markBusy(sessionID: string, agent: string): void {
    if (sessionID.length === 0 || agent.length === 0) return
    this.sessionAgents.set(sessionID, agent)
    this.manager.onSessionStatus({ sessionID, agent, status: "busy" })
  }

  private markIdle(sessionID: string | undefined): void {
    if (!sessionID) return
    this.manager.onSessionStatus({
      sessionID,
      agent: this.sessionAgents.get(sessionID),
      status: "idle",
    })
    this.sessionAgents.delete(sessionID)
  }
}
