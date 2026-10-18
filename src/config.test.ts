import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  UserConfigSchema,
  DEFAULT_CONFIG,
  getConfigPaths,
  parseConfig,
  loadConfig,
  loadConfigWithLocation,
} from "./config"
import type { UserConfig } from "./config"
import { writePresetSelection } from "./preset-state"

describe("UserConfigSchema", () => {
  it("parses empty object with defaults", () => {
    const result = UserConfigSchema.parse({})
    expect(result).toEqual({
      disable: [],
      agentOverrides: {},
      installMethod: "link",
      dryRun: false,
      agentNames: "descriptive",
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
    })
  })

  it("parses full config", () => {
    const config = {
      disable: ["skill:example", "agent:heavy"],
      installMethod: "copy" as const,
    }
    const result = UserConfigSchema.parse(config)
    expect(result).toEqual({
      ...config,
      agentOverrides: {},
      agentNames: "descriptive",
      dryRun: false,
      presets: {},
      models: {},
      companion: DEFAULT_CONFIG.companion,
      orchestration: DEFAULT_CONFIG.orchestration,
    })
  })

  it("accepts companion config", () => {
    const result = UserConfigSchema.parse({
      companion: {
        enabled: true,
        binaryPath: "/usr/local/bin/fellowship-companion",
        position: "top-left",
        size: "large",
        gifPack: "default",
        loopStyle: "smooth",
        speed: 1.5,
        debug: true,
      },
    })

    expect(result.companion).toEqual({
      enabled: true,
      binaryPath: "/usr/local/bin/fellowship-companion",
      position: "top-left",
      size: "large",
      gifPack: "default",
      loopStyle: "smooth",
      speed: 1.5,
      debug: true,
    })
  })

  it("rejects invalid companion config", () => {
    expect(() =>
      UserConfigSchema.parse({
        companion: {
          enabled: true,
          position: "middle",
        },
      })
    ).toThrow()
    expect(() =>
      UserConfigSchema.parse({
        companion: {
          speed: 10,
        },
      })
    ).toThrow()
  })

  it("accepts preset definitions", () => {
    const result = UserConfigSchema.parse({
      preset: "fast",
      presets: {
        fast: {
          description: "Favor quick model responses",
          models: { orchestrator: "openai/gpt-5.5" },
          orchestration: {
            providerMode: "native",
            limits: { maxConcurrent: 2 },
          },
        },
      },
    })

    expect(result.preset).toBe("fast")
    expect(result.presets.fast).toEqual({
      description: "Favor quick model responses",
      models: { orchestrator: "openai/gpt-5.5" },
      orchestration: {
        providerMode: "native",
        limits: { maxConcurrent: 2 },
      },
    })
  })

  it("rejects unknown properties in preset definitions", () => {
    expect(() =>
      UserConfigSchema.parse({
        presets: {
          fast: { unknown: true },
        },
      })
    ).toThrow()
  })

  it("rejects unknown properties in preset orchestration overrides", () => {
    expect(() =>
      UserConfigSchema.parse({
        presets: {
          fast: {
            orchestration: { limits: { unknownLimit: 5 } },
          },
        },
      })
    ).toThrow()
  })

  it("accepts agentNames: descriptive", () => {
    const result = UserConfigSchema.parse({ agentNames: "descriptive" })
    expect(result.agentNames).toBe("descriptive")
  })

  it("rejects invalid agentNames value", () => {
    expect(() =>
      UserConfigSchema.parse({ agentNames: "invalid" })
    ).toThrow()
  })

  it("accepts models as empty object", () => {
    const result = UserConfigSchema.parse({ models: {} })
    expect(result.models).toEqual({})
  })

  it("accepts models with agent-to-model mappings", () => {
    const result = UserConfigSchema.parse({
      models: {
        orchestrator: "anthropic/claude-opus-4",
        explorer: "github-copilot/claude-sonnet-4.6",
      },
    })
    expect(result.models).toEqual({
      orchestrator: "anthropic/claude-opus-4",
      explorer: "github-copilot/claude-sonnet-4.6",
    })
  })

  it("accepts models with empty string values (fallback to default)", () => {
    const result = UserConfigSchema.parse({
      models: { explorer: "" },
    })
    expect(result.models).toEqual({ explorer: "" })
  })

  it("rejects models with non-string values", () => {
    expect(() =>
      UserConfigSchema.parse({ models: { explorer: 42 } })
    ).toThrow()
  })

  it("rejects models as an array", () => {
    expect(() =>
      UserConfigSchema.parse({ models: ["anthropic/claude-opus-4"] })
    ).toThrow()
  })

  it("defaults models to empty object when omitted", () => {
    const result = UserConfigSchema.parse({})
    expect(result.models).toEqual({})
  })

  it("rejects extra properties (strict mode)", () => {
    expect(() =>
      UserConfigSchema.parse({
        disable: [],
        extraField: "should fail",
      })
    ).toThrow()
  })

  it("rejects invalid installMethod", () => {
    expect(() =>
      UserConfigSchema.parse({
        installMethod: "invalid",
      })
    ).toThrow()
  })

  it("coerces disable to array from default", () => {
    const result = UserConfigSchema.parse({})
    expect(Array.isArray(result.disable)).toBe(true)
    expect(result.disable).toEqual([])
  })

  it("rejects ref as unknown property (strict mode)", () => {
    expect(() => UserConfigSchema.parse({ ref: "main" })).toThrow()
  })

  it("accepts $schema property", () => {
    const result = UserConfigSchema.parse({
      $schema: "./schemas/fellowship.schema.json",
    })
    expect(result.$schema).toBe(
      "./schemas/fellowship.schema.json"
    )
  })

  it("rejects unknown properties in nested orchestration objects (strict mode)", () => {
    expect(() =>
      UserConfigSchema.parse({
        orchestration: { unknownProp: true },
      })
    ).toThrow()
  })

  it("rejects unknown properties in nested features object (strict mode)", () => {
    expect(() =>
      UserConfigSchema.parse({
        orchestration: { features: { unknownFeature: true } },
      })
    ).toThrow()
  })

  it("rejects unknown properties in nested limits object (strict mode)", () => {
    expect(() =>
      UserConfigSchema.parse({
        orchestration: { limits: { unknownLimit: 5 } },
      })
    ).toThrow()
  })

  it("accepts shared concurrency limits", () => {
    const result = UserConfigSchema.parse({
      orchestration: {
        limits: {
          maxConcurrentGlobal: 6,
          providerMaxConcurrent: { copilot: 4, native: 2 },
        },
      },
    })

    expect(result.orchestration.limits.maxConcurrentGlobal).toBe(6)
    expect(result.orchestration.limits.providerMaxConcurrent).toEqual({ copilot: 4, native: 2 })
  })
})

describe("DEFAULT_CONFIG", () => {
  it("has correct default values", () => {
    expect(DEFAULT_CONFIG).toEqual({
      disable: [],
      agentOverrides: {},
      installMethod: "link",
      dryRun: false,
      agentNames: "descriptive",
      models: {},
      presets: {},
      companion: DEFAULT_CONFIG.companion,
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
    })
  })
})

describe("parseConfig", () => {
  it("returns DEFAULT_CONFIG for null", () => {
    const result = parseConfig(null)
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it("returns DEFAULT_CONFIG for undefined", () => {
    const result = parseConfig(undefined)
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it("returns DEFAULT_CONFIG for invalid config", () => {
    const result = parseConfig({ installMethod: "invalid" })
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it("parses valid config", () => {
    const config = {
      disable: ["skill:test"],
      installMethod: "copy" as const,
    }
    const result = parseConfig(config)
    expect(result).toEqual({
      ...config,
      agentOverrides: {},
      agentNames: "descriptive",
      dryRun: false,
      models: {},
      presets: {},
      companion: DEFAULT_CONFIG.companion,
      orchestration: DEFAULT_CONFIG.orchestration,
    })
  })

  it("handles partial config with defaults", () => {
    const result = parseConfig({ disable: ["agent:foo"] })
    expect(result).toEqual({
      disable: ["agent:foo"],
      agentOverrides: {},
      installMethod: "link",
      agentNames: "descriptive",
      dryRun: false,
      models: {},
      presets: {},
      companion: DEFAULT_CONFIG.companion,
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
    })
  })

  it("parses orchestration overrides", () => {
    const result = parseConfig({
      orchestration: {
        providerMode: "native",
        features: { vision: false, diagnostics: false },
        limits: { maxRetries: 4, maxConcurrent: 5 },
        categories: {
          routing: { quick: "native" },
          maxConcurrent: { quick: 1 },
        },
        recovery: { autoResumeOnStart: false },
        tmux: { enabled: true, mode: "pane", layout: "main-vertical", mainPaneSize: 60, sessionPrefix: "ops" },
      },
    })

    expect(result.orchestration.providerMode).toBe("native")
    expect(result.orchestration.features.vision).toBe(false)
    expect(result.orchestration.features.diagnostics).toBe(false)
    expect(result.orchestration.features.delegation).toBe(true)
    expect(result.orchestration.limits.maxRetries).toBe(4)
    expect(result.orchestration.limits.maxConcurrent).toBe(5)
    expect(result.orchestration.limits.maxIterations).toBe(25)
    expect(result.orchestration.runtimeFallback.enabled).toBe(true)
    expect(result.orchestration.runtimeFallback.maxFallbackAttempts).toBe(2)
    expect(result.orchestration.hooks.telemetry).toBe(true)
    expect(result.orchestration.notifications.enabled).toBe(true)
    expect(result.orchestration.categories.routing.quick).toBe("native")
    expect(result.orchestration.categories.maxConcurrent.quick).toBe(1)
    expect(result.orchestration.recovery.autoResumeOnStart).toBe(false)
    expect(result.orchestration.tmux.enabled).toBe(true)
    expect(result.orchestration.tmux.mode).toBe("pane")
    expect(result.orchestration.tmux.layout).toBe("main-vertical")
    expect(result.orchestration.tmux.mainPaneSize).toBe(60)
    expect(result.orchestration.tmux.sessionPrefix).toBe("ops")
  })

  it("parses agentOverrides for partial agent config patches", () => {
    const result = parseConfig({
      agentOverrides: {
        planner: {
          temperature: 0.2,
          permission: {
            bash: {
              "git log*": "allow",
            },
          },
        },
      },
    })

    expect(result.agentOverrides.planner).toEqual({
      temperature: 0.2,
      permission: {
        bash: {
          "git log*": "allow",
        },
      },
    })
  })

  it("parses agentOverrides policy controls", () => {
    const result = parseConfig({
      agentOverrides: {
        researcher: {
          policy: {
            tools: { bash: false },
            permission: { edit: "deny" },
            mcps: ["context7", "!chrome-devtools"],
            skills: ["*", "!terraform"],
          },
        },
      },
    })

    expect(result.agentOverrides.researcher.policy).toEqual({
      tools: { bash: false },
      permission: { edit: "deny" },
      mcps: ["context7", "!chrome-devtools"],
      skills: ["*", "!terraform"],
    })
  })

  it("rejects invalid agentOverrides policy controls", () => {
    expect(() =>
      UserConfigSchema.parse({
        agentOverrides: {
          researcher: {
            policy: {
              tools: { bash: "false" },
            },
          },
        },
      })
    ).toThrow()
  })
})

describe("getConfigPaths", () => {
  let originalCwd: string
  let tempDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"))
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns array of config paths", () => {
    const paths = getConfigPaths()
    expect(Array.isArray(paths)).toBe(true)
    expect(paths.length).toBeGreaterThan(0)
  })

  it("includes project-level config path", () => {
    const paths = getConfigPaths()
    const projectPaths = paths.filter((p) => p.includes(".opencode"))
    expect(projectPaths).toHaveLength(2)
    expect(projectPaths.some((p) => p.endsWith("fellowship.json"))).toBe(true)
    expect(projectPaths.some((p) => p.endsWith("fellowship.jsonc"))).toBe(true)
  })

  it("uses an explicit project root instead of the process working directory", () => {
    const projectRoot = path.join(tempDir, "project")
    const paths = getConfigPaths(projectRoot)

    expect(paths).toContain(path.join(projectRoot, ".opencode", "fellowship.json"))
    expect(paths).toContain(path.join(projectRoot, ".opencode", "fellowship.jsonc"))
  })

  it("includes user-level config path", () => {
    const paths = getConfigPaths()
    const userPaths = paths.filter((p) => p.includes(".config"))
    expect(userPaths).toHaveLength(2)
    expect(userPaths.some((p) => p.endsWith("fellowship.json"))).toBe(true)
    expect(userPaths.some((p) => p.endsWith("fellowship.jsonc"))).toBe(true)
  })
})

describe("loadConfig", () => {
  let originalCwd: string
  let originalHome: string | undefined
  let originalPresetEnv: string | undefined
  let tempDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    originalHome = process.env.HOME
    originalPresetEnv = process.env.FELLOWSHIP_PRESET
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-load-test-"))
    process.chdir(tempDir)
    process.env.HOME = tempDir
    delete process.env.FELLOWSHIP_PRESET
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalPresetEnv === undefined) {
      delete process.env.FELLOWSHIP_PRESET
    } else {
      process.env.FELLOWSHIP_PRESET = originalPresetEnv
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns DEFAULT_CONFIG when no config file exists", () => {
    const config = loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it("loads config from project .opencode directory", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({ disable: ["skill:test"], installMethod: "copy" })
    )

    const config = loadConfig()
    expect(config.disable).toEqual(["skill:test"])
    expect(config.installMethod).toBe("copy")
  })

  it("loads JSONC config with comments and trailing commas", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.jsonc"),
      `{
  // disable one thing
  "disable": ["skill:test"],
  "installMethod": "copy",
}`,
    )

    const config = loadConfig()
    expect(config.disable).toEqual(["skill:test"])
    expect(config.installMethod).toBe("copy")
  })

  it("loads config with a UTF-8 byte order mark", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.jsonc"),
      `\uFEFF{ "disable": ["skill:test"] }`,
    )

    expect(loadConfig().disable).toEqual(["skill:test"])
  })

  it("merges user config with project config, with project values winning", () => {
    const userConfigDir = path.join(tempDir, ".config", "opencode")
    const projectConfigDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(userConfigDir, { recursive: true })
    fs.mkdirSync(projectConfigDir, { recursive: true })
    fs.writeFileSync(
      path.join(userConfigDir, "fellowship.json"),
      JSON.stringify({
        disable: ["skill:user-only"],
        installMethod: "copy",
        models: { explorer: "github-copilot/claude-sonnet-4.6" },
        orchestration: {
          features: { vision: false },
          limits: { maxConcurrent: 2, maxRetries: 4 },
        },
      }),
    )
    fs.writeFileSync(
      path.join(projectConfigDir, "fellowship.json"),
      JSON.stringify({
        disable: ["skill:project-only"],
        models: { orchestrator: "github-copilot/gpt-5.5" },
        orchestration: {
          limits: { maxConcurrent: 5 },
        },
      }),
    )

    const config = loadConfig()

    expect(config.disable).toEqual(["skill:project-only"])
    expect(config.installMethod).toBe("copy")
    expect(config.models).toEqual({
      explorer: "github-copilot/claude-sonnet-4.6",
      orchestrator: "github-copilot/gpt-5.5",
    })
    expect(config.orchestration.features.vision).toBe(false)
    expect(config.orchestration.limits.maxConcurrent).toBe(5)
    expect(config.orchestration.limits.maxRetries).toBe(4)
  })

  it("prefers .jsonc over .json within the same config scope", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({ disable: ["skill:json"], installMethod: "copy" }),
    )
    fs.writeFileSync(
      path.join(configDir, "fellowship.jsonc"),
      `{
  "disable": ["skill:jsonc"],
}`,
    )

    const { config, configPaths } = loadConfigWithLocation()

    expect(config.disable).toEqual(["skill:jsonc"])
    expect(config.installMethod).toBe("link")
    expect(configPaths).toHaveLength(1)
    expect(configPaths[0].endsWith("fellowship.jsonc")).toBe(true)
  })

  it("skips invalid higher-precedence config and keeps valid user config", () => {
    const userConfigDir = path.join(tempDir, ".config", "opencode")
    const projectConfigDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(userConfigDir, { recursive: true })
    fs.mkdirSync(projectConfigDir, { recursive: true })
    fs.writeFileSync(
      path.join(userConfigDir, "fellowship.json"),
      JSON.stringify({ disable: ["skill:user-valid"], installMethod: "copy" }),
    )
    fs.writeFileSync(path.join(projectConfigDir, "fellowship.json"), "{ invalid json }")

    const config = loadConfig()

    expect(config.disable).toEqual(["skill:user-valid"])
    expect(config.installMethod).toBe("copy")
  })

  it("applies the config-defined active preset", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({
        preset: "fast",
        models: { explorer: "github-copilot/claude-sonnet-4.6" },
        orchestration: { limits: { maxConcurrent: 2, maxRetries: 3 } },
        presets: {
          fast: {
            models: { orchestrator: "openai/gpt-5.5" },
            orchestration: {
              providerMode: "native",
              limits: { maxConcurrent: 5 },
            },
          },
        },
      }),
    )

    const { config, activePreset } = loadConfigWithLocation()

    expect(activePreset).toBe("fast")
    expect(config.preset).toBe("fast")
    expect(config.models).toEqual({
      explorer: "github-copilot/claude-sonnet-4.6",
      orchestrator: "openai/gpt-5.5",
    })
    expect(config.orchestration.providerMode).toBe("native")
    expect(config.orchestration.limits.maxConcurrent).toBe(5)
    expect(config.orchestration.limits.maxRetries).toBe(3)
  })

  it("lets runtime preset state override the config preset", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({
        preset: "fast",
        presets: {
          fast: { models: { orchestrator: "openai/gpt-5.5" } },
          cheap: { models: { orchestrator: "github-copilot/gpt-5-mini" } },
        },
      }),
    )
    writePresetSelection("cheap")

    const { config, activePreset } = loadConfigWithLocation()

    expect(activePreset).toBe("cheap")
    expect(config.preset).toBe("cheap")
    expect(config.models.orchestrator).toBe("github-copilot/gpt-5-mini")
  })

  it("lets FELLOWSHIP_PRESET override runtime and config presets", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({
        preset: "fast",
        presets: {
          fast: { models: { orchestrator: "openai/gpt-5.5" } },
          cheap: { models: { orchestrator: "github-copilot/gpt-5-mini" } },
          careful: { models: { orchestrator: "anthropic/claude-opus-4-1" } },
        },
      }),
    )
    writePresetSelection("cheap")
    process.env.FELLOWSHIP_PRESET = "careful"

    const { config, activePreset } = loadConfigWithLocation()

    expect(activePreset).toBe("careful")
    expect(config.preset).toBe("careful")
    expect(config.models.orchestrator).toBe("anthropic/claude-opus-4-1")
  })

  it("falls back to lower-precedence presets when env selection is unknown", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "fellowship.json"),
      JSON.stringify({
        preset: "fast",
        presets: {
          fast: { models: { orchestrator: "openai/gpt-5.5" } },
        },
      }),
    )
    process.env.FELLOWSHIP_PRESET = "missing"

    const { config, activePreset } = loadConfigWithLocation()

    expect(activePreset).toBe("fast")
    expect(config.models.orchestrator).toBe("openai/gpt-5.5")
  })

  it("handles malformed JSON gracefully", () => {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "fellowship.json"), "{ invalid json }")

    const config = loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
  })
})

describe("loadConfigWithLocation", () => {
  let originalCwd: string
  let originalHome: string | undefined
  let tempDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    originalHome = process.env.HOME
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-loc-test-"))
    process.chdir(tempDir)
    process.env.HOME = tempDir
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns null configDir when no config file exists", () => {
    const { config, configDir } = loadConfigWithLocation()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(configDir).toBeNull()
  })

  it("returns configDir when config file exists", () => {
    const configDirPath = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDirPath, { recursive: true })
    fs.writeFileSync(
      path.join(configDirPath, "fellowship.json"),
      JSON.stringify({ disable: [] })
    )

    const { config, configDir } = loadConfigWithLocation()
    // Use fs.realpathSync to normalize macOS /var -> /private/var
    expect(fs.realpathSync(configDir!)).toBe(fs.realpathSync(configDirPath))
    expect(config.disable).toEqual([])
  })

  it("loads project config from an explicit project root", () => {
    const projectRoot = path.join(tempDir, "project")
    const configDirPath = path.join(projectRoot, ".opencode")
    fs.mkdirSync(configDirPath, { recursive: true })
    fs.writeFileSync(path.join(configDirPath, "fellowship.json"), JSON.stringify({ disable: ["agent:example"] }))

    const { config, configDir } = loadConfigWithLocation(projectRoot)

    expect(fs.realpathSync(configDir!)).toBe(fs.realpathSync(configDirPath))
    expect(config.disable).toEqual(["agent:example"])
  })

  it("returns the highest-precedence configDir and all loaded config paths", () => {
    const userConfigDir = path.join(tempDir, ".config", "opencode")
    const projectConfigDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(userConfigDir, { recursive: true })
    fs.mkdirSync(projectConfigDir, { recursive: true })
    fs.writeFileSync(path.join(userConfigDir, "fellowship.json"), JSON.stringify({ installMethod: "copy" }))
    fs.writeFileSync(path.join(projectConfigDir, "fellowship.json"), JSON.stringify({ disable: ["skill:project"] }))

    const { config, configDir, configPaths } = loadConfigWithLocation()

    expect(fs.realpathSync(configDir!)).toBe(fs.realpathSync(projectConfigDir))
    expect(config.installMethod).toBe("copy")
    expect(config.disable).toEqual(["skill:project"])
    expect(configPaths.map((configPath) => path.basename(configPath))).toEqual([
      "fellowship.json",
      "fellowship.json",
    ])
    expect(fs.realpathSync(path.dirname(configPaths[0]))).toBe(fs.realpathSync(userConfigDir))
    expect(fs.realpathSync(path.dirname(configPaths[1]))).toBe(fs.realpathSync(projectConfigDir))
  })

  it("loads .jsonc config when .json is absent", () => {
    const configDirPath = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDirPath, { recursive: true })
    fs.writeFileSync(
      path.join(configDirPath, "fellowship.jsonc"),
      `{
  "disable": ["agent:example"],
}`,
    )

    const { config, configDir } = loadConfigWithLocation()
    expect(fs.realpathSync(configDir!)).toBe(fs.realpathSync(configDirPath))
    expect(config.disable).toEqual(["agent:example"])
  })
})
