import { Plugin } from "@opencode/plugin"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { logWarn } from "./logging"
import { getConfigPaths, loadConfigWithLocation } from "./config"
import { moduleDir } from "./module-path"
import { STORAGE_DIR_NAME } from "./constants"
import { homeDir, fellowshipCacheDir } from "./paths"

type ProviderMode = "copilot" | "native"
type TaskStatus = "queued" | "running" | "retrying" | "completed" | "failed" | "stopped" | "interrupted"
type TmuxState = "disabled" | "attached" | "failed"
type TmuxMode = "window" | "pane"
type TmuxLayout = "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical"
type TaskStatusCounts = Record<TaskStatus, number>

interface OrchestrationConfig {
  providerMode: ProviderMode
  features: {
    delegation: boolean
    diagnostics: boolean
    vision: boolean
    continuousLoop: boolean
    selfHealing: boolean
  }
  limits: {
    maxConcurrent: number
    maxConcurrentGlobal: number
    providerMaxConcurrent: Partial<Record<ProviderMode, number>>
    maxRetries: number
    maxIterations: number
    retryBackoffMs: number
    taskTimeoutMs: number
  }
  runtimeFallback: {
    enabled: boolean
    retryOnErrors: number[]
    maxFallbackAttempts: number
    cooldownSeconds: number
    timeoutSeconds: number
    notifyOnFallback: boolean
    providerOrder: ProviderMode[]
  }
  hooks: {
    disabled: string[]
    telemetry: boolean
  }
  notifications: {
    enabled: boolean
    maxItems: number
  }
  categories: {
    routing: Record<string, ProviderMode>
    maxConcurrent: Record<string, number>
  }
  recovery: {
    autoResumeOnStart: boolean
  }
  tmux: {
    enabled: boolean
    mode: TmuxMode
    layout: TmuxLayout
    mainPaneSize: number
    sessionPrefix: string
  }
}

interface ConfigLoadResult {
  source: string
  configPaths: string[]
  config: OrchestrationConfig
}

interface TaskRecord {
  id: string
  sessionID: string
  title: string
  agent: string
  category: string | null
  status: TaskStatus
  provider: ProviderMode
  ownerPid: number | null
  ownerInstanceID: string | null
  createdAt: string
  startedAt: string | null
  terminalAt: string | null
  updatedAt: string
  backgroundTaskID: string | null
  details: string
  failureReason: string | null
  blockedBy: string[]
  blocks: string[]
  tmuxWindowID: string | null
  tmuxSessionName: string | null
  tmuxState: TmuxState
}

interface SessionState {
  loopEnabled: boolean
  tmuxMissingWarned: boolean
  tmuxSessionCreated: boolean
  telemetry: {
    created: number
    completed: number
    failed: number
    stopped: number
    timedOut: number
  }
  notifications: {
    ts: string
    level: "info" | "warn" | "error"
    message: string
    taskID: string
  }[]
}

interface ProviderCapacityState {
  effectiveMaxConcurrent: number
  cooldownUntil: string | null
  congestionFailures: number
  successfulCompletions: number
}

interface SharedProviderState {
  version: 1
  providers: Record<ProviderMode, ProviderCapacityState>
}

const USER_HOME = homeDir()
const TASK_STORAGE_DIR = join(fellowshipCacheDir(), "orchestration-tasks")
const ORCHESTRATION_CACHE_DIR = fellowshipCacheDir()
const ADMISSION_LOCK_DIR = join(ORCHESTRATION_CACHE_DIR, "orchestration-admission.lock")
const PROVIDER_STATE_FILE = join(ORCHESTRATION_CACHE_DIR, "orchestration-provider-state.json")
const INSTANCE_ID = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const ADMISSION_LOCK_TTL_MS = 30_000
const OWNER_LEASE_DIR = join(ORCHESTRATION_CACHE_DIR, "orchestration-owner-leases")
const OWNER_LEASE_FILE = join(OWNER_LEASE_DIR, `${INSTANCE_ID}.json`)
const OWNER_LEASE_TTL_MS = 30_000
const OWNER_LEASE_HEARTBEAT_MS = 10_000
const TMUX_TIMEOUT_MS = 3_000
const PACKAGE_ROOT = join(moduleDir(import.meta.url), "..")

export function getOrchestrationTaskStorageDir(): string {
  return TASK_STORAGE_DIR
}

export function getOrchestrationCacheDir(): string {
  return ORCHESTRATION_CACHE_DIR
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  providerMode: "copilot",
  features: {
    delegation: true,
    diagnostics: true,
    vision: true,
    continuousLoop: true,
    selfHealing: true,
  },
  limits: {
    maxConcurrent: 3,
    maxConcurrentGlobal: 5,
    providerMaxConcurrent: {},
    maxRetries: 2,
    maxIterations: 25,
    retryBackoffMs: 1500,
    taskTimeoutMs: 120000,
  },
  runtimeFallback: {
    enabled: true,
    retryOnErrors: [400, 401, 403, 408, 429, 500, 502, 503, 504, 529],
    maxFallbackAttempts: 2,
    cooldownSeconds: 30,
    timeoutSeconds: 30,
    notifyOnFallback: true,
    providerOrder: ["copilot", "native"],
  },
  hooks: {
    disabled: [],
    telemetry: true,
  },
  notifications: {
    enabled: true,
    maxItems: 100,
  },
  categories: {
    routing: {},
    maxConcurrent: {},
  },
  recovery: {
    autoResumeOnStart: true,
  },
  tmux: {
    enabled: false,
    mode: "window",
    layout: "main-vertical",
    mainPaneSize: 60,
    sessionPrefix: "fellowship",
  },
}

const TASK_STATUS_ORDER: TaskStatus[] = ["queued", "running", "retrying", "completed", "failed", "stopped", "interrupted"]

const TASK_ALIAS_PREFIXES: Record<string, string> = {
  analyst: "ana",
  architect: "arc",
  build: "bld",
  deep: "dep",
  elrond: "arc",
  explorer: "exp",
  explore: "exp",
  fixer: "fix",
  gandalf: "orc",
  general: "gen",
  implementer: "imp",
  legolas: "exp",
  planner: "pln",
  quick: "qck",
  radagast: "res",
  research: "res",
  researcher: "res",
  tdd: "tdd",
  treebeard: "pln",
}

const sessionStates = new Map<string, SessionState>()
const taskRecords = new Map<string, TaskRecord>()
const taskByCallID = new Map<string, string>()
let ownerLeaseHeartbeat: ReturnType<typeof setInterval> | null = null

function getSessionState(sessionID: string): SessionState {
  const existing = sessionStates.get(sessionID)
  if (existing) return existing

  const state: SessionState = {
    loopEnabled: false,
    tmuxMissingWarned: false,
    tmuxSessionCreated: false,
    telemetry: {
      created: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
      timedOut: 0,
    },
    notifications: [],
  }
  sessionStates.set(sessionID, state)
  return state
}

function nowIso(): string {
  return new Date().toISOString()
}

function isoToMs(value: string): number {
  const stamp = Date.parse(value)
  return Number.isNaN(stamp) ? 0 : stamp
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null
  return typeof error.code === "string" ? error.code : null
}

function isProcessLive(pid: number | null): boolean {
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return getErrorCode(error) === "EPERM"
  }
}

function writeOwnerLease(): void {
  mkdirSync(OWNER_LEASE_DIR, { recursive: true })
  const temporary = `${OWNER_LEASE_FILE}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(temporary, JSON.stringify({
    pid: process.pid,
    ownerInstanceID: INSTANCE_ID,
    heartbeatAt: nowIso(),
  }))
  renameSync(temporary, OWNER_LEASE_FILE)
}

function ensureOwnerLease(): void {
  writeOwnerLease()
  if (ownerLeaseHeartbeat) return
  ownerLeaseHeartbeat = setInterval(() => {
    if (!existsSync(USER_HOME)) {
      if (ownerLeaseHeartbeat) clearInterval(ownerLeaseHeartbeat)
      ownerLeaseHeartbeat = null
      return
    }
    writeOwnerLease()
  }, OWNER_LEASE_HEARTBEAT_MS)
  ownerLeaseHeartbeat.unref()
}

function stopOwnerLease(): void {
  if (ownerLeaseHeartbeat) clearInterval(ownerLeaseHeartbeat)
  ownerLeaseHeartbeat = null
  const lease = readJsonFile(OWNER_LEASE_FILE)
  if (isRecord(lease) && lease.ownerInstanceID === INSTANCE_ID) {
    rmSync(OWNER_LEASE_FILE, { force: true })
  }
}

function isTaskOwnerLive(record: TaskRecord): boolean {
  if (!isProcessLive(record.ownerPid)) return false
  if (record.ownerInstanceID === null) return true

  const lease = readJsonFile(join(OWNER_LEASE_DIR, `${record.ownerInstanceID}.json`))
  if (!isRecord(lease)) return false
  if (lease.ownerInstanceID !== record.ownerInstanceID || lease.pid !== record.ownerPid) return false
  const heartbeatAt = asString(lease.heartbeatAt)
  if (heartbeatAt === undefined) return false
  const leaseAgeMs = Date.now() - isoToMs(heartbeatAt)
  return leaseAgeMs >= 0 && leaseAgeMs <= OWNER_LEASE_TTL_MS
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseProviderMode(value: unknown): ProviderMode {
  return value === "native" ? "native" : "copilot"
}

function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase()
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function isHookEnabled(config: OrchestrationConfig, hookName: string): boolean {
  return !config.hooks.disabled.includes(hookName)
}

function parseConfigFromFile(): ConfigLoadResult {
  const loaded = loadConfigWithLocation()
  return {
    source: loaded.configPaths.at(-1) ?? "defaults",
    configPaths: getConfigPaths().filter((configPath) => existsSync(configPath)),
    config: loaded.config.orchestration,
  }
}

function parseTaskInfo(args: unknown): { title: string; agent: string; category: string | null; details: string } {
  if (!isRecord(args)) {
    return {
      title: "untitled-task",
      agent: "category:unspecified",
      category: null,
      details: "No task arguments available",
    }
  }

  const description = asString(args.description) ?? "untitled-task"
  const category = asString(args.category)
  const normalizedCategory = category ? normalizeCategoryName(category) : null
  const subagentType = asString(args.subagent_type)
  const agent = normalizedCategory ? `category:${normalizedCategory}` : subagentType ? `agent:${subagentType}` : "category:unspecified"

  const details = [
    `description=${description}`,
    normalizedCategory ? `category=${normalizedCategory}` : null,
    subagentType ? `subagent_type=${subagentType}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ")

  return {
    title: description.length > 48 ? `${description.slice(0, 45)}...` : description,
    agent,
    category: normalizedCategory,
    details,
  }
}

function parseTaskDependencies(args: unknown): { blockedBy: string[]; blocks: string[] } {
  if (!isRecord(args)) return { blockedBy: [], blocks: [] }
  const blockedBy = Array.isArray(args.blockedBy)
    ? args.blockedBy.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []
  const blocks = Array.isArray(args.blocks)
    ? args.blocks.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []
  return { blockedBy, blocks }
}

function getTasksForSession(sessionID: string): TaskRecord[] {
  hydrateSessionTasks(sessionID)
  const result: TaskRecord[] = []
  for (const record of taskRecords.values()) {
    if (record.sessionID === sessionID) result.push(record)
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function getSessionTaskFile(sessionID: string): string {
  return join(TASK_STORAGE_DIR, `${sessionID}.json`)
}

function extractCategoryFromAgent(agent: string): string | null {
  if (!agent.startsWith("category:")) return null
  const raw = agent.slice("category:".length).trim()
  if (!raw || raw === "unspecified") return null
  return normalizeCategoryName(raw)
}

function resolveTaskProvider(config: OrchestrationConfig, category: string | null): ProviderMode {
  if (!category) return config.providerMode
  return config.categories.routing[category] ?? config.providerMode
}

function getCategoryConcurrencyLimit(config: OrchestrationConfig, category: string | null): number {
  if (!category) return config.limits.maxConcurrent
  return config.categories.maxConcurrent[category] ?? config.limits.maxConcurrent
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "interrupted"
}

function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === "running"
}

function createEmptyTaskStatusCounts(): TaskStatusCounts {
  return {
    queued: 0,
    running: 0,
    retrying: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
    interrupted: 0,
  }
}

function getTaskStatusCounts(tasks: TaskRecord[]): TaskStatusCounts {
  const counts = createEmptyTaskStatusCounts()
  for (const task of tasks) {
    counts[task.status] += 1
  }
  return counts
}

function formatTaskStatusCounts(counts: TaskStatusCounts): string {
  return TASK_STATUS_ORDER.map((status) => `${status}=${counts[status]}`).join(" ")
}

function getTaskAliasBase(record: TaskRecord): string {
  const source = record.category ?? record.agent.replace(/^[^:]+:/, "")
  const normalized = source.trim().toLowerCase()
  const mapped = TASK_ALIAS_PREFIXES[normalized]
  if (mapped) return mapped

  const compact = normalized.replace(/[^a-z0-9]/g, "")
  return compact.length >= 3 ? compact.slice(0, 3) : "tsk"
}

function getTaskAlias(record: TaskRecord, tasks: TaskRecord[]): string {
  const base = getTaskAliasBase(record)
  const peers = tasks
    .filter((task) => getTaskAliasBase(task) === base)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const index = peers.findIndex((task) => task.id === record.id)
  return `${base}-${index >= 0 ? index + 1 : 1}`
}

function getNextTask(tasks: TaskRecord[]): TaskRecord | null {
  const candidates = tasks
    .filter((task) => isActiveTaskStatus(task.status))
    .sort((a, b) => {
      const statusRank = TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status)
      if (statusRank !== 0) return statusRank
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    })
  return candidates[0] ?? null
}

function safeTaskRecord(value: unknown): TaskRecord | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const sessionID = asString(value.sessionID)
  const title = asString(value.title)
  const agent = asString(value.agent)
  const categoryRaw = value.category
  const categoryFromField = typeof categoryRaw === "string" ? normalizeCategoryName(categoryRaw) : null
  const status = asString(value.status)
  const provider = parseProviderMode(value.provider)
  const ownerPid = typeof value.ownerPid === "number" && Number.isInteger(value.ownerPid) && value.ownerPid > 0 ? value.ownerPid : null
  const ownerInstanceID = value.ownerInstanceID === null ? null : asString(value.ownerInstanceID) ?? null
  const createdAt = asString(value.createdAt)
  const startedAt = value.startedAt === null ? null : asString(value.startedAt) ?? null
  const terminalAt = value.terminalAt === null ? null : asString(value.terminalAt) ?? null
  const updatedAt = asString(value.updatedAt)
  const backgroundTaskID = value.backgroundTaskID === null ? null : asString(value.backgroundTaskID) ?? null
  const details = asString(value.details)
  const failureReason = value.failureReason === null
    ? null
    : asString(value.failureReason) ?? (value.fallbackReason === null ? null : asString(value.fallbackReason) ?? null)
  const blockedBy = Array.isArray(value.blockedBy)
    ? value.blockedBy.filter((item): item is string => typeof item === "string")
    : []
  const blocks = Array.isArray(value.blocks)
    ? value.blocks.filter((item): item is string => typeof item === "string")
    : []
  // Accept both old "tmuxPaneID" and new "tmuxWindowID" for backward compat with persisted data
  const tmuxWindowID = value.tmuxWindowID === null ? null
    : asString(value.tmuxWindowID) ?? (value.tmuxPaneID === null ? null : asString(value.tmuxPaneID) ?? null)
  const tmuxSessionName = value.tmuxSessionName === null ? null : asString(value.tmuxSessionName) ?? null
  const tmuxState = asString(value.tmuxState)

  const validTmuxState =
    tmuxState === "disabled" || tmuxState === "attached" || tmuxState === "failed"

  const validStatus =
    status === "queued" ||
    status === "running" ||
    status === "retrying" ||
    status === "completed" ||
    status === "failed" ||
    status === "stopped" ||
    status === "interrupted"

  if (!id || !sessionID || !title || !agent || !validStatus || !createdAt || !updatedAt || !details) {
    return null
  }

  return {
    id,
    sessionID,
    title,
    agent,
    category: categoryFromField ?? extractCategoryFromAgent(agent),
    status,
    provider,
    ownerPid,
    ownerInstanceID,
    createdAt,
    startedAt: startedAt ?? (status === "running" ? createdAt : null),
    terminalAt: terminalAt ?? (isTerminalStatus(status) ? updatedAt : null),
    updatedAt,
    backgroundTaskID,
    details,
    failureReason,
    blockedBy,
    blocks,
    tmuxWindowID,
    tmuxSessionName,
    tmuxState: validTmuxState ? tmuxState : "disabled",
  }
}

function hydrateSessionTasks(sessionID: string): void {
  const filePath = getSessionTaskFile(sessionID)
  if (!existsSync(filePath)) return

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown
    if (!Array.isArray(parsed)) return
    for (const entry of parsed) {
      const record = safeTaskRecord(entry)
      if (!record) continue
      if (!taskRecords.has(record.id)) {
        taskRecords.set(record.id, record)
      }
    }
  } catch {
    return
  }
}

function persistSessionTasks(sessionID: string): void {
  const tasks = [...taskRecords.values()]
    .filter((record) => record.sessionID === sessionID)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  mkdirSync(TASK_STORAGE_DIR, { recursive: true })
  const target = getSessionTaskFile(sessionID)
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(temporary, JSON.stringify(tasks, null, 2))
  renameSync(temporary, target)
}

function refreshAllTaskRecords(): void {
  taskRecords.clear()
  if (!existsSync(TASK_STORAGE_DIR)) return
  for (const file of readdirSync(TASK_STORAGE_DIR)) {
    if (!file.endsWith(".json")) continue
    const parsed = readJsonFile(join(TASK_STORAGE_DIR, file))
    if (!Array.isArray(parsed)) continue
    for (const entry of parsed) {
      const record = safeTaskRecord(entry)
      if (record) taskRecords.set(record.id, record)
    }
  }
}

async function withAdmissionLock<T>(operation: () => T | Promise<T>): Promise<T> {
  mkdirSync(ORCHESTRATION_CACHE_DIR, { recursive: true })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const lockID = `${INSTANCE_ID}-${Math.random().toString(36).slice(2, 8)}`
    try {
      mkdirSync(ADMISSION_LOCK_DIR)
    } catch (error) {
      if (getErrorCode(error) !== "EEXIST") throw error
      const owner = readJsonFile(join(ADMISSION_LOCK_DIR, "owner.json"))
      const ownerPid = isRecord(owner) && typeof owner.pid === "number" ? owner.pid : null
      const lockCreatedAt = isRecord(owner) ? asString(owner.createdAt) : undefined
      let lockAgeMs = lockCreatedAt
        ? Date.now() - isoToMs(lockCreatedAt)
        : 0
      try {
        if (lockAgeMs <= 0) lockAgeMs = Date.now() - statSync(ADMISSION_LOCK_DIR).mtimeMs
      } catch (statError) {
        if (getErrorCode(statError) === "ENOENT") continue
        throw statError
      }
      if ((ownerPid !== null && !isProcessLive(ownerPid)) || lockAgeMs > ADMISSION_LOCK_TTL_MS) {
        const quarantine = `${ADMISSION_LOCK_DIR}.stale-${INSTANCE_ID}-${Math.random().toString(36).slice(2, 8)}`
        try {
          renameSync(ADMISSION_LOCK_DIR, quarantine)
          rmSync(quarantine, { recursive: true, force: true })
          continue
        } catch (recoveryError) {
          if (getErrorCode(recoveryError) === "ENOENT") continue
          throw recoveryError
        }
      }
      await delay(10)
      continue
    }

    writeFileSync(join(ADMISSION_LOCK_DIR, "owner.json"), JSON.stringify({
      pid: process.pid,
      instanceID: INSTANCE_ID,
      lockID,
      createdAt: nowIso(),
    }))
    try {
      return await operation()
    } finally {
      const owner = readJsonFile(join(ADMISSION_LOCK_DIR, "owner.json"))
      if (isRecord(owner) && owner.lockID === lockID) {
        const released = `${ADMISSION_LOCK_DIR}.release-${lockID}`
        try {
          renameSync(ADMISSION_LOCK_DIR, released)
          rmSync(released, { recursive: true, force: true })
        } catch (error) {
          if (getErrorCode(error) !== "ENOENT") throw error
        }
      }
    }
  }
  throw new Error("Delegation admission is busy. Retry the task after other local OpenCode processes finish admission.")
}

function getConfiguredProviderCap(config: OrchestrationConfig, provider: ProviderMode): number {
  return Math.min(config.limits.maxConcurrentGlobal, config.limits.providerMaxConcurrent[provider] ?? config.limits.maxConcurrentGlobal)
}

function defaultProviderCapacity(config: OrchestrationConfig, provider: ProviderMode): ProviderCapacityState {
  return {
    effectiveMaxConcurrent: getConfiguredProviderCap(config, provider),
    cooldownUntil: null,
    congestionFailures: 0,
    successfulCompletions: 0,
  }
}

function readProviderState(config: OrchestrationConfig): SharedProviderState {
  const raw = readJsonFile(PROVIDER_STATE_FILE)
  const providers = isRecord(raw) && isRecord(raw.providers) ? raw.providers : {}
  const parseProvider = (provider: ProviderMode): ProviderCapacityState => {
    const fallback = defaultProviderCapacity(config, provider)
    const value = isRecord(providers[provider]) ? providers[provider] : {}
    return {
      effectiveMaxConcurrent: parseBoundedInt(
        value.effectiveMaxConcurrent,
        fallback.effectiveMaxConcurrent,
        1,
        getConfiguredProviderCap(config, provider),
      ),
      cooldownUntil: value.cooldownUntil === null ? null : asString(value.cooldownUntil) ?? null,
      congestionFailures: typeof value.congestionFailures === "number" ? value.congestionFailures : 0,
      successfulCompletions: typeof value.successfulCompletions === "number" ? value.successfulCompletions : 0,
    }
  }
  return { version: 1, providers: { copilot: parseProvider("copilot"), native: parseProvider("native") } }
}

function persistProviderState(state: SharedProviderState): void {
  mkdirSync(ORCHESTRATION_CACHE_DIR, { recursive: true })
  const temporary = `${PROVIDER_STATE_FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  writeFileSync(temporary, JSON.stringify(state))
  renameSync(temporary, PROVIDER_STATE_FILE)
}

function recordProviderOutcome(
  config: OrchestrationConfig,
  provider: ProviderMode,
  outcome: "success" | "congestion",
): void {
  const state = readProviderState(config)
  const capacity = state.providers[provider]
  const configuredCap = getConfiguredProviderCap(config, provider)
  if (outcome === "congestion") {
    capacity.congestionFailures += 1
    capacity.effectiveMaxConcurrent = Math.max(1, capacity.effectiveMaxConcurrent - 1)
    capacity.cooldownUntil = new Date(Date.now() + config.runtimeFallback.cooldownSeconds * 1000).toISOString()
  } else {
    capacity.successfulCompletions += 1
    capacity.effectiveMaxConcurrent = Math.min(configuredCap, capacity.effectiveMaxConcurrent + 1)
  }
  persistProviderState(state)
}

function recoverAbandonedTasks(config: OrchestrationConfig): number {
  let recovered = 0
  const touchedSessions = new Set<string>()
  for (const record of taskRecords.values()) {
    if (record.status !== "running" && record.status !== "queued" && record.status !== "retrying") continue
    if (record.status === "running" && isTaskOwnerLive(record)) continue
    if (record.tmuxWindowID) closeTaskWindow(record, config, true)
    record.status = "interrupted"
    record.updatedAt = nowIso()
    record.terminalAt = record.updatedAt
    record.details = "Interrupted because the owning OpenCode process is no longer running; original task calls cannot be replayed safely"
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    record.tmuxState = "disabled"
    touchedSessions.add(record.sessionID)
    recovered += 1
  }
  for (const sessionID of touchedSessions) persistSessionTasks(sessionID)
  return recovered
}

function activeTaskRecords(): TaskRecord[] {
  return [...taskRecords.values()].filter((record) => record.status === "running" && isTaskOwnerLive(record))
}

async function formatSharedCapacity(config: OrchestrationConfig): Promise<string[]> {
  return withAdmissionLock(() => {
    refreshAllTaskRecords()
    recoverAbandonedTasks(config)
    const active = activeTaskRecords()
    const state = readProviderState(config)
    const lines = [`- sharedActive=${active.length}/${config.limits.maxConcurrentGlobal}`]
    for (const provider of ["copilot", "native"] as const) {
      const capacity = state.providers[provider]
      const providerActive = active.filter((record) => record.provider === provider).length
      const cooldown = capacity.cooldownUntil && isoToMs(capacity.cooldownUntil) > Date.now()
        ? capacity.cooldownUntil
        : "none"
      lines.push(
        `- ${provider} active=${providerActive} effective=${capacity.effectiveMaxConcurrent} configured=${getConfiguredProviderCap(config, provider)} cooldown=${cooldown}`,
      )
    }
    return lines
  })
}

function admissionError(reason: string): Error {
  return new Error(`Delegation rejected: ${reason}. Complete or stop existing work, or adjust orchestration.limits.`)
}

async function admitTask(
  config: OrchestrationConfig,
  sessionID: string,
  callID: string,
  taskInfo: ReturnType<typeof parseTaskInfo>,
  dependencies: ReturnType<typeof parseTaskDependencies>,
): Promise<TaskRecord> {
  return withAdmissionLock(() => {
    refreshAllTaskRecords()
    recoverAbandonedTasks(config)
    const active = activeTaskRecords()
    const sessionActive = active.filter((record) => record.sessionID === sessionID)
    if (sessionActive.length >= config.limits.maxConcurrent) {
      throw admissionError(`per-session active cap reached (${sessionActive.length}/${config.limits.maxConcurrent})`)
    }
    if (active.length >= config.limits.maxConcurrentGlobal) {
      throw admissionError(`shared global active cap reached (${active.length}/${config.limits.maxConcurrentGlobal})`)
    }

    const provider = resolveTaskProvider(config, taskInfo.category)
    const capacity = config.runtimeFallback.enabled
      ? readProviderState(config).providers[provider]
      : defaultProviderCapacity(config, provider)
    const cooldownUntilMs = capacity.cooldownUntil ? isoToMs(capacity.cooldownUntil) : 0
    if (cooldownUntilMs > Date.now()) {
      throw admissionError(`${provider} provider cooldown is active until ${capacity.cooldownUntil}`)
    }
    const providerActive = active.filter((record) => record.provider === provider).length
    if (providerActive >= capacity.effectiveMaxConcurrent) {
      throw admissionError(`${provider} provider active cap reached (${providerActive}/${capacity.effectiveMaxConcurrent})`)
    }
    if (taskInfo.category) {
      const categoryActive = sessionActive.filter((record) => record.category === taskInfo.category).length
      const categoryLimit = getCategoryConcurrencyLimit(config, taskInfo.category)
      if (categoryActive >= categoryLimit) {
        throw admissionError(`${taskInfo.category} category active cap reached (${categoryActive}/${categoryLimit})`)
      }
    }

    const record = createTaskRecord(sessionID, taskInfo.title, taskInfo.agent, taskInfo.category, provider, `${taskInfo.details} provider=${provider}`)
    record.blockedBy = dependencies.blockedBy
    record.blocks = dependencies.blocks
    if (config.tmux.enabled) attachTaskWindow(record, config)
    persistSessionTasks(sessionID)
    taskByCallID.set(callID, record.id)
    return record
  })
}

function pushNotification(
  sessionID: string,
  level: "info" | "warn" | "error",
  message: string,
  taskID: string
): void {
  const config = parseConfigFromFile().config
  if (!config.notifications.enabled) return

  const state = getSessionState(sessionID)
  state.notifications.unshift({
    ts: nowIso(),
    level,
    message,
    taskID,
  })

  if (state.notifications.length > config.notifications.maxItems) {
    state.notifications = state.notifications.slice(0, config.notifications.maxItems)
  }
}

function notifyTmuxMissingOnce(sessionID: string): void {
  const state = getSessionState(sessionID)
  if (state.tmuxMissingWarned) return
  state.tmuxMissingWarned = true
  pushNotification(sessionID, "warn", "Tmux integration disabled for this session because tmux is not installed or not on PATH", "tmux")
}

function getPersistedTaskCount(): number {
  if (!existsSync(TASK_STORAGE_DIR)) return 0
  let total = 0
  for (const file of readdirSync(TASK_STORAGE_DIR)) {
    if (!file.endsWith(".json")) continue
    const sessionID = file.replace(/\.json$/, "")
    hydrateSessionTasks(sessionID)
  }
  for (const _ of taskRecords.values()) {
    total += 1
  }
  return total
}

async function recoverPersistedTasks(config: OrchestrationConfig): Promise<void> {
  if (!config.recovery.autoResumeOnStart) return
  if (!existsSync(TASK_STORAGE_DIR)) return
  await withAdmissionLock(() => {
    refreshAllTaskRecords()
    recoverAbandonedTasks(config)
  })
}

function createTaskRecord(sessionID: string, title: string, agent: string, category: string | null, provider: ProviderMode, details: string): TaskRecord {
  ensureOwnerLease()
  const id = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const stamp = nowIso()
  const record: TaskRecord = {
    id,
    sessionID,
    title,
    agent,
    category,
    status: "running",
    provider,
    ownerPid: process.pid,
    ownerInstanceID: INSTANCE_ID,
    createdAt: stamp,
    startedAt: stamp,
    terminalAt: null,
    updatedAt: stamp,
    backgroundTaskID: null,
    details,
    failureReason: null,
    blockedBy: [],
    blocks: [],
    tmuxWindowID: null,
    tmuxSessionName: null,
    tmuxState: "disabled",
  }
  taskRecords.set(id, record)
  const config = parseConfigFromFile().config
  if (config.hooks.telemetry) {
    const state = getSessionState(sessionID)
    state.telemetry.created += 1
  }
  return record
}

function enforceTaskTimeouts(sessionID: string, config: OrchestrationConfig): number {
  const now = Date.now()
  let timedOut = 0
  for (const record of getTasksForSession(sessionID)) {
    if (record.status !== "running") continue
    if (record.ownerInstanceID !== INSTANCE_ID && isTaskOwnerLive(record)) continue
    const ageMs = now - isoToMs(record.startedAt ?? record.createdAt)
    if (ageMs > config.limits.taskTimeoutMs) {
      setTaskStatus(record, "failed", `Timed out after ${config.limits.taskTimeoutMs}ms without progress`)
      timedOut += 1
    }
  }
  return timedOut
}

function setTaskStatus(record: TaskRecord, status: TaskStatus, details?: string): void {
  const previousStatus = record.status

  // Terminal states are sticky: once a task is completed/failed/stopped,
  // it cannot transition back to any other state. This prevents
  // tool.execute.after from overwriting a /stop command's "stopped" status.
  if (isTerminalStatus(previousStatus) && previousStatus !== status) {
    return
  }

  record.status = status
  record.updatedAt = nowIso()
  if (isTerminalStatus(status) && record.terminalAt === null) record.terminalAt = record.updatedAt
  if (details) record.details = details
  persistSessionTasks(record.sessionID)

  const config = parseConfigFromFile().config
  if (previousStatus === status) return

  if (config.hooks.telemetry) {
    const telemetry = getSessionState(record.sessionID).telemetry
    if (status === "completed") telemetry.completed += 1
    if (status === "failed") {
      telemetry.failed += 1
      if ((details ?? "").toLowerCase().includes("timed out")) telemetry.timedOut += 1
    }
    if (status === "stopped") telemetry.stopped += 1
  }

  if (status === "completed") {
    pushNotification(record.sessionID, "info", `Task completed: ${record.title}`, record.id)
  }
  if (status === "failed") {
    pushNotification(record.sessionID, "error", `Task failed: ${record.title}`, record.id)
  }
  if (status === "stopped") {
    pushNotification(record.sessionID, "warn", `Task stopped: ${record.title}`, record.id)
  }
}

function extractBackgroundTaskID(output: string): string | null {
  const taskTag = output.match(/<task\b([^>]*)>/i)
  if (taskTag) {
    const attributes = taskTag[1] ?? ""
    const id = attributes.match(/\bid\s*=\s*["']([a-zA-Z0-9_-]+)["']/i)?.[1]
    const state = attributes.match(/\bstate\s*=\s*["']([a-zA-Z]+)["']/i)?.[1]
    if (id && state?.toLowerCase() === "running") return id
  }
  const legacy = output.match(/Task ID:\s*([a-zA-Z0-9_-]+)/)
  return legacy?.[1] ?? null
}

function extractStructuredBackgroundTaskID(metadata: unknown): string | null {
  if (!isRecord(metadata) || metadata.background !== true) return null
  return asString(metadata.sessionId) ?? null
}

function parseSyntheticBackgroundTerminal(text: string): { id: string; status: "completed" | "error"; text: string } | null {
  const match = text.match(/<task\b([^>]*)>([\s\S]*?)<\/task>/i)
  if (!match) return null
  const attributes = match[1] ?? ""
  const id = attributes.match(/\bid\s*=\s*["']([a-zA-Z0-9_-]+)["']/i)?.[1]
  const status = attributes.match(/\bstate\s*=\s*["'](completed|error)["']/i)?.[1]?.toLowerCase()
  if (!id || (status !== "completed" && status !== "error")) return null
  return { id, status, text: (match[2] ?? "").trim() }
}

function extractErrorText(value: unknown): string {
  if (typeof value === "string") return value
  if (!isRecord(value)) return "Task execution failed"
  for (const key of ["message", "error", "data", "name"]) {
    const text = extractErrorText(value[key])
    if (text !== "Task execution failed") return text
  }
  return "Task execution failed"
}

function extractHttpStatus(output: string): number | null {
  const match = output.match(/\b(4\d\d|5\d\d)\b/)
  if (!match) return null
  const code = Number.parseInt(match[1], 10)
  return Number.isNaN(code) ? null : code
}

function classifyFailure(output: string): { code: number | null; reason: string } {
  const lowered = output.toLowerCase()
  const statusCode = extractHttpStatus(output)
  if (statusCode !== null) return { code: statusCode, reason: `http-${statusCode}` }
  if (lowered.includes("timeout") || lowered.includes("timed out")) return { code: 408, reason: "timeout" }
  if (lowered.includes("rate limit") || lowered.includes("too many requests")) return { code: 429, reason: "rate-limit" }
  if (lowered.includes("api key") || lowered.includes("credential")) return { code: 401, reason: "credential" }
  if (lowered.includes("failed")) return { code: 500, reason: "failed" }
  return { code: null, reason: "unknown" }
}

const CONGESTION_CODES = [408, 429, 503, 504]

function recordCongestionIfApplicable(
  config: OrchestrationConfig,
  record: TaskRecord,
  failureCode: number | null,
): void {
  if (
    config.features.selfHealing &&
    isHookEnabled(config, "fallback-engine") &&
    config.runtimeFallback.enabled &&
    failureCode !== null &&
    CONGESTION_CODES.includes(failureCode) &&
    config.runtimeFallback.retryOnErrors.includes(failureCode)
  ) {
    recordProviderOutcome(config, record.provider, "congestion")
  }
}

// Structural failure patterns that indicate the task tool itself failed,
// not that the agent's analysis merely discusses failures.
const FAILURE_SIGNAL_PATTERNS = [
  /^error:/im,
  /task failed/i,
  /execution failed/i,
  /provider.*error/i,
  /\b(4\d\d|5\d\d)\s+(error|status|response)\b/i,
  /rate limit/i,
  /too many requests/i,
  /api key/i,
  /credential/i,
  /timed?\s*out/i,
  /connection refused/i,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
]

// The max length of output we consider "short enough" to be an error message
// rather than substantive agent analysis. Subagent responses with real work
// are typically 500+ chars; provider errors are usually under 300.
const FAILURE_OUTPUT_MAX_LENGTH = 300

function isLikelyTaskFailure(output: string): boolean {
  if (output.length === 0) return false

  // Short outputs that contain "failed" are likely actual errors from the
  // task tool or provider, not agent analysis that happens to mention failure.
  if (output.length <= FAILURE_OUTPUT_MAX_LENGTH && output.toLowerCase().includes("failed")) {
    return true
  }

  // Check for structural failure patterns regardless of output length.
  // These are specific enough to not false-positive on agent analysis text.
  for (const pattern of FAILURE_SIGNAL_PATTERNS) {
    if (pattern.test(output)) return true
  }

  return false
}

/** Runs one tmux command. Tests inject a fake; production shells out to the tmux binary. */
export type TmuxCommandRunner = (args: string[]) => { status: number | null; stdout?: string; stderr?: string }

const spawnTmux: TmuxCommandRunner = (args) =>
  spawnSync("tmux", args, { encoding: "utf-8", timeout: TMUX_TIMEOUT_MS })

let runTmuxCommand: TmuxCommandRunner = spawnTmux

function hasTmuxBinary(): boolean {
  return runTmuxCommand(["-V"]).status === 0
}

function isInsideTmux(): boolean {
  return typeof process.env.TMUX === "string" && process.env.TMUX.length > 0
}

function runTmux(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = runTmuxCommand(args)
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function normalizeTmuxToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
}

// Builds the dedicated tmux session name for an OpenCode session.
// All task windows for this session live inside this one tmux session.
function getAgentSessionName(config: OrchestrationConfig, sessionID: string): string {
  const prefix = normalizeTmuxToken(config.tmux.sessionPrefix)
  const token = normalizeTmuxToken(sessionID).slice(0, 24)
  return `${prefix}-${token}`
}

// Ensures the dedicated tmux session exists for this OpenCode session.
// Creates it detached on first call, subsequent calls are no-ops.
function ensureAgentSession(config: OrchestrationConfig, sessionID: string): { ok: boolean; sessionName: string; reason: string } {
  const sessionName = getAgentSessionName(config, sessionID)
  const state = getSessionState(sessionID)

  if (state.tmuxSessionCreated) {
    // Verify it still exists (user might have killed it)
    const check = runTmux(["has-session", "-t", sessionName])
    if (check.ok) return { ok: true, sessionName, reason: "exists" }
    // Session was killed externally, recreate it
    state.tmuxSessionCreated = false
  }

  // Create a new detached session. The initial window is a placeholder
  // that will be replaced by the first task window.
  const create = runTmux(["new-session", "-d", "-s", sessionName, "-n", "agents"])
  if (!create.ok) {
    // Session might already exist from a previous run
    const check = runTmux(["has-session", "-t", sessionName])
    if (check.ok) {
      state.tmuxSessionCreated = true
      return { ok: true, sessionName, reason: "already-exists" }
    }
    return { ok: false, sessionName, reason: create.stderr.trim() || "new-session failed" }
  }

  state.tmuxSessionCreated = true
  return { ok: true, sessionName, reason: "created" }
}

function getCurrentTmuxSessionName(): string {
  const result = runTmux(["display-message", "-p", "#{session_name}"])
  if (!result.ok) return "current"

  return result.stdout.trim().split("\n")[0]?.trim() || "current"
}

function applyTmuxPaneLayout(config: OrchestrationConfig): void {
  if (config.tmux.mode !== "pane") return

  runTmux(["select-layout", config.tmux.layout])
  if (config.tmux.layout !== "main-horizontal" && config.tmux.layout !== "main-vertical") return

  const sizeOption = config.tmux.layout === "main-horizontal" ? "main-pane-height" : "main-pane-width"
  runTmux(["set-window-option", sizeOption, `${config.tmux.mainPaneSize}%`])
  runTmux(["select-layout", config.tmux.layout])
}

// Creates a new tmux window inside the agent session for a task.
function attachTaskWindow(record: TaskRecord, config: OrchestrationConfig): { attached: boolean; reason: string } {
  if (!config.tmux.enabled) {
    record.tmuxState = "disabled"
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    return { attached: false, reason: "tmux disabled" }
  }
  if (!isInsideTmux()) {
    record.tmuxState = "disabled"
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    return { attached: false, reason: "not inside tmux" }
  }
  if (!hasTmuxBinary()) {
    record.tmuxState = "disabled"
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    notifyTmuxMissingOnce(record.sessionID)
    return { attached: false, reason: "tmux binary unavailable" }
  }

  if (config.tmux.mode === "pane") {
    const paneTitle = record.title.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, "-")
    const command = `printf "[fellowship] tracking ${record.id}\n"; exec \${SHELL:-/bin/sh}`
    const pane = runTmux(["split-window", "-h", "-d", "-P", "-F", "#{pane_id}", command])
    if (!pane.ok) {
      record.tmuxState = "failed"
      return { attached: false, reason: pane.stderr.trim() || "split-window failed" }
    }

    const paneID = pane.stdout.trim().split("\n")[0]?.trim()
    if (!paneID) {
      record.tmuxState = "failed"
      return { attached: false, reason: "split-window returned empty pane id" }
    }

    runTmux(["select-pane", "-t", paneID, "-T", paneTitle])
    applyTmuxPaneLayout(config)

    record.tmuxState = "attached"
    record.tmuxWindowID = paneID
    record.tmuxSessionName = getCurrentTmuxSessionName()
    return { attached: true, reason: paneID }
  }

  const session = ensureAgentSession(config, record.sessionID)
  if (!session.ok) {
    record.tmuxState = "failed"
    return { attached: false, reason: session.reason }
  }

  const windowName = `${normalizeTmuxToken(record.id)}:${record.title.slice(0, 20).replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const newWindow = runTmux(["new-window", "-t", session.sessionName, "-n", windowName, "-d", "-P", "-F", "#{window_id}"])
  if (!newWindow.ok) {
    record.tmuxState = "failed"
    return { attached: false, reason: newWindow.stderr.trim() || "new-window failed" }
  }

  const windowID = newWindow.stdout.trim().split("\n")[0]?.trim()
  if (!windowID) {
    record.tmuxState = "failed"
    return { attached: false, reason: "new-window returned empty window id" }
  }

  runTmux(["send-keys", "-t", `${session.sessionName}:${windowName}`, `printf \"[${session.sessionName}] tracking ${record.id}\\n\"`, "Enter"])

  record.tmuxState = "attached"
  record.tmuxWindowID = windowID
  record.tmuxSessionName = session.sessionName
  return { attached: true, reason: windowID }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function attachChildSession(record: TaskRecord): void {
  if (!record.backgroundTaskID || !record.tmuxWindowID || record.tmuxState !== "attached") return
  const command = ["opencode2", "--session", record.backgroundTaskID, process.cwd()]
    .map(shellQuote)
    .join(" ")
  runTmux(["send-keys", "-t", record.tmuxWindowID, command, "Enter"])
}

// Closes a task's tmux window. If it's the last window, the session dies automatically.
function closeTaskWindow(record: TaskRecord, config: OrchestrationConfig, recovering = false): void {
  if (!record.tmuxWindowID) {
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    record.tmuxState = "disabled"
    persistSessionTasks(record.sessionID)
    return
  }

  if ((!config.tmux.enabled && !recovering) || !isInsideTmux() || !hasTmuxBinary()) {
    record.tmuxWindowID = null
    record.tmuxSessionName = null
    record.tmuxState = "disabled"
    if (!hasTmuxBinary()) notifyTmuxMissingOnce(record.sessionID)
    persistSessionTasks(record.sessionID)
    return
  }
  runTmux(["send-keys", "-t", record.tmuxWindowID, "C-c"])
  if (record.tmuxWindowID.startsWith("%")) {
    runTmux(["kill-pane", "-t", record.tmuxWindowID])
    applyTmuxPaneLayout(config)
  } else {
    runTmux(["kill-window", "-t", record.tmuxWindowID])
  }
  record.tmuxWindowID = null
  record.tmuxSessionName = null
  record.tmuxState = "disabled"
  persistSessionTasks(record.sessionID)
}

function verifyTaskWindow(record: TaskRecord): boolean {
  if (!record.tmuxWindowID) return false
  const probe = runTmux(["display-message", "-p", "-t", record.tmuxWindowID, "#{pane_id}:#{window_id}"])
  return probe.ok
}

function reconcileTmuxState(sessionID: string, config: OrchestrationConfig): { staleClosed: number; missing: number } {
  if (!config.tmux.enabled || !isInsideTmux() || !hasTmuxBinary()) {
    return { staleClosed: 0, missing: 0 }
  }

  let staleClosed = 0
  let missing = 0
  const tasks = getTasksForSession(sessionID)
  for (const record of tasks) {
    if (isTerminalStatus(record.status) && record.tmuxWindowID) {
      closeTaskWindow(record, config)
      staleClosed += 1
      continue
    }
    if (record.tmuxState === "attached" && record.tmuxWindowID && !verifyTaskWindow(record)) {
      record.tmuxState = "failed"
      record.tmuxWindowID = null
      record.tmuxSessionName = null
      missing += 1
      persistSessionTasks(sessionID)
      pushNotification(sessionID, "warn", `Tmux window missing for ${record.title}`, record.id)
    }
  }
  if (staleClosed > 0 || missing > 0) {
    maybeDestroyIdleAgentSession(config, sessionID)
  }
  return { staleClosed, missing }
}

// Kills the entire agent session for this OpenCode session.
function destroyAgentSession(config: OrchestrationConfig, sessionID: string): void {
  if (config.tmux.mode === "pane") return
  if (!hasTmuxBinary()) return
  const sessionName = getAgentSessionName(config, sessionID)
  runTmux(["kill-session", "-t", sessionName])
  const state = getSessionState(sessionID)
  state.tmuxSessionCreated = false
}

// Destroys the agent session if no tasks have attached windows remaining.
// Called after a task window is closed to clean up when all work is done.
function maybeDestroyIdleAgentSession(config: OrchestrationConfig, sessionID: string): void {
  if (!config.tmux.enabled || !isInsideTmux() || !hasTmuxBinary()) return
  if (config.tmux.mode === "pane") return
  const state = getSessionState(sessionID)
  if (!state.tmuxSessionCreated) return

  const hasAttachedWindows = getTasksForSession(sessionID).some((task) => task.tmuxState === "attached")
  if (!hasAttachedWindows) {
    destroyAgentSession(config, sessionID)
  }
}

function formatTaskLine(record: TaskRecord, tasks: TaskRecord[]): string {
  const alias = getTaskAlias(record, tasks)
  const bg = record.backgroundTaskID ? ` bg=${record.backgroundTaskID}` : ""
  const category = record.category ? ` category=${record.category}` : ""
  const deps = record.blockedBy.length > 0 ? ` blockedBy=${record.blockedBy.join(",")}` : ""
  const window = record.tmuxWindowID ? ` window=${record.tmuxWindowID}` : ""
  const tmuxState = ` tmux=${record.tmuxState}`
  return `- ${alias} ${record.id} [${record.status}] ${record.agent} \"${record.title}\"${bg}${category}${deps}${window}${tmuxState}`
}

function formatJobBoardSummary(
  sessionID: string,
  tasks: TaskRecord[],
  config: OrchestrationConfig,
  agentSessionName: string,
  agentSessionExists: boolean,
): string[] {
  const counts = getTaskStatusCounts(tasks)
  const active = tasks.filter((task) => isActiveTaskStatus(task.status)).length
  const blocked = tasks.filter((task) => task.blockedBy.length > 0 && isActiveTaskStatus(task.status)).length
  const attached = tasks.filter((task) => task.tmuxState === "attached").length
  const next = getNextTask(tasks)
  const state = getSessionState(sessionID)

  return [
    "# Background Job Board",
    "",
    `- total=${tasks.length} active=${active}/${config.limits.maxConcurrent} ${formatTaskStatusCounts(counts)}`,
    `- loop=${state.loopEnabled ? "enabled" : "disabled"} tmux=${config.tmux.enabled ? "enabled" : "disabled"} mode=${config.tmux.mode} layout=${config.tmux.layout} mainPaneSize=${config.tmux.mainPaneSize} session=${agentSessionExists ? agentSessionName : "none"} windows=${attached}`,
    `- next=${next ? `${getTaskAlias(next, tasks)} [${next.status}] ${next.title}` : "none"}`,
    `- blocked=${blocked} notifications=${state.notifications.length}/${config.notifications.maxItems}`,
  ]
}

interface DiagnosticCheck {
  label: string
  pass: boolean
  remediation: string
  severity: "required" | "advisory"
  detail: string | null
}

function diagnosticsCheck(
  label: string,
  pass: boolean,
  remediation: string,
  options: { severity?: "required" | "advisory"; detail?: string | null } = {},
): DiagnosticCheck {
  return {
    label,
    pass,
    remediation,
    severity: options.severity ?? "required",
    detail: options.detail ?? null,
  }
}

function formatCheck(check: DiagnosticCheck): string {
  const status = check.pass ? "PASS" : check.severity === "advisory" ? "WARN" : "FAIL"
  const detail = check.detail ? ` (${check.detail})` : ""
  return `- ${status} ${check.label}${detail}${check.pass ? "" : ` -> ${check.remediation}`}`
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function countFilesWithExtension(dirPath: string, extension: string): number {
  try {
    return readdirSync(dirPath).filter((entry) => entry.endsWith(extension)).length
  } catch {
    return 0
  }
}

function countMarkdownFiles(dirPath: string): number {
  return countFilesWithExtension(dirPath, ".md")
}

function countJsonFiles(dirPath: string): number {
  try {
    return readdirSync(dirPath).filter((entry) => (
      entry.endsWith(".json") || existsSync(join(dirPath, entry, "mcp.json"))
    )).length
  } catch {
    return 0
  }
}

function countSkillDirs(dirPath: string): number {
  try {
    return readdirSync(dirPath).filter((entry) => existsSync(join(dirPath, entry, "SKILL.md"))).length
  } catch {
    return 0
  }
}

function getStatusFilePath(): string {
  return join(USER_HOME, ".cache", "opencode", STORAGE_DIR_NAME, "opencode-config.plugin-status.json")
}

function getPresetStateFilePath(): string {
  return join(USER_HOME, ".cache", "opencode", STORAGE_DIR_NAME, "opencode-config.preset-state.json")
}

async function runDiagnostics(sessionID: string): Promise<string> {
  const configResult = parseConfigFromFile()
  const config = configResult.config
  const timedOutTasks = isHookEnabled(config, "timeout-enforcement")
    ? await withAdmissionLock(() => {
      refreshAllTaskRecords()
      return enforceTaskTimeouts(sessionID, config)
    })
    : 0
  const sharedCapacity = await formatSharedCapacity(config)
  const tmuxHealth = reconcileTmuxState(sessionID, config)
  const tasks = getTasksForSession(sessionID)
  const activeTasks = tasks.filter((task) => task.status === "running" && isProcessLive(task.ownerPid))
  const activeByCategory = new Map<string, number>()
  for (const task of activeTasks) {
    const category = task.category
    if (!category) continue
    activeByCategory.set(category, (activeByCategory.get(category) ?? 0) + 1)
  }
  const categoryConcurrencyViolations = [...activeByCategory.entries()].filter(([category, active]) => {
    const limit = getCategoryConcurrencyLimit(config, category)
    return active > limit
  })
  const attachedTmuxTasks = tasks.filter((task) => task.tmuxState === "attached")
  const state = getSessionState(sessionID)

  const configFiles = configResult.configPaths
  const activeConfigDetail = configResult.source === "defaults"
    ? "no readable fellowship.json[c] found"
    : configResult.source
  const configFileChecks: DiagnosticCheck[] = [
    diagnosticsCheck("config:source", true, "create ~/.config/opencode/fellowship.jsonc or .opencode/fellowship.jsonc", {
      detail: activeConfigDetail,
    }),
    diagnosticsCheck("config:jsoncReadable", configFiles.length === 0 || configResult.source !== "defaults", "fix or remove malformed fellowship.json[c] files", {
      detail: `${configFiles.length} config file(s) present`,
    }),
  ]

  const packageJsonPath = join(PACKAGE_ROOT, "package.json")
  const packageJson = readJsonFile(packageJsonPath)
  const packageName = isRecord(packageJson) && typeof packageJson.name === "string" ? packageJson.name : null
  const packageVersion = isRecord(packageJson) && typeof packageJson.version === "string" ? packageJson.version : null
  const manifestPath = join(PACKAGE_ROOT, "manifest.json")
  const manifestJson = readJsonFile(manifestPath)
  const instructionCount = isRecord(manifestJson) && Array.isArray(manifestJson.instructions) ? manifestJson.instructions.length : 0
  const schemaPath = join(PACKAGE_ROOT, "fellowship.schema.json")
  const schemaJson = readJsonFile(schemaPath)
  const schemaHasPreset = isRecord(schemaJson) && isRecord(schemaJson.properties) && isRecord(schemaJson.properties.presets)
  const packageChecks: DiagnosticCheck[] = [
    diagnosticsCheck("package.json", existsSync(packageJsonPath), "run doctor from the @unfrgivn/opencode-config package root"),
    diagnosticsCheck("package:name", packageName === "@unfrgivn/opencode-config", "set package.json name to @unfrgivn/opencode-config", {
      detail: packageName ?? "missing",
    }),
    diagnosticsCheck("package:version", packageVersion !== null, "set package.json version", {
      detail: packageVersion ?? "missing",
    }),
    diagnosticsCheck("fellowship.schema.json", existsSync(schemaPath), "restore fellowship.schema.json so editor validation can be materialized"),
    diagnosticsCheck("schema:presets", schemaHasPreset, "update fellowship.schema.json with runtime preset fields"),
    diagnosticsCheck("manifest.json", existsSync(manifestPath), "restore manifest.json so instruction assets can be enumerated"),
    diagnosticsCheck("manifest:instructions", instructionCount > 0, "add instruction entries to manifest.json", {
      detail: `${instructionCount} instruction(s)`,
    }),
  ]

  const statusPath = getStatusFilePath()
  const statusJson = readJsonFile(statusPath)
  const statusLastLoad = isRecord(statusJson) && typeof statusJson.lastLoadTime === "string" ? statusJson.lastLoadTime : null
  const presetStatePath = getPresetStateFilePath()
  const presetStateJson = readJsonFile(presetStatePath)
  const selectedPreset = isRecord(presetStateJson) && typeof presetStateJson.activePreset === "string"
    ? presetStateJson.activePreset
    : null
  const stateFileChecks: DiagnosticCheck[] = [
    diagnosticsCheck("status:file", existsSync(statusPath), "restart OpenCode so the config plugin can write status", {
      severity: "advisory",
      detail: existsSync(statusPath) ? statusPath : "not written yet",
    }),
    diagnosticsCheck("status:lastLoadTime", statusLastLoad !== null, "restart OpenCode so status includes the last successful load time", {
      severity: "advisory",
      detail: statusLastLoad ?? "missing",
    }),
    diagnosticsCheck("preset:stateFile", !existsSync(presetStatePath) || isRecord(presetStateJson), "delete the corrupt preset state file and re-run /preset", {
      severity: "advisory",
      detail: selectedPreset ? `selected=${selectedPreset}` : "default",
    }),
  ]

  const requiredCommands = ["continue", "stop", "tasks", "task", "diagnostics", "doctor", "preset"]
  const commandChecks: DiagnosticCheck[] = requiredCommands.map((name) => {
    const exists = existsSync(join(PACKAGE_ROOT, "command", `${name}.md`))
    return diagnosticsCheck(`/` + name, exists, `add command/${name}.md`)
  })

  const skillCount = countSkillDirs(join(PACKAGE_ROOT, "skill"))
  const agentCount = countMarkdownFiles(join(PACKAGE_ROOT, "agent"))
  const commandCount = countMarkdownFiles(join(PACKAGE_ROOT, "command"))
  const mcpCount = countJsonFiles(join(PACKAGE_ROOT, "mcp"))
  const configChecks: DiagnosticCheck[] = [
    diagnosticsCheck("providerMode", config.providerMode === "copilot" || config.providerMode === "native", "set orchestration.providerMode to copilot or native"),
    diagnosticsCheck("feature:delegation", config.features.delegation, "enable orchestration.features.delegation"),
    diagnosticsCheck("feature:diagnostics", config.features.diagnostics, "enable orchestration.features.diagnostics"),
    diagnosticsCheck("feature:continuousLoop", config.features.continuousLoop, "enable orchestration.features.continuousLoop"),
    diagnosticsCheck("feature:selfHealing", config.features.selfHealing, "enable orchestration.features.selfHealing"),
    diagnosticsCheck("limits:maxConcurrent", config.limits.maxConcurrent >= 1 && config.limits.maxConcurrent <= 10, "set orchestration.limits.maxConcurrent in range 1..10"),
    diagnosticsCheck("limits:maxConcurrentGlobal", config.limits.maxConcurrentGlobal >= 1 && config.limits.maxConcurrentGlobal <= 100, "set orchestration.limits.maxConcurrentGlobal in range 1..100"),
    diagnosticsCheck("limits:maxRetries", config.limits.maxRetries >= 0 && config.limits.maxRetries <= 5, "set orchestration.limits.maxRetries in range 0..5"),
    diagnosticsCheck("limits:maxIterations", config.limits.maxIterations >= 1 && config.limits.maxIterations <= 100, "set orchestration.limits.maxIterations in range 1..100"),
    diagnosticsCheck("limits:retryBackoffMs", config.limits.retryBackoffMs >= 100 && config.limits.retryBackoffMs <= 60000, "set orchestration.limits.retryBackoffMs in range 100..60000"),
    diagnosticsCheck("limits:taskTimeoutMs", config.limits.taskTimeoutMs >= 1000 && config.limits.taskTimeoutMs <= 900000, "set orchestration.limits.taskTimeoutMs in range 1000..900000"),
    diagnosticsCheck("runtime:activeWithinLimit", activeTasks.length <= config.limits.maxConcurrent, "reduce active subagent workload or increase orchestration.limits.maxConcurrent"),
    diagnosticsCheck("categories:routing", typeof config.categories.routing === "object", "set orchestration.categories.routing as an object map"),
    diagnosticsCheck("categories:maxConcurrent", typeof config.categories.maxConcurrent === "object", "set orchestration.categories.maxConcurrent as an object map"),
    diagnosticsCheck(
      "runtime:categoryConcurrency",
      categoryConcurrencyViolations.length === 0,
      "reduce active tasks per category or raise orchestration.categories.maxConcurrent entries"
    ),
    diagnosticsCheck("runtimeFallback:enabled", typeof config.runtimeFallback.enabled === "boolean", "set orchestration.runtimeFallback.enabled to true/false"),
    diagnosticsCheck("runtimeFallback:maxFallbackAttempts", config.runtimeFallback.maxFallbackAttempts >= 1 && config.runtimeFallback.maxFallbackAttempts <= 5, "set orchestration.runtimeFallback.maxFallbackAttempts in range 1..5"),
    diagnosticsCheck("runtimeFallback:cooldownSeconds", config.runtimeFallback.cooldownSeconds >= 0 && config.runtimeFallback.cooldownSeconds <= 600, "set orchestration.runtimeFallback.cooldownSeconds in range 0..600"),
    diagnosticsCheck("runtimeFallback:timeoutSeconds", config.runtimeFallback.timeoutSeconds >= 0 && config.runtimeFallback.timeoutSeconds <= 300, "set orchestration.runtimeFallback.timeoutSeconds in range 0..300"),
    diagnosticsCheck("runtimeFallback:providerOrder", config.runtimeFallback.providerOrder.length > 0, "set orchestration.runtimeFallback.providerOrder with at least one provider"),
    diagnosticsCheck("hooks:disabled", Array.isArray(config.hooks.disabled), "set orchestration.hooks.disabled as a string array"),
    diagnosticsCheck("hooks:telemetry", typeof config.hooks.telemetry === "boolean", "set orchestration.hooks.telemetry to true/false"),
    diagnosticsCheck("notifications:enabled", typeof config.notifications.enabled === "boolean", "set orchestration.notifications.enabled to true/false"),
    diagnosticsCheck("notifications:maxItems", config.notifications.maxItems >= 10 && config.notifications.maxItems <= 500, "set orchestration.notifications.maxItems in range 10..500"),
    diagnosticsCheck("recovery:autoResumeOnStart", typeof config.recovery.autoResumeOnStart === "boolean", "set orchestration.recovery.autoResumeOnStart to true/false"),
    diagnosticsCheck("tmux:enabled", typeof config.tmux.enabled === "boolean", "set orchestration.tmux.enabled to true/false"),
    diagnosticsCheck("tmux:mode", config.tmux.mode === "window" || config.tmux.mode === "pane", "set orchestration.tmux.mode to window or pane"),
    diagnosticsCheck("tmux:layout", ["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"].includes(config.tmux.layout), "set orchestration.tmux.layout to a tmux layout name"),
    diagnosticsCheck("tmux:mainPaneSize", config.tmux.mainPaneSize >= 20 && config.tmux.mainPaneSize <= 80, "set orchestration.tmux.mainPaneSize in range 20..80"),
    diagnosticsCheck("tmux:sessionPrefix", /^[a-zA-Z0-9_-]{2,20}$/.test(config.tmux.sessionPrefix), "set orchestration.tmux.sessionPrefix to 2..20 chars [a-zA-Z0-9_-]"),
    diagnosticsCheck("tmux:insideSession", !config.tmux.enabled || isInsideTmux(), "run inside tmux or disable orchestration.tmux.enabled"),
    diagnosticsCheck("tmux:binary", !config.tmux.enabled || hasTmuxBinary(), "install tmux and ensure it is on PATH"),
  ]
  const pluginChecks: DiagnosticCheck[] = [
    diagnosticsCheck("runtime:orchestration", true, "reinstall the package so the orchestration runtime is bundled"),
    diagnosticsCheck("runtime:vision", true, "reinstall the package so the vision runtime is bundled"),
    diagnosticsCheck("assets:skills", skillCount > 0, "restore bundled skill assets under skill/<name>/SKILL.md", {
      detail: `${skillCount} discovered`,
    }),
    diagnosticsCheck("assets:agents", agentCount > 0, "restore bundled agent assets under agent/*.md", {
      detail: `${agentCount} discovered`,
    }),
    diagnosticsCheck("assets:commands", commandCount > 0, "restore bundled command assets under command/*.md", {
      detail: `${commandCount} discovered`,
    }),
    diagnosticsCheck("assets:mcps", mcpCount > 0, "restore bundled MCP assets under mcp/*.json", {
      detail: `${mcpCount} discovered`,
    }),
  ]
  const allChecks = [...configFileChecks, ...configChecks, ...packageChecks, ...stateFileChecks, ...pluginChecks, ...commandChecks]
  const requiredFailures = allChecks.filter((check) => !check.pass && check.severity === "required")
  const advisoryWarnings = allChecks.filter((check) => !check.pass && check.severity === "advisory")
  const passCount = allChecks.filter((check) => check.pass).length
  const failCount = requiredFailures.length

  const agentSessionName = getAgentSessionName(config, sessionID)
  const agentSessionExists = config.tmux.enabled && isInsideTmux() && hasTmuxBinary()
    ? runTmux(["has-session", "-t", agentSessionName]).ok
    : false

  const lines = [
    "# Fellowship Diagnostics (Full)",
    "",
    "## Summary",
    `- Overall: ${failCount === 0 ? advisoryWarnings.length === 0 ? "PASS" : "WARN" : "FAIL"}`,
    `- Checks: ${passCount} passed, ${failCount} failed, ${advisoryWarnings.length} warnings`,
    `- Config source: ${configResult.source}`,
    "",
    "## Config Files",
    ...configFileChecks.map(formatCheck),
    "",
    "## Configuration",
    ...configChecks.map(formatCheck),
    "",
    "## Package & Schema",
    ...packageChecks.map(formatCheck),
    "",
    "## Status Files",
    ...stateFileChecks.map(formatCheck),
    "",
    "## Plugin Assets",
    ...pluginChecks.map(formatCheck),
    "",
    "## Commands",
    ...commandChecks.map(formatCheck),
    "",
    "## Runtime State",
    `- Active task records in this session: ${tasks.length}`,
    `- Persisted task records across sessions: ${getPersistedTaskCount()}`,
    `- Active delegated tasks: ${activeTasks.length}/${config.limits.maxConcurrent}`,
    ...sharedCapacity,
    `- Active tmux windows: ${attachedTmuxTasks.length}`,
    `- Agent tmux session: ${agentSessionExists ? agentSessionName : "none"}`,
    `- Recovery auto-resume on startup: ${config.recovery.autoResumeOnStart ? "enabled" : "disabled"}`,
    `- Timed out tasks auto-marked failed in this pass: ${timedOutTasks}`,
    `- Tmux stale window cleanups in this pass: ${tmuxHealth.staleClosed}`,
    `- Tmux missing window detections in this pass: ${tmuxHealth.missing}`,
    `- Loop mode: ${getSessionState(sessionID).loopEnabled ? "enabled" : "disabled"}`,
    "",
    "## Hook Health",
    `- task-tracking: ${isHookEnabled(config, "task-tracking") ? "enabled" : "disabled"}`,
    `- timeout-enforcement: ${isHookEnabled(config, "timeout-enforcement") ? "enabled" : "disabled"}`,
    `- provider-backpressure (fallback-engine compatibility hook): ${isHookEnabled(config, "fallback-engine") ? "enabled" : "disabled"}`,
    `- activity-feed: ${isHookEnabled(config, "activity-feed") ? "enabled" : "disabled"}`,
    `- telemetry: ${config.hooks.telemetry ? "enabled" : "disabled"}`,
    `- telemetry counters: created=${state.telemetry.created}, completed=${state.telemetry.completed}, failed=${state.telemetry.failed}, stopped=${state.telemetry.stopped}, timedOut=${state.telemetry.timedOut}`,
    `- notifications: ${config.notifications.enabled ? "enabled" : "disabled"} (buffer=${state.notifications.length}/${config.notifications.maxItems})`,
    "",
    "## Provider Routing",
    `- Current mode: ${config.providerMode}`,
    `- Category routing overrides: ${Object.entries(config.categories.routing)
      .map(([category, provider]) => `${category}:${provider}`)
      .join(", ") || "none"}`,
    `- Category concurrency overrides: ${Object.entries(config.categories.maxConcurrent)
      .map(([category, limit]) => `${category}:${limit}`)
      .join(", ") || "none"}`,
    `- Provider backpressure: ${config.runtimeFallback.enabled ? "enabled" : "disabled"}`,
    `- Backpressure error codes: ${config.runtimeFallback.retryOnErrors.join(", ")}`,
    "- Automatic task retries/dispatch: disabled",
    config.providerMode === "copilot"
      ? "- Routing profile: Copilot-first (Codex/Gemini through Copilot where configured)."
      : "- Routing profile: Native provider mode (direct provider endpoints).",
  ]

  if (requiredFailures.length > 0 || advisoryWarnings.length > 0) {
    lines.push("", "## Remediation")
    for (const check of requiredFailures) {
      lines.push(`- FAIL ${check.label}: ${check.remediation}`)
    }
    for (const check of advisoryWarnings) {
      lines.push(`- WARN ${check.label}: ${check.remediation}`)
    }
  }

  return lines.join("\n")
}

function formatSingleTask(record: TaskRecord, tasks: TaskRecord[]): string {
  return [
    `# Task ${record.id}`,
    "",
    `- Alias: ${getTaskAlias(record, tasks)}`,
    `- Status: ${record.status}`,
    `- Agent: ${record.agent}`,
    `- Category: ${record.category ?? "n/a"}`,
    `- Provider: ${record.provider}`,
    `- Title: ${record.title}`,
    `- Created: ${record.createdAt}`,
    `- Started: ${record.startedAt ?? "n/a"}`,
    `- Terminal: ${record.terminalAt ?? "n/a"}`,
    `- Updated: ${record.updatedAt}`,
    `- Owner PID: ${record.ownerPid ?? "n/a"}`,
    `- Owner Instance: ${record.ownerInstanceID ?? "n/a"}`,
    `- Background ID: ${record.backgroundTaskID ?? "n/a"}`,
    `- Tmux State: ${record.tmuxState}`,
    `- Tmux Window ID: ${record.tmuxWindowID ?? "n/a"}`,
    `- Tmux Session: ${record.tmuxSessionName ?? "n/a"}`,
    `- Blocked By: ${record.blockedBy.length > 0 ? record.blockedBy.join(", ") : "none"}`,
    `- Blocks: ${record.blocks.length > 0 ? record.blocks.join(", ") : "none"}`,
    `- Details: ${record.details}`,
    `- Failure Reason: ${record.failureReason ?? "n/a"}`,
  ].join("\n")
}

type OrchestrationToolInput = {
  action: "continue" | "stop" | "tasks" | "task" | "diagnostics"
  task_id?: string
}

function isOrchestrationToolInput(value: unknown): value is OrchestrationToolInput {
  if (!isRecord(value)) return false
  return (
    value.action === "continue" ||
    value.action === "stop" ||
    value.action === "tasks" ||
    value.action === "task" ||
    value.action === "diagnostics"
  ) && (value.task_id === undefined || typeof value.task_id === "string")
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content
  return content === undefined ? "" : JSON.stringify(content)
}

async function executeOrchestrationTool(args: OrchestrationToolInput, sessionID: string): Promise<string> {
    const state = getSessionState(sessionID)

    if (args.action === "continue") {
      state.loopEnabled = true
      return [
        "Continuous loop mode enabled for this session.",
        "- Loop remains active until /stop is invoked.",
        "- Delegation remains subject to session, global, provider, and cooldown admission limits.",
      ].join("\n")
    }

    if (args.action === "stop") {
      const config = parseConfigFromFile().config
      state.loopEnabled = false
      await withAdmissionLock(() => {
        refreshAllTaskRecords()
        for (const record of getTasksForSession(sessionID)) {
          if (record.status === "queued" || record.status === "running" || record.status === "retrying") {
            setTaskStatus(record, "stopped", "Stopped by /stop command")
          }
          if (record.tmuxWindowID) {
            closeTaskWindow(record, config)
          }
        }
        destroyAgentSession(config, sessionID)
      })
      return "Loop halted and active tracked work stopped for this session. Awaiting further instruction."
    }

    if (args.action === "tasks") {
      const config = parseConfigFromFile().config
      if (isHookEnabled(config, "timeout-enforcement")) {
        await withAdmissionLock(() => {
          refreshAllTaskRecords()
          enforceTaskTimeouts(sessionID, config)
        })
      }
      const tmuxHealth = reconcileTmuxState(sessionID, config)
      const sharedCapacity = await formatSharedCapacity(config)
      const tasks = getTasksForSession(sessionID)
      if (tasks.length === 0) {
        return [
          "No tracked subagent tasks for this session yet.",
          "",
          "# Shared Capacity",
          "",
          ...sharedCapacity,
        ].join("\n")
      }

      const agentSessionName = getAgentSessionName(config, sessionID)
      const agentSessionExists = config.tmux.enabled && isInsideTmux() && hasTmuxBinary()
        ? runTmux(["has-session", "-t", agentSessionName]).ok
        : false

      const lines = [
        ...formatJobBoardSummary(sessionID, tasks, config, agentSessionName, agentSessionExists),
        "",
        "# Task Lanes",
        "",
        ...tasks.slice(0, 20).map((record) => formatTaskLine(record, tasks)),
        "",
        "# Shared Capacity",
        "",
        ...sharedCapacity,
      ]
      lines.push(
        "",
        "# Tmux Runtime",
        "",
        `- enabled=${config.tmux.enabled}`,
        `- agentSession=${agentSessionExists ? agentSessionName : "none"}`,
        `- windows=${tasks.filter((task) => task.tmuxState === "attached").length}`,
        `- staleClosed=${tmuxHealth.staleClosed}`,
        `- missingDetected=${tmuxHealth.missing}`,
      )
      const notifications = getSessionState(sessionID).notifications.slice(0, 5)
      if (notifications.length > 0) {
        lines.push("", "# Recent Notifications", "")
        for (const note of notifications) {
          lines.push(`- [${note.level.toUpperCase()}] ${note.ts} ${note.message} (${note.taskID})`)
        }
      }

      return lines.join("\n")
    }

    if (args.action === "task") {
      if (!args.task_id) return "Missing task_id. Usage: action=task task_id=<id>"
      const byID = taskRecords.get(args.task_id)
      if (byID && byID.sessionID === sessionID) {
        return formatSingleTask(byID, getTasksForSession(sessionID))
      }

      const tasks = getTasksForSession(sessionID)
      for (const record of tasks) {
        if (getTaskAlias(record, tasks) === args.task_id) {
          return formatSingleTask(record, tasks)
        }
        if (record.backgroundTaskID === args.task_id) {
          return formatSingleTask(record, tasks)
        }
      }

      return `Task not found for this session: ${args.task_id}`
    }

    return runDiagnostics(sessionID)
}

async function handleToolBefore(toolName: string, sessionID: string, callID: string, input: unknown): Promise<void> {
  if (toolName !== "task") return
  const config = parseConfigFromFile().config
  if (!isHookEnabled(config, "task-tracking")) return
  await admitTask(config, sessionID, callID, parseTaskInfo(input), parseTaskDependencies(input))
}

async function handleToolAfter(
  toolName: string,
  sessionID: string,
  callID: string,
  output: string,
  metadata: unknown,
): Promise<string> {
  if (toolName !== "task") return output
  const config = parseConfigFromFile().config
  if (!isHookEnabled(config, "task-tracking")) return output

  const taskID = taskByCallID.get(callID)
  if (!taskID) return output
  const backgroundTaskID = extractStructuredBackgroundTaskID(metadata) ?? extractBackgroundTaskID(output)
  const record = await withAdmissionLock(() => {
    refreshAllTaskRecords()
    const current = taskRecords.get(taskID)
    if (!current) return null
    const wasRunning = current.status === "running"
    if (backgroundTaskID) {
      current.backgroundTaskID = backgroundTaskID
      setTaskStatus(current, "running", `Background task launched with ${backgroundTaskID}, provider=${current.provider}`)
      attachChildSession(current)
    } else if (isLikelyTaskFailure(output)) {
      const failure = classifyFailure(output)
      current.failureReason = failure.reason
      setTaskStatus(current, "failed", `Task execution failed, reason=${failure.reason}`)
      if (wasRunning) recordCongestionIfApplicable(config, current, failure.code)
    } else {
      setTaskStatus(current, "completed", "Task execution completed")
      if (wasRunning) recordProviderOutcome(config, current.provider, "success")
    }
    if (isTerminalStatus(current.status)) {
      closeTaskWindow(current, config)
      maybeDestroyIdleAgentSession(config, sessionID)
    }
    persistSessionTasks(sessionID)
    return current
  })
  if (!record || !isHookEnabled(config, "activity-feed")) return output
  return `${output}\n[Subagent activity] ${record.status.toUpperCase()} ${record.agent} "${record.title}"`
}

export async function FellowshipOrchestrationPluginHooks(options: { runTmuxCommand?: TmuxCommandRunner } = {}) {
  runTmuxCommand = options.runTmuxCommand ?? spawnTmux
  await recoverPersistedTasks(parseConfigFromFile().config)

  return {
    tool: {
      fellowship_orchestration: {
        execute: (args: OrchestrationToolInput, context: { sessionID: string }) => (
          executeOrchestrationTool(args, context.sessionID)
        ),
      },
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      await handleToolBefore(input.tool, input.sessionID, input.callID, output.args)
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { output?: unknown; metadata?: unknown },
    ) => {
      output.output = await handleToolAfter(
        input.tool,
        input.sessionID,
        input.callID,
        typeof output.output === "string" ? output.output : "",
        output.metadata,
      )
    },
    event: async (input: { event: unknown }) => handleOrchestrationEvent(input.event),
  }
}

async function handleOrchestrationEvent(event: unknown): Promise<void> {
      if (!isRecord(event)) return
      const eventType = asString(event.type)
      const props = isRecord(event.properties) ? event.properties : null
      if (eventType === "message.part.updated") {
        const part = props && isRecord(props.part) ? props.part : null
        if (part?.type === "text") {
          const text = asString(part.text)
          const terminal = text ? parseSyntheticBackgroundTerminal(text) : null
          if (!terminal) return
          const config = parseConfigFromFile().config
          await withAdmissionLock(() => {
            refreshAllTaskRecords()
            const record = [...taskRecords.values()].find((candidate) => candidate.backgroundTaskID === terminal.id)
            if (!record || isTerminalStatus(record.status)) return
            if (terminal.status === "completed") {
              setTaskStatus(record, "completed", terminal.text || "Background task completed")
              recordProviderOutcome(config, record.provider, "success")
            } else {
              const failure = classifyFailure(terminal.text)
              record.failureReason = failure.reason
              setTaskStatus(record, "failed", terminal.text || `Background task failed, reason=${failure.reason}`)
              recordCongestionIfApplicable(config, record, failure.code)
            }
            closeTaskWindow(record, config)
            maybeDestroyIdleAgentSession(config, record.sessionID)
          })
          return
        }
        const state = part && isRecord(part.state) ? part.state : null
        if (
          !part ||
          !state ||
          part.type !== "tool" ||
          part.tool !== "task" ||
          (state.status !== "error" && state.status !== "completed")
        ) return
        const callID = asString(part.callID)
        const partID = asString(part.id)
        const taskID = (callID ? taskByCallID.get(callID) : undefined) ?? (partID ? taskByCallID.get(partID) : undefined)
        if (!taskID) return
        const config = parseConfigFromFile().config
        await withAdmissionLock(() => {
          refreshAllTaskRecords()
          const record = taskRecords.get(taskID)
          if (!record || isTerminalStatus(record.status)) return
          if (state.status === "completed") {
            const stateOutput = asString(state.output) ?? ""
            const backgroundTaskID = extractStructuredBackgroundTaskID(state.metadata) ?? extractBackgroundTaskID(stateOutput)
            if (backgroundTaskID) {
              record.backgroundTaskID = backgroundTaskID
              setTaskStatus(record, "running", `Background task launched with ${backgroundTaskID}, provider=${record.provider}`)
              attachChildSession(record)
              return
            }
            setTaskStatus(record, "completed", "Task execution completed")
            recordProviderOutcome(config, record.provider, "success")
            closeTaskWindow(record, config)
            maybeDestroyIdleAgentSession(config, record.sessionID)
            return
          }
          const errorText = extractErrorText(state.error)
          const failure = classifyFailure(errorText)
          record.failureReason = failure.reason
          setTaskStatus(record, "failed", `Task execution failed, reason=${failure.reason}`)
          recordCongestionIfApplicable(config, record, failure.code)
          closeTaskWindow(record, config)
          maybeDestroyIdleAgentSession(config, record.sessionID)
        })
        return
      }
      if (eventType === "session.error") {
        const childSessionID = props ? asString(props.sessionID) : undefined
        if (!childSessionID) return
        const config = parseConfigFromFile().config
        await withAdmissionLock(() => {
          refreshAllTaskRecords()
          const record = [...taskRecords.values()].find((candidate) => candidate.backgroundTaskID === childSessionID)
          if (!record || isTerminalStatus(record.status)) return
          const errorText = extractErrorText(props?.error)
          const failure = classifyFailure(errorText)
          record.failureReason = failure.reason
          setTaskStatus(record, "failed", errorText)
          recordCongestionIfApplicable(config, record, failure.code)
          closeTaskWindow(record, config)
          maybeDestroyIdleAgentSession(config, record.sessionID)
        })
        return
      }
      if (eventType === "session.idle") {
        return
      }
      if (eventType !== "session.deleted") return
      const info = props && isRecord(props.info) ? props.info : null
      const sessionID = info ? asString(info.id) : undefined
      if (!sessionID) return

      const config = parseConfigFromFile().config
      await withAdmissionLock(() => {
        refreshAllTaskRecords()
        for (const record of getTasksForSession(sessionID)) {
          if (record.tmuxWindowID) closeTaskWindow(record, config)
          if (record.status === "running" || record.status === "retrying" || record.status === "queued") {
            setTaskStatus(record, "stopped", "Parent session deleted")
          }
        }
        destroyAgentSession(config, sessionID)
        persistSessionTasks(sessionID)
      })
}

export const FellowshipOrchestrationPlugin = Plugin.define({
  id: "@unfrgivn/opencode-config:orchestration",
  setup: async (ctx) => {
    await recoverPersistedTasks(parseConfigFromFile().config)
    const registrations = [
      await ctx.tool.transform((tools) => {
        tools.add({
          name: "fellowship_orchestration",
          description: "Controls fellowship orchestration state. Actions: continue, stop, tasks, task, diagnostics.",
          input: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["continue", "stop", "tasks", "task", "diagnostics"] },
              task_id: { type: "string" },
            },
            required: ["action"],
            additionalProperties: false,
          },
          execute: async (input, context) => {
            if (!isOrchestrationToolInput(input)) return { content: "Invalid orchestration tool input" }
            return { content: await executeOrchestrationTool(input, context.sessionID) }
          },
        })
      }),
      await ctx.tool.hook("execute.before", async (event) => {
        await handleToolBefore(event.tool, event.sessionID, event.id, event.input)
      }),
      await ctx.tool.hook("execute.after", async (event) => {
        const output = event.status === "completed" ? toolResultText(event.result.content) : event.error.message
        const metadata = event.status === "completed" ? event.result.metadata ?? {} : {}
        const nextOutput = await handleToolAfter(event.tool, event.sessionID, event.id, output, metadata)
        if (event.status === "completed") {
          event.result = { ...event.result, content: nextOutput }
        }
      }),
    ]

    const controller = new AbortController()
    const eventTask = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          await handleOrchestrationEvent(event)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          logWarn(`Orchestration event subscription stopped: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })()

    return async () => {
      controller.abort()
      try {
        await eventTask
        for (const registration of registrations.reverse()) await registration.dispose()
      } finally {
        stopOwnerLease()
        sessionStates.clear()
        taskRecords.clear()
        taskByCallID.clear()
      }
    }
  },
})

export default FellowshipOrchestrationPlugin
