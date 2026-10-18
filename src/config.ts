import { z } from "zod"
import { existsSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { CONFIG_FILENAMES } from "./constants"
import { log, logError, logWarn } from "./logging"
import { AgentConfigSchema, type AgentConfig } from "./agent"
import { deepMerge } from "./deep-merge"
import { readPresetSelection } from "./preset-state"

const AgentOverridesSchema = z.record(z.string(), AgentConfigSchema)

const FeaturesSchema = z
  .object({
    delegation: z.boolean().default(true),
    diagnostics: z.boolean().default(true),
    vision: z.boolean().default(true),
    continuousLoop: z.boolean().default(true),
    selfHealing: z.boolean().default(true),
  })
  .strict()

const LimitsSchema = z
  .object({
    maxConcurrent: z.number().int().min(1).max(10).default(3),
    maxConcurrentGlobal: z.number().int().min(1).max(100).default(5),
    providerMaxConcurrent: z.record(z.enum(["copilot", "native"]), z.number().int().min(1).max(100)).default({}),
    maxRetries: z.number().int().min(0).max(5).default(2),
    maxIterations: z.number().int().min(1).max(100).default(25),
    retryBackoffMs: z.number().int().min(100).max(60000).default(1500),
    taskTimeoutMs: z.number().int().min(1000).max(900000).default(120000),
  })
  .strict()

const RuntimeFallbackSchema = z
  .object({
    enabled: z.boolean().default(true),
    retryOnErrors: z.array(z.number().int()).default([400, 401, 403, 408, 429, 500, 502, 503, 504, 529]),
    maxFallbackAttempts: z.number().int().min(1).max(5).default(2),
    cooldownSeconds: z.number().int().min(0).max(600).default(30),
    timeoutSeconds: z.number().int().min(0).max(300).default(30),
    notifyOnFallback: z.boolean().default(true),
    providerOrder: z.array(z.enum(["copilot", "native"])).default(["copilot", "native"]),
  })
  .strict()

const HooksSchema = z
  .object({
    disabled: z.array(z.string()).default([]),
    telemetry: z.boolean().default(true),
  })
  .strict()

const NotificationsSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxItems: z.number().int().min(10).max(500).default(100),
  })
  .strict()

const CategoriesSchema = z
  .object({
    routing: z.record(z.enum(["copilot", "native"])).default({}),
    maxConcurrent: z.record(z.number().int().min(1).max(10)).default({}),
  })
  .strict()

const RecoverySchema = z
  .object({
    autoResumeOnStart: z.boolean().default(true),
  })
  .strict()

const TmuxLayoutSchema = z.enum(["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"])

const TmuxSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["window", "pane"]).default("window"),
    layout: TmuxLayoutSchema.default("main-vertical"),
    mainPaneSize: z.number().int().min(20).max(80).default(60),
    sessionPrefix: z
      .string()
      .min(2)
      .max(20)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("fellowship"),
  })
  .strict()

const CompanionSchema = z
  .object({
    enabled: z.boolean().default(false),
    binaryPath: z.string().min(1).optional(),
    position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).default("bottom-right"),
    size: z.enum(["small", "medium", "large"]).default("medium"),
    gifPack: z.enum(["default"]).default("default"),
    loopStyle: z.enum(["classic", "smooth"]).default("classic"),
    speed: z.number().min(0.25).max(4).default(1),
    debug: z.boolean().default(false),
  })
  .strict()

const OrchestrationSchema = z
  .object({
    providerMode: z.enum(["copilot", "native"]).default("copilot"),
    features: FeaturesSchema.default({}),
    limits: LimitsSchema.default({}),
    runtimeFallback: RuntimeFallbackSchema.default({}),
    hooks: HooksSchema.default({}),
    notifications: NotificationsSchema.default({}),
    categories: CategoriesSchema.default({}),
    recovery: RecoverySchema.default({}),
    tmux: TmuxSchema.default({}),
  })
  .strict()

const FeaturesOverrideSchema = FeaturesSchema.partial()
const LimitsOverrideSchema = LimitsSchema.partial()
const RuntimeFallbackOverrideSchema = RuntimeFallbackSchema.partial()
const HooksOverrideSchema = HooksSchema.partial()
const NotificationsOverrideSchema = NotificationsSchema.partial()
const CategoriesOverrideSchema = CategoriesSchema.partial()
const RecoveryOverrideSchema = RecoverySchema.partial()
const TmuxOverrideSchema = TmuxSchema.partial()

const OrchestrationOverrideSchema = z
  .object({
    providerMode: z.enum(["copilot", "native"]).optional(),
    features: FeaturesOverrideSchema.optional(),
    limits: LimitsOverrideSchema.optional(),
    runtimeFallback: RuntimeFallbackOverrideSchema.optional(),
    hooks: HooksOverrideSchema.optional(),
    notifications: NotificationsOverrideSchema.optional(),
    categories: CategoriesOverrideSchema.optional(),
    recovery: RecoveryOverrideSchema.optional(),
    tmux: TmuxOverrideSchema.optional(),
  })
  .strict()

export const PresetConfigSchema = z
  .object({
    description: z.string().optional(),
    models: z.record(z.string(), z.string()).optional(),
    orchestration: OrchestrationOverrideSchema.optional(),
  })
  .strict()

export const UserConfigSchema = z
  .object({
    $schema: z.string().optional(),
    disable: z.array(z.string()).default([]),
    agentOverrides: AgentOverridesSchema.default({}),
    installMethod: z.enum(["link", "copy"]).default("link"),
    agentNames: z.enum(["lotr", "descriptive"]).default("descriptive"),
    dryRun: z.boolean().default(false),
    preset: z.string().optional(),
    presets: z.record(z.string(), PresetConfigSchema).default({}),
    models: z
      .record(z.string(), z.string())
      .default({}),
    companion: CompanionSchema.default({}),
    orchestration: OrchestrationSchema.default({}),
  })
  .strict()

export type UserConfig = z.infer<typeof UserConfigSchema>
export type PresetConfig = z.infer<typeof PresetConfigSchema>

export type RemoteSkillsConfig = UserConfig
export type RepositoryConfig = never

export const DEFAULT_CONFIG: UserConfig = {
  disable: [],
  agentOverrides: {},
  installMethod: "link",
  agentNames: "descriptive",
  dryRun: false,
  presets: {},
  models: {},
  companion: {
    enabled: false,
    position: "bottom-right",
    size: "medium",
    gifPack: "default",
    loopStyle: "classic",
    speed: 1,
    debug: false,
  },
  orchestration: {
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
  },
}

export interface ConfigLoadResult {
  config: UserConfig
  configDir: string | null
  configPaths: string[]
  activePreset: string | null
}

export type AgentOverrides = Record<string, AgentConfig>

export function getConfigPaths(projectRoot: string = process.cwd()): string[] {
  const projectDir = join(projectRoot, ".opencode")
  const home = process.env.HOME || process.env.USERPROFILE || "~"
  const userDir = join(home, ".config", "opencode")
  return [
    ...CONFIG_FILENAMES.map((filename) => join(projectDir, filename)),
    ...CONFIG_FILENAMES.map((filename) => join(userDir, filename)),
  ]
}

function getConfigScopeDirs(projectRoot: string): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "~"
  return [
    join(home, ".config", "opencode"),
    join(projectRoot, ".opencode"),
  ]
}

function getPreferredConfigPath(configDir: string): string | null {
  const preferredFilenames = ["fellowship.jsonc", "fellowship.json"] as const
  for (const filename of preferredFilenames) {
    const configPath = join(configDir, filename)
    if (existsSync(configPath)) return configPath
  }

  return null
}

function parseConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(configPath, "utf-8").replace(/^\uFEFF/, "")
    const parseErrors: Parameters<typeof parseJsonc>[1] = []
    const parsed: unknown = parseJsonc(content, parseErrors, {
      disallowComments: false,
      allowTrailingComma: true,
    })
    if (parseErrors.length > 0) {
      const firstError = parseErrors[0]
      logError(`Invalid configuration in ${configPath}: JSONC parse error at offset ${firstError.offset}`)
      return null
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      logError(`Invalid configuration in ${configPath}: expected an object`)
      return null
    }
    const result = UserConfigSchema.safeParse(parsed)
    if (!result.success) {
      logError(`Invalid configuration in ${configPath}: ${JSON.stringify(result.error.format())}`)
      return null
    }

    return parsed as Record<string, unknown>
  } catch (err) {
    logError(`Error reading ${configPath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export function loadConfig(): UserConfig {
  return loadConfigWithLocation().config
}

export function loadConfigWithLocation(projectRoot: string = process.cwd()): ConfigLoadResult {
  const loadedConfigs: Array<{ path: string; config: Record<string, unknown> }> = []

  for (const configDir of getConfigScopeDirs(projectRoot)) {
    const configPath = getPreferredConfigPath(configDir)
    if (!configPath) continue

    const parsed = parseConfigFile(configPath)
    if (!parsed) continue
    loadedConfigs.push({ path: configPath, config: parsed })
  }

  if (loadedConfigs.length === 0) {
    return { config: DEFAULT_CONFIG, configDir: null, configPaths: [], activePreset: null }
  }

  const mergedRawConfig = loadedConfigs.reduce<unknown>(
    (merged, loadedConfig) => deepMerge(merged, loadedConfig.config),
    {},
  )
  const result = UserConfigSchema.safeParse(mergedRawConfig)
  if (!result.success) {
    logError(`Invalid merged configuration: ${JSON.stringify(result.error.format())}`)
    return { config: DEFAULT_CONFIG, configDir: null, configPaths: [], activePreset: null }
  }

  const { config, activePreset } = applyActivePreset(result.data)

  const configPaths = loadedConfigs.map((loadedConfig) => loadedConfig.path)
  log(`Loaded config from ${configPaths.join(", ")}`)

  const highestPrecedenceConfig = loadedConfigs[loadedConfigs.length - 1]
  return {
    config,
    configDir: dirname(highestPrecedenceConfig.path),
    configPaths,
    activePreset,
  }
}

export function applyActivePreset(config: UserConfig): { config: UserConfig; activePreset: string | null } {
  const activePreset = resolveActivePreset(config)
  if (!activePreset) return { config, activePreset: null }

  const preset = config.presets[activePreset]
  const presetOverlay: Omit<PresetConfig, "description"> = {
    models: preset.models,
    orchestration: preset.orchestration,
  }
  const merged = deepMerge(config, presetOverlay) as Record<string, unknown>
  const result = UserConfigSchema.safeParse({ ...merged, preset: activePreset })
  if (!result.success) {
    logError(`Invalid preset '${activePreset}' after merge: ${JSON.stringify(result.error.format())}`)
    return { config, activePreset: null }
  }

  return { config: result.data, activePreset }
}

function resolveActivePreset(config: UserConfig): string | null {
  const candidates = [
    { source: "FELLOWSHIP_PRESET", value: process.env.FELLOWSHIP_PRESET },
    { source: "runtime preset state", value: readPresetSelection()?.activePreset },
    { source: "fellowship config", value: config.preset },
  ]

  for (const candidate of candidates) {
    const presetName = candidate.value?.trim()
    if (!presetName) continue
    if (Object.prototype.hasOwnProperty.call(config.presets, presetName)) return presetName
    logWarn(`Ignoring unknown preset '${presetName}' from ${candidate.source}`)
  }

  return null
}

export function parseConfig(config: unknown): UserConfig {
  if (!config || typeof config !== "object") return DEFAULT_CONFIG

  const result = UserConfigSchema.safeParse(config)
  if (!result.success) {
    logError(`Invalid configuration: ${JSON.stringify(result.error.format())}`)
    return DEFAULT_CONFIG
  }

  return result.data
}
