import { describe, test, expect } from "bun:test"
import type { AgentConfig } from "./agent"
import { lookupAgentAlias } from "./agent-names"


/**
 * Tests for agent config injection logic.
 * These tests verify the core behavior of how agents are injected
 * into the OpenCode config, respecting user priority.
 */

interface RemoteAgent {
  config: AgentConfig
  source: string
}

const DEFAULT_AGENTS_TO_DISABLE = ["build", "plan", "general", "explore"] as const

/**
 * Inject agents into config with user config priority.
 * This mirrors the logic in the config hook.
 */
function injectAgents(
  config: { agent?: Record<string, AgentConfig | undefined> },
  remoteAgents: Map<string, RemoteAgent>
): { injected: string[]; skipped: string[] } {
  const injected: string[] = []
  const skipped: string[] = []

  if (remoteAgents.size === 0) return { injected, skipped }

  if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
    return { injected, skipped }
  }
  config.agent = config.agent || {}

  for (const [name, { config: agentConfig }] of remoteAgents) {
    // Use hasOwnProperty to correctly handle falsy values (null, undefined set by user)
    if (Object.prototype.hasOwnProperty.call(config.agent, name)) {
      skipped.push(name)
      continue
    }

    config.agent[name] = agentConfig
    injected.push(name)
  }

  return { injected, skipped }
}

/**
 * Inject agents into config with user config priority and model overrides.
 * This mirrors the updated logic in the config hook that applies
 * fellowship.json models map before injection.
 */
function injectAgentsWithModels(
  config: { agent?: Record<string, AgentConfig | undefined> },
  remoteAgents: Map<string, RemoteAgent>,
  models: Record<string, string>
): { injected: string[]; skipped: string[]; modelOverrides: string[] } {
  const injected: string[] = []
  const skipped: string[] = []
  const modelOverrides: string[] = []

  if (remoteAgents.size === 0) return { injected, skipped, modelOverrides }

  if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
    return { injected, skipped, modelOverrides }
  }
  config.agent = config.agent || {}

  for (const [name, { config: agentConfig }] of remoteAgents) {
    if (Object.prototype.hasOwnProperty.call(config.agent, name)) {
      skipped.push(name)
      continue
    }

    const modelOverrideMatch = lookupAgentAlias(models, name)
    const modelOverride = modelOverrideMatch?.value
    if (modelOverride) {
      config.agent[name] = { ...agentConfig, model: modelOverride }
      modelOverrides.push(name)
    } else {
      config.agent[name] = agentConfig
    }
    injected.push(name)
  }

  return { injected, skipped, modelOverrides }
}

function disableDefaultAgents(
  config: { agent?: Record<string, AgentConfig | null | undefined> }
): string[] {
  const changed: string[] = []

  if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
    return changed
  }

  config.agent = config.agent || {}

  for (const agentName of DEFAULT_AGENTS_TO_DISABLE) {
    const current = config.agent[agentName]
    const currentRecord =
      typeof current === "object" && current !== null
        ? current
        : {}
    const wasSubagent = currentRecord.mode === "subagent"
    const wasHidden = currentRecord.hidden === true

    config.agent[agentName] = {
      ...currentRecord,
      mode: "subagent",
      hidden: true,
      description:
        typeof currentRecord.description === "string"
          ? currentRecord.description
          : "Hidden by @unfrgivn/opencode-config plugin",
    }
    if (!wasSubagent || !wasHidden) {
      changed.push(agentName)
    }
  }

  return changed
}

/**
 * Inject instructions into config.
 * Returns true if injection succeeded, false if skipped due to invalid type.
 *
 * NOTE: This helper mirrors production logic from the config hook in index.ts.
 * Since production code is encapsulated in the plugin closure, we cannot directly
 * test it. This approach has a known limitation: if both the helper and production
 * code have the same bug, tests would pass incorrectly.
 *
 * To mitigate this risk, tests focus on:
 * - Input validation (invalid types rejected)
 * - Edge cases (empty inputs, type coercion from string to array)
 * - Expected output shapes for given inputs
 *
 * rather than verifying the injection algorithm itself.
 */
function injectInstructions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: { instructions?: any },
  remoteInstructions: string[]
): boolean {
  if (remoteInstructions.length === 0) return true

  // Validate config.instructions type: must be undefined, string, or string[]
  if (config.instructions !== undefined &&
      typeof config.instructions !== "string" &&
      !Array.isArray(config.instructions)) {
    return false
  }

  // Validate array contents are all strings
  if (Array.isArray(config.instructions) &&
      !config.instructions.every((x: unknown) => typeof x === "string")) {
    return false
  }

  // Ensure config.instructions is an array
  if (!Array.isArray(config.instructions)) {
    config.instructions = config.instructions ? [config.instructions] : []
  }

  // Append all remote instructions
  config.instructions.push(...remoteInstructions)
  return true
}

describe("config injection", () => {
  test("disables default OpenCode agents when missing", () => {
    const config: { agent?: Record<string, AgentConfig | null | undefined> } = {}

    const disabled = disableDefaultAgents(config)

    expect(disabled).toEqual(["build", "plan", "general", "explore"])
    expect(config.agent?.build?.mode).toBe("subagent")
    expect(config.agent?.plan?.mode).toBe("subagent")
    expect(config.agent?.general?.mode).toBe("subagent")
    expect(config.agent?.explore?.mode).toBe("subagent")
    expect(config.agent?.build?.hidden).toBe(true)
    expect(config.agent?.plan?.hidden).toBe(true)
    expect(config.agent?.general?.hidden).toBe(true)
    expect(config.agent?.explore?.hidden).toBe(true)
  })

  test("forces demote/hide on existing default OpenCode agents", () => {
    const config: { agent?: Record<string, AgentConfig | null | undefined> } = {
      agent: {
        build: { description: "User build", mode: "primary" },
        plan: null,
        general: { description: "User general", mode: "primary" },
        explore: null,
      },
    }

    const changed = disableDefaultAgents(config)

    expect(changed).toEqual(["build", "plan", "general", "explore"])
    expect(config.agent?.build?.description).toBe("User build")
    expect(config.agent?.build?.mode).toBe("subagent")
    expect(config.agent?.build?.hidden).toBe(true)
    expect(config.agent?.plan?.mode).toBe("subagent")
    expect(config.agent?.plan?.hidden).toBe(true)
    expect(config.agent?.general?.description).toBe("User general")
    expect(config.agent?.general?.mode).toBe("subagent")
    expect(config.agent?.general?.hidden).toBe(true)
    expect(config.agent?.explore?.mode).toBe("subagent")
    expect(config.agent?.explore?.hidden).toBe(true)
  })

  test("injects agents into empty config", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["agent-1", { config: { description: "Agent 1" }, source: "repo" }],
      ["agent-2", { config: { description: "Agent 2" }, source: "repo" }],
    ])

    const { injected, skipped } = injectAgents(config, remoteAgents)

    expect(injected).toEqual(["agent-1", "agent-2"])
    expect(skipped).toEqual([])
    expect(config.agent?.["agent-1"]?.description).toBe("Agent 1")
    expect(config.agent?.["agent-2"]?.description).toBe("Agent 2")
  })

  test("respects existing user config (user priority)", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {
      agent: {
        "my-agent": { description: "User's agent", mode: "primary" },
      },
    }
    const remoteAgents = new Map<string, RemoteAgent>([
      ["my-agent", { config: { description: "Remote agent" }, source: "repo" }],
      ["new-agent", { config: { description: "New agent" }, source: "repo" }],
    ])

    const { injected, skipped } = injectAgents(config, remoteAgents)

    expect(injected).toEqual(["new-agent"])
    expect(skipped).toEqual(["my-agent"])
    // User's config preserved
    expect(config.agent?.["my-agent"]?.description).toBe("User's agent")
    expect(config.agent?.["my-agent"]?.mode).toBe("primary")
    // New agent added
    expect(config.agent?.["new-agent"]?.description).toBe("New agent")
  })

  test("handles empty remote agents", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {
      agent: { existing: { description: "Existing" } },
    }
    const remoteAgents = new Map<string, RemoteAgent>()

    const { injected, skipped } = injectAgents(config, remoteAgents)

    expect(injected).toEqual([])
    expect(skipped).toEqual([])
    expect(config.agent?.["existing"]?.description).toBe("Existing")
  })

  test("respects user's null value (does not overwrite)", () => {
    // User explicitly set an agent to null (disabled)
    const config: { agent?: Record<string, AgentConfig | null | undefined> } = {
      agent: {
        "disabled-agent": null,
      },
    }
    const remoteAgents = new Map<string, RemoteAgent>([
      ["disabled-agent", { config: { description: "Remote version" }, source: "repo" }],
      ["new-agent", { config: { description: "New agent" }, source: "repo" }],
    ])

    const { injected, skipped } = injectAgents(config as any, remoteAgents)

    // disabled-agent should be skipped because user has it (even though null)
    expect(skipped).toContain("disabled-agent")
    expect(injected).toContain("new-agent")
    // User's null value preserved
    expect(config.agent?.["disabled-agent"]).toBeNull()
  })

  test("creates agent object if undefined", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {
      agent: undefined,
    }
    const remoteAgents = new Map<string, RemoteAgent>([
      ["new", { config: { description: "New" }, source: "repo" }],
    ])

    injectAgents(config, remoteAgents)

    expect(config.agent).toBeDefined()
    expect(config.agent?.["new"]?.description).toBe("New")
  })
})

describe("instruction injection", () => {
  test("injects instructions into empty config", () => {
    const config: { instructions?: string | string[] } = {}
    const remoteInstructions = ["/path/to/instruction1.md", "/path/to/instruction2.md"]

    injectInstructions(config, remoteInstructions)

    expect(config.instructions).toEqual(["/path/to/instruction1.md", "/path/to/instruction2.md"])
  })

  test("appends to existing array config", () => {
    const config: { instructions?: string | string[] } = {
      instructions: ["/existing/instruction.md"],
    }
    const remoteInstructions = ["/remote/instruction.md"]

    injectInstructions(config, remoteInstructions)

    expect(config.instructions).toEqual(["/existing/instruction.md", "/remote/instruction.md"])
  })

  test("converts string config to array and appends", () => {
    const config: { instructions?: string | string[] } = {
      instructions: "/user/instruction.md",
    }
    const remoteInstructions = ["/remote/instruction.md"]

    injectInstructions(config, remoteInstructions)

    expect(config.instructions).toEqual(["/user/instruction.md", "/remote/instruction.md"])
  })

  test("does nothing with empty remote instructions", () => {
    const config: { instructions?: string | string[] } = {
      instructions: ["/existing/instruction.md"],
    }

    injectInstructions(config, [])

    expect(config.instructions).toEqual(["/existing/instruction.md"])
  })

  test("handles undefined instructions config", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: undefined,
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(true)
    expect(config.instructions).toEqual(["/remote/instruction.md"])
  })

  test("skips injection when config.instructions is an object", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: { invalid: "object" },
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toEqual({ invalid: "object" }) // unchanged
  })

  test("skips injection when config.instructions is a number", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: 42,
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toBe(42) // unchanged
  })

  test("skips injection when config.instructions is a boolean", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: true,
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toBe(true) // unchanged
  })

  test("skips injection when config.instructions is null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: null,
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toBe(null) // unchanged
  })

  test("skips injection when config.instructions array contains a number", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: [42],
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toEqual([42]) // unchanged
  })

  test("skips injection when config.instructions array contains null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: [null],
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toEqual([null]) // unchanged
  })

  test("skips injection when config.instructions array has mixed types", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: ["/valid/path.md", 42, null],
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(false)
    expect(config.instructions).toEqual(["/valid/path.md", 42, null]) // unchanged
  })

  test("allows injection when config.instructions is valid string array", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: { instructions?: any } = {
      instructions: ["/valid/path1.md", "/valid/path2.md"],
    }
    const remoteInstructions = ["/remote/instruction.md"]

    const result = injectInstructions(config, remoteInstructions)

    expect(result).toBe(true)
    expect(config.instructions).toEqual(["/valid/path1.md", "/valid/path2.md", "/remote/instruction.md"])
  })
})

describe("model overrides", () => {
  test("applies model override from models map", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      explorer: "anthropic/claude-opus-4",
    })

    expect(injected).toEqual(["explorer"])
    expect(modelOverrides).toEqual(["explorer"])
    expect(config.agent?.explorer?.model).toBe("anthropic/claude-opus-4")
    // Rest of config preserved
    expect(config.agent?.explorer?.description).toBe("Explorer")
  })

  test("falls back to plugin default when agent is omitted from models map", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {})

    expect(injected).toEqual(["explorer"])
    expect(modelOverrides).toEqual([])
    expect(config.agent?.explorer?.model).toBe("github-copilot/claude-sonnet-4.6")
  })

  test("falls back to plugin default when model value is empty string", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      explorer: "",
    })

    expect(injected).toEqual(["explorer"])
    expect(modelOverrides).toEqual([])
    expect(config.agent?.explorer?.model).toBe("github-copilot/claude-sonnet-4.6")
  })

  test("overrides some agents while others keep defaults", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["orchestrator", { config: { description: "Orchestrator", model: "github-copilot/claude-opus-4.6" }, source: "repo" }],
      ["explorer", { config: { description: "Explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
      ["analyst", { config: { description: "Analyst", model: "github-copilot/gemini-3.1-pro" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      orchestrator: "anthropic/claude-opus-4",
      // explorer omitted = keep default
      analyst: "",  // empty = keep default
    })

    expect(injected).toEqual(["orchestrator", "explorer", "analyst"])
    expect(modelOverrides).toEqual(["orchestrator"])
    expect(config.agent?.orchestrator?.model).toBe("anthropic/claude-opus-4")
    expect(config.agent?.explorer?.model).toBe("github-copilot/claude-sonnet-4.6")
    expect(config.agent?.analyst?.model).toBe("github-copilot/gemini-3.1-pro")
  })

  test("preserves all non-model config when overriding model", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const agentConfig: AgentConfig = {
      description: "Explorer agent",
      model: "github-copilot/claude-sonnet-4.6",
      temperature: 0.1,
      mode: "subagent",
      steps: 30,
      prompt: "You are an explorer.",
    }
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: agentConfig, source: "repo" }],
    ])

    injectAgentsWithModels(config, remoteAgents, {
      explorer: "anthropic/claude-opus-4",
    })

    const injected = config.agent?.explorer
    expect(injected?.model).toBe("anthropic/claude-opus-4")
    expect(injected?.description).toBe("Explorer agent")
    expect(injected?.temperature).toBe(0.1)
    expect(injected?.mode).toBe("subagent")
    expect(injected?.steps).toBe(30)
    expect(injected?.prompt).toBe("You are an explorer.")
  })

  test("does not apply model override to user-defined agents", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {
      agent: {
        explorer: { description: "User's explorer", model: "user/custom-model" },
      },
    }
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Bundled explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
    ])

    const { injected, skipped, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      explorer: "anthropic/claude-opus-4",
    })

    expect(injected).toEqual([])
    expect(skipped).toEqual(["explorer"])
    expect(modelOverrides).toEqual([])
    // User's config preserved, not overwritten by models map
    expect(config.agent?.explorer?.model).toBe("user/custom-model")
    expect(config.agent?.explorer?.description).toBe("User's explorer")
  })

  test("models map entry for non-existent agent is harmlessly ignored", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Explorer", model: "github-copilot/claude-sonnet-4.6" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      nonexistent: "anthropic/claude-opus-4",
    })

    expect(injected).toEqual(["explorer"])
    expect(modelOverrides).toEqual([])
    expect(config.agent?.explorer?.model).toBe("github-copilot/claude-sonnet-4.6")
    // No "nonexistent" agent was created
    expect(config.agent?.nonexistent).toBeUndefined()
  })

  test("overrides model even when agent has no model defined in frontmatter", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["explorer", { config: { description: "Explorer" }, source: "repo" }],
    ])

    const { modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      explorer: "anthropic/claude-opus-4",
    })

    expect(modelOverrides).toEqual(["explorer"])
    expect(config.agent?.explorer?.model).toBe("anthropic/claude-opus-4")
  })

  test("accepts LOTR alias when remote agent uses descriptive name", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["orchestrator", { config: { description: "Orchestrator", model: "github-copilot/claude-opus-4.6" }, source: "repo" }],
    ])

    const { injected, modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      gandalf: "anthropic/claude-opus-4",
    })

    expect(injected).toEqual(["orchestrator"])
    expect(modelOverrides).toEqual(["orchestrator"])
    expect(config.agent?.orchestrator?.model).toBe("anthropic/claude-opus-4")
  })

  test("prefers exact key when both descriptive and LOTR model overrides exist", () => {
    const config: { agent?: Record<string, AgentConfig | undefined> } = {}
    const remoteAgents = new Map<string, RemoteAgent>([
      ["orchestrator", { config: { description: "Orchestrator", model: "github-copilot/claude-opus-4.6" }, source: "repo" }],
    ])

    const { modelOverrides } = injectAgentsWithModels(config, remoteAgents, {
      orchestrator: "anthropic/claude-opus-4",
      gandalf: "openai/gpt-5",
    })

    expect(modelOverrides).toEqual(["orchestrator"])
    expect(config.agent?.orchestrator?.model).toBe("anthropic/claude-opus-4")
  })
})
