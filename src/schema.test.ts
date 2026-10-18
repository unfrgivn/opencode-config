import { describe, it, expect } from "bun:test"
import Ajv from "ajv"
import * as fs from "node:fs"
import * as path from "node:path"
import { DEFAULT_CONFIG, UserConfigSchema } from "./config"

const schemaPath = path.join(import.meta.dir, "..", "fellowship.schema.json")
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"))

function createValidator() {
  const ajv = new Ajv({ allErrors: true })
  return ajv.compile(schema)
}

describe("fellowship.schema.json", () => {
  it("is valid JSON Schema draft-07", () => {
    const ajv = new Ajv()
    const valid = ajv.validateSchema(schema)
    expect(valid).toBe(true)
  })

  it("validates DEFAULT_CONFIG", () => {
    const validate = createValidator()
    const valid = validate(DEFAULT_CONFIG)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)
  })

  it("validates empty object", () => {
    const validate = createValidator()
    expect(validate({})).toBe(true)
  })

  it("validates config with $schema property", () => {
    const validate = createValidator()
    expect(validate({ $schema: "./fellowship.schema.json" })).toBe(true)
  })

  it("validates minimal disable list", () => {
    const validate = createValidator()
    expect(validate({ disable: ["skill:example"] })).toBe(true)
  })

  it("validates agentOverrides for partial patches", () => {
    const validate = createValidator()
    expect(
      validate({
        agentOverrides: {
          planner: {
            temperature: 0.2,
          },
        },
      })
    ).toBe(true)
  })

  it("validates agentOverrides policy controls", () => {
    const validate = createValidator()
    expect(
      validate({
        agentOverrides: {
          researcher: {
            policy: {
              tools: { bash: false, webfetch: true },
              permission: { edit: "deny" },
              mcps: ["context7", "!chrome-devtools"],
              skills: ["*", "!terraform"],
            },
          },
        },
      })
    ).toBe(true)
  })

  it("rejects invalid agentOverrides policy controls", () => {
    const validate = createValidator()
    expect(
      validate({
        agentOverrides: {
          researcher: {
            policy: {
              tools: { bash: "false" },
            },
          },
        },
      })
    ).toBe(false)
    expect(
      validate({
        agentOverrides: {
          researcher: {
            policy: {
              unknown: true,
            },
          },
        },
      })
    ).toBe(false)
  })

  it("rejects out-of-range agentOverrides.temperature", () => {
    const validate = createValidator()
    expect(
      validate({
        agentOverrides: {
          planner: {
            temperature: 5,
          },
        },
      })
    ).toBe(false)
  })

  it("validates all installMethod values", () => {
    const validate = createValidator()
    expect(validate({ installMethod: "link" })).toBe(true)
    expect(validate({ installMethod: "copy" })).toBe(true)
    expect(validate({ installMethod: "invalid" })).toBe(false)
  })

  it("validates all agentNames values", () => {
    const validate = createValidator()
    expect(validate({ agentNames: "descriptive" })).toBe(true)
    expect(validate({ agentNames: "lotr" })).toBe(true)
    expect(validate({ agentNames: "invalid" })).toBe(false)
  })

  it("validates dryRun as boolean only", () => {
    const validate = createValidator()
    expect(validate({ dryRun: true })).toBe(true)
    expect(validate({ dryRun: false })).toBe(true)
    expect(validate({ dryRun: "yes" })).toBe(false)
  })

  it("validates models as object with string values", () => {
    const validate = createValidator()
    expect(validate({ models: {} })).toBe(true)
    expect(
      validate({
        models: {
          orchestrator: "anthropic/claude-opus-4",
          explorer: "github-copilot/claude-sonnet-4.6",
        },
      })
    ).toBe(true)
    expect(validate({ models: { explorer: "" } })).toBe(true)
  })

  it("rejects models with non-string values", () => {
    const validate = createValidator()
    expect(validate({ models: { explorer: 42 } })).toBe(false)
    expect(validate({ models: { explorer: true } })).toBe(false)
    expect(validate({ models: { explorer: null } })).toBe(false)
  })

  it("rejects models as non-object", () => {
    const validate = createValidator()
    expect(validate({ models: "bad" })).toBe(false)
    expect(validate({ models: ["bad"] })).toBe(false)
    expect(validate({ models: 42 })).toBe(false)
  })

  it("validates runtime presets", () => {
    const validate = createValidator()
    expect(
      validate({
        preset: "fast",
        presets: {
          fast: {
            description: "Favor quick responses",
            models: { orchestrator: "openai/gpt-5.5" },
            orchestration: {
              providerMode: "native",
              limits: { maxConcurrent: 2 },
            },
          },
        },
      })
    ).toBe(true)
  })

  it("rejects invalid runtime presets", () => {
    const validate = createValidator()
    expect(
      validate({
        presets: {
          fast: { unknown: true },
        },
      })
    ).toBe(false)
    expect(
      validate({
        presets: {
          fast: { models: { orchestrator: 42 } },
        },
      })
    ).toBe(false)
    expect(
      validate({
        presets: {
          fast: { orchestration: { limits: { maxConcurrent: 0 } } },
        },
      })
    ).toBe(false)
  })

  it("validates companion config", () => {
    const validate = createValidator()
    expect(
      validate({
        companion: {
          enabled: true,
          binaryPath: "/usr/local/bin/fellowship-companion",
          position: "bottom-left",
          size: "large",
          gifPack: "default",
          loopStyle: "smooth",
          speed: 1.25,
          debug: true,
        },
      })
    ).toBe(true)
  })

  it("rejects invalid companion config", () => {
    const validate = createValidator()
    expect(validate({ companion: { position: "center" } })).toBe(false)
    expect(validate({ companion: { size: "huge" } })).toBe(false)
    expect(validate({ companion: { loopStyle: "janky" } })).toBe(false)
    expect(validate({ companion: { speed: 0.1 } })).toBe(false)
    expect(validate({ companion: { extra: true } })).toBe(false)
  })

  it("rejects additional top-level properties", () => {
    const validate = createValidator()
    expect(validate({ unknownProp: "bad" })).toBe(false)
  })

  it("validates orchestration.providerMode", () => {
    const validate = createValidator()
    expect(
      validate({ orchestration: { providerMode: "copilot" } })
    ).toBe(true)
    expect(
      validate({ orchestration: { providerMode: "native" } })
    ).toBe(true)
    expect(
      validate({ orchestration: { providerMode: "invalid" } })
    ).toBe(false)
  })

  it("validates orchestration.features toggles", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          features: {
            delegation: false,
            diagnostics: false,
            vision: false,
            continuousLoop: false,
            selfHealing: false,
          },
        },
      })
    ).toBe(true)
  })

  it("rejects extra orchestration.features properties", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: { features: { unknownFeature: true } },
      })
    ).toBe(false)
  })

  it("validates orchestration.limits within bounds", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          limits: {
            maxConcurrent: 1,
            maxRetries: 0,
            maxIterations: 1,
            retryBackoffMs: 100,
            taskTimeoutMs: 1000,
          },
        },
      })
    ).toBe(true)

    expect(
      validate({
        orchestration: {
          limits: {
            maxConcurrent: 10,
            maxRetries: 5,
            maxIterations: 100,
            retryBackoffMs: 60000,
            taskTimeoutMs: 900000,
          },
        },
      })
    ).toBe(true)
  })

  it("validates shared concurrency limits", () => {
    const validate = createValidator()

    expect(validate({
      orchestration: {
        limits: {
          maxConcurrentGlobal: 3,
          providerMaxConcurrent: { copilot: 2, native: 1 },
        },
      },
    })).toBe(true)
  })

  it("rejects orchestration.limits out of bounds", () => {
    const validate = createValidator()
    expect(
      validate({ orchestration: { limits: { maxConcurrent: 0 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { maxConcurrent: 11 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { maxRetries: -1 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { maxRetries: 6 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { taskTimeoutMs: 999 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { taskTimeoutMs: 900001 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { maxConcurrentGlobal: 101 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { limits: { providerMaxConcurrent: { copilot: 0 } } } })
    ).toBe(false)
  })

  it("validates orchestration.runtimeFallback", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          runtimeFallback: {
            enabled: false,
            retryOnErrors: [429, 503],
            maxFallbackAttempts: 1,
            cooldownSeconds: 0,
            timeoutSeconds: 0,
            notifyOnFallback: false,
            providerOrder: ["native", "copilot"],
          },
        },
      })
    ).toBe(true)
  })

  it("rejects invalid providerOrder values", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          runtimeFallback: { providerOrder: ["invalid"] },
        },
      })
    ).toBe(false)
  })

  it("validates orchestration.hooks", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          hooks: {
            disabled: ["task-tracking", "fallback-engine"],
            telemetry: false,
          },
        },
      })
    ).toBe(true)
  })

  it("validates orchestration.notifications bounds", () => {
    const validate = createValidator()
    expect(
      validate({ orchestration: { notifications: { maxItems: 10 } } })
    ).toBe(true)
    expect(
      validate({ orchestration: { notifications: { maxItems: 500 } } })
    ).toBe(true)
    expect(
      validate({ orchestration: { notifications: { maxItems: 9 } } })
    ).toBe(false)
    expect(
      validate({ orchestration: { notifications: { maxItems: 501 } } })
    ).toBe(false)
  })

  it("validates orchestration.categories", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          categories: {
            routing: { quick: "native", heavy: "copilot" },
            maxConcurrent: { quick: 1, heavy: 5 },
          },
        },
      })
    ).toBe(true)
  })

  it("rejects invalid category routing values", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          categories: { routing: { quick: "invalid" } },
        },
      })
    ).toBe(false)
  })

  it("rejects out-of-bounds category maxConcurrent", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          categories: { maxConcurrent: { quick: 0 } },
        },
      })
    ).toBe(false)
    expect(
      validate({
        orchestration: {
          categories: { maxConcurrent: { quick: 11 } },
        },
      })
    ).toBe(false)
  })

  it("validates orchestration.recovery", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: { recovery: { autoResumeOnStart: false } },
      })
    ).toBe(true)
  })

  it("validates orchestration.tmux", () => {
    const validate = createValidator()
    expect(
      validate({
        orchestration: {
          tmux: { enabled: true, mode: "pane", layout: "main-vertical", mainPaneSize: 60, sessionPrefix: "my-prefix" },
        },
      })
    ).toBe(true)
  })

  it("rejects invalid tmux multiplexer settings", () => {
    const validate = createValidator()
    expect(validate({ orchestration: { tmux: { mode: "bad" } } })).toBe(false)
    expect(validate({ orchestration: { tmux: { layout: "spiral" } } })).toBe(false)
    expect(validate({ orchestration: { tmux: { mainPaneSize: 19 } } })).toBe(false)
    expect(validate({ orchestration: { tmux: { mainPaneSize: 81 } } })).toBe(false)
  })

  it("rejects invalid tmux sessionPrefix", () => {
    const validate = createValidator()
    // Too short
    expect(
      validate({
        orchestration: { tmux: { sessionPrefix: "a" } },
      })
    ).toBe(false)
    // Invalid characters
    expect(
      validate({
        orchestration: { tmux: { sessionPrefix: "bad prefix!" } },
      })
    ).toBe(false)
    // Too long (21 chars)
    expect(
      validate({
        orchestration: {
          tmux: { sessionPrefix: "a".repeat(21) },
        },
      })
    ).toBe(false)
  })

  it("rejects extra orchestration properties", () => {
    const validate = createValidator()
    expect(
      validate({ orchestration: { unknownProp: true } })
    ).toBe(false)
  })

  it("every DEFAULT_CONFIG value is accepted by both Zod and JSON Schema", () => {
    // Zod acceptance
    const zodResult = UserConfigSchema.safeParse(DEFAULT_CONFIG)
    expect(zodResult.success).toBe(true)

    // JSON Schema acceptance
    const validate = createValidator()
    const jsonSchemaValid = validate(DEFAULT_CONFIG)
    expect(validate.errors).toBeNull()
    expect(jsonSchemaValid).toBe(true)
  })

  it("validates a realistic full config", () => {
    const validate = createValidator()
    const fullConfig = {
      $schema: "./fellowship.schema.json",
      disable: ["skill:example", "agent:heavy", "!skill:keep-this"],
      installMethod: "copy",
      agentNames: "lotr",
      dryRun: true,
      models: {
        gandalf: "anthropic/claude-opus-4",
        legolas: "github-copilot/claude-sonnet-4.6",
      },
      orchestration: {
        providerMode: "native",
        features: {
          delegation: true,
          diagnostics: false,
          vision: true,
          continuousLoop: false,
          selfHealing: true,
        },
        limits: {
          maxConcurrent: 5,
          maxRetries: 3,
          maxIterations: 50,
          retryBackoffMs: 3000,
          taskTimeoutMs: 300000,
        },
        runtimeFallback: {
          enabled: true,
          retryOnErrors: [429, 500, 503],
          maxFallbackAttempts: 3,
          cooldownSeconds: 60,
          timeoutSeconds: 45,
          notifyOnFallback: true,
          providerOrder: ["native", "copilot"],
        },
        hooks: {
          disabled: ["timeout-enforcement"],
          telemetry: false,
        },
        notifications: {
          enabled: true,
          maxItems: 200,
        },
        categories: {
          routing: { quick: "native" },
          maxConcurrent: { quick: 1 },
        },
        recovery: {
          autoResumeOnStart: false,
        },
        tmux: {
          enabled: true,
          sessionPrefix: "ops",
        },
      },
    }
    const valid = validate(fullConfig)
    expect(validate.errors).toBeNull()
    expect(valid).toBe(true)

    // Also validate with Zod (Zod schema accepts $schema directly)
    const zodResult = UserConfigSchema.safeParse(fullConfig)
    expect(zodResult.success).toBe(true)
  })
})
