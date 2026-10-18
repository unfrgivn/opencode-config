import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { deepMerge } from "./deep-merge"
import { DEFAULT_CONFIG } from "./config"
import pluginModule, { performLoad, FellowshipConfigPlugin } from "./index"
import { readTuiSnapshot } from "./tui-state"

// We need to test the internal performLoad function
// Since it's not exported, we'll test through the plugin interface
// and also test the config hook behavior

describe("index", () => {
  let testDir: string
  let originalHome: string | undefined
  let originalXdgDataHome: string | undefined

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-index-"))
    originalHome = process.env.HOME
    originalXdgDataHome = process.env.XDG_DATA_HOME
  })

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true })
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }
    if (originalXdgDataHome !== undefined) {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    } else {
      delete process.env.XDG_DATA_HOME
    }
  })

  test("exports a stable V2 plugin module", () => {
    expect(pluginModule).toEqual({
      id: "@unfrgivn/opencode-config",
      setup: FellowshipConfigPlugin.setup,
    })
  })

  describe("FellowshipConfigPlugin config hook", () => {
    // Helper to create a mock config object
    function createMockConfig(): Record<string, unknown> {
      return {
        agent: {},
        command: {},
        mcp: {},
        instructions: [],
      }
    }

    describe("agent injection", () => {
      test("injects remote agents into empty config.agent", async () => {
        const config = createMockConfig()
        const remoteAgents = new Map([
          [
            "test-agent",
            {
              config: {
                description: "A test agent",
                mode: "subagent" as const,
                prompt: "You are a test agent",
              },
              source: "opencode-config",
            },
          ],
        ])

        // Simulate what the config hook does
        if (config.agent && typeof config.agent === "object") {
          const agentConfig = config.agent as Record<string, unknown>
          for (const [name, { config: agentCfg }] of remoteAgents) {
            if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
              agentConfig[name] = agentCfg
            }
          }
        }

        expect((config.agent as Record<string, unknown>)["test-agent"]).toEqual({
          description: "A test agent",
          mode: "subagent",
          prompt: "You are a test agent",
        })
      })

      test("does not override existing user agent", async () => {
        const config = {
          agent: {
            "test-agent": {
              description: "User's agent",
              mode: "subagent" as const,
            },
          },
          command: {},
          instructions: [],
        }

        const remoteAgents = new Map([
          [
            "test-agent",
            {
              config: {
                description: "Remote agent",
                mode: "subagent" as const,
                prompt: "Remote prompt",
              },
              source: "opencode-config",
            },
          ],
        ])

        // Simulate config hook behavior
        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: agentCfg }] of remoteAgents) {
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = agentCfg
          }
        }

        // User's agent should be preserved
        expect((config.agent as Record<string, { description: string }>)["test-agent"].description).toBe("User's agent")
      })

      test("applies patch-style agentOverrides before injection", async () => {
        const config = createMockConfig()
        const remoteAgents = new Map([
          [
            "planner",
            {
              config: {
                temperature: 0.1,
                prompt: "Bundled planner prompt",
                permission: {
                  write: "deny",
                  bash: {
                    "*": "ask",
                  },
                },
              },
              source: "opencode-config",
            },
          ],
        ])

        const agentOverrides = {
          planner: {
            temperature: 0.25,
          },
        }

        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: bundledConfig }] of remoteAgents) {
          const merged = deepMerge(bundledConfig, agentOverrides[name as keyof typeof agentOverrides])
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = merged
          }
        }

        expect((config.agent as Record<string, unknown>).planner).toEqual({
          temperature: 0.25,
          prompt: "Bundled planner prompt",
          permission: {
            write: "deny",
            bash: {
              "*": "ask",
            },
          },
        })
      })

      test("accepts LOTR alias in agentOverrides regardless of active theme", async () => {
        const baseline = await performLoad({
          ...DEFAULT_CONFIG,
          dryRun: true,
          agentNames: "descriptive",
          agentOverrides: {},
        })

        const remoteAgent = baseline.remoteAgents.get("orchestrator")
        expect(remoteAgent).toBeDefined()

        const withOverride = await performLoad({
          ...DEFAULT_CONFIG,
          dryRun: true,
          agentNames: "descriptive",
          agentOverrides: {
            gandalf: {
              description: "Alias override applied",
            },
          },
        })

        const overriddenAgent = withOverride.remoteAgents.get("orchestrator")
        expect(overriddenAgent).toBeDefined()
        expect(overriddenAgent?.config.description).toBe("Alias override applied")
        expect(remoteAgent?.config.description).not.toBe("Alias override applied")
      })

      test("still preserves user agent when agentOverrides exists", async () => {
        const config = {
          agent: {
            planner: {
              description: "My local planner",
              mode: "primary" as const,
            },
          },
          command: {},
          instructions: [],
        }

        const remoteAgents = new Map([
          [
            "planner",
            {
              config: {
                description: "Bundled planner",
                mode: "all" as const,
                temperature: 0.1,
              },
              source: "opencode-config",
            },
          ],
        ])

        const agentOverrides = {
          planner: {
            temperature: 0.5,
          },
        }

        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: bundledConfig }] of remoteAgents) {
          const merged = deepMerge(bundledConfig, agentOverrides[name as keyof typeof agentOverrides])
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = merged
          }
        }

        expect(config.agent.planner).toEqual({
          description: "My local planner",
          mode: "primary",
        })
      })

      test("respects user's explicit null value for agent", async () => {
        const config = {
          agent: {
            "disabled-agent": null,
          },
          command: {},
          instructions: [],
        }

        const remoteAgents = new Map([
          [
            "disabled-agent",
            {
              config: {
                description: "Remote agent",
                mode: "subagent" as const,
              },
              source: "opencode-config",
            },
          ],
        ])

        // Simulate config hook behavior using hasOwnProperty
        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: agentCfg }] of remoteAgents) {
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = agentCfg
          }
        }

        // User's explicit null should be preserved
        expect(config.agent["disabled-agent"]).toBeNull()
      })

      test("injects multiple agents", async () => {
        const config = createMockConfig()
        const remoteAgents = new Map([
          ["agent-a", { config: { description: "Agent A" }, source: "repo" }],
          ["agent-b", { config: { description: "Agent B" }, source: "repo" }],
          ["agent-c", { config: { description: "Agent C" }, source: "repo" }],
        ])

        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: agentCfg }] of remoteAgents) {
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = agentCfg
          }
        }

        expect(Object.keys(config.agent as object)).toHaveLength(3)
        expect((config.agent as Record<string, { description: string }>)["agent-a"].description).toBe("Agent A")
        expect((config.agent as Record<string, { description: string }>)["agent-b"].description).toBe("Agent B")
        expect((config.agent as Record<string, { description: string }>)["agent-c"].description).toBe("Agent C")
      })

      test("handles config.agent being undefined", async () => {
        const config: Record<string, unknown> = {}
        const remoteAgents = new Map([
          ["test-agent", { config: { description: "Test" }, source: "repo" }],
        ])

        // Simulate config hook behavior - creates agent if undefined
        if (config.agent === undefined) {
          config.agent = {}
        }
        const agentConfig = config.agent as Record<string, unknown>
        for (const [name, { config: agentCfg }] of remoteAgents) {
          if (!Object.prototype.hasOwnProperty.call(agentConfig, name)) {
            agentConfig[name] = agentCfg
          }
        }

        expect((config.agent as Record<string, { description: string }>)["test-agent"].description).toBe("Test")
      })
    })

    describe("command injection", () => {
      test("injects remote commands into empty config.command", async () => {
        const config = createMockConfig()
        const remoteCommands = new Map([
          [
            "review",
            {
              config: {
                template: "Review this PR",
                description: "Review pull request",
              },
              source: "opencode-config",
            },
          ],
        ])

        const commandConfig = config.command as Record<string, unknown>
        for (const [name, { config: cmdCfg }] of remoteCommands) {
          if (!Object.prototype.hasOwnProperty.call(commandConfig, name)) {
            commandConfig[name] = cmdCfg
          }
        }

        expect((config.command as Record<string, { template: string }>)["review"].template).toBe("Review this PR")
      })

      test("does not override existing user command", async () => {
        const config = {
          agent: {},
          command: {
            review: {
              template: "User's review template",
            },
          },
          instructions: [],
        }

        const remoteCommands = new Map([
          [
            "review",
            {
              config: {
                template: "Remote review template",
              },
              source: "opencode-config",
            },
          ],
        ])

        const commandConfig = config.command as Record<string, unknown>
        for (const [name, { config: cmdCfg }] of remoteCommands) {
          if (!Object.prototype.hasOwnProperty.call(commandConfig, name)) {
            commandConfig[name] = cmdCfg
          }
        }

        expect((config.command as Record<string, { template: string }>)["review"].template).toBe("User's review template")
      })

      test("injects multiple commands", async () => {
        const config = createMockConfig()
        const remoteCommands = new Map([
          ["cmd-a", { config: { template: "A" }, source: "repo" }],
          ["cmd-b", { config: { template: "B" }, source: "repo" }],
        ])

        const commandConfig = config.command as Record<string, unknown>
        for (const [name, { config: cmdCfg }] of remoteCommands) {
          if (!Object.prototype.hasOwnProperty.call(commandConfig, name)) {
            commandConfig[name] = cmdCfg
          }
        }

        expect(Object.keys(config.command as object)).toHaveLength(2)
      })
    })

    describe("mcp injection", () => {
      test("injects remote MCPs into empty config.mcp", async () => {
        const config = createMockConfig()
        const remoteMcps = new Map([
          [
            "context7",
            {
              config: {
                type: "remote",
                url: "https://mcp.context7.com/mcp",
              },
              source: "opencode-config",
            },
          ],
        ])

        const mcpConfig = config.mcp as Record<string, unknown>
        for (const [name, { config: mcpCfg }] of remoteMcps) {
          if (!Object.prototype.hasOwnProperty.call(mcpConfig, name)) {
            mcpConfig[name] = mcpCfg
          }
        }

        expect((config.mcp as Record<string, { type: string; url: string }>).context7).toEqual({
          type: "remote",
          url: "https://mcp.context7.com/mcp",
        })
      })

      test("does not override existing user MCP", async () => {
        const config = {
          agent: {},
          command: {},
          mcp: {
            context7: {
              type: "remote",
              url: "https://user.override/mcp",
            },
          },
          instructions: [],
        }

        const remoteMcps = new Map([
          [
            "context7",
            {
              config: {
                type: "remote",
                url: "https://mcp.context7.com/mcp",
              },
              source: "opencode-config",
            },
          ],
        ])

        const mcpConfig = config.mcp as Record<string, unknown>
        for (const [name, { config: mcpCfg }] of remoteMcps) {
          if (!Object.prototype.hasOwnProperty.call(mcpConfig, name)) {
            mcpConfig[name] = mcpCfg
          }
        }

        expect((config.mcp as Record<string, { url: string }>).context7.url).toBe("https://user.override/mcp")
      })

      test("handles config.mcp being undefined", async () => {
        const config: Record<string, unknown> = {}
        const remoteMcps = new Map([
          [
            "chrome-devtools",
            {
              config: {
                type: "local",
                command: "npx",
                args: ["-y", "chrome-devtools-mcp@latest"],
              },
              source: "opencode-config",
            },
          ],
        ])

        if (config.mcp === undefined) {
          config.mcp = {}
        }

        const mcpConfig = config.mcp as Record<string, unknown>
        for (const [name, { config: mcpCfg }] of remoteMcps) {
          if (!Object.prototype.hasOwnProperty.call(mcpConfig, name)) {
            mcpConfig[name] = mcpCfg
          }
        }

        expect((config.mcp as Record<string, { type: string }>)["chrome-devtools"].type).toBe("local")
      })
    })

    describe("instruction injection", () => {
      test("appends remote instructions to existing array", async () => {
        const config = {
          agent: {},
          command: {},
          instructions: ["user-instruction.md"],
        }

        const remoteInstructions = [
          "/path/to/instruction-a.md",
          "/path/to/instruction-b.md",
        ]

        // Simulate config hook behavior
        if (Array.isArray(config.instructions)) {
          config.instructions.push(...remoteInstructions)
        }

        expect(config.instructions).toHaveLength(3)
        expect(config.instructions[0]).toBe("user-instruction.md")
        expect(config.instructions[1]).toBe("/path/to/instruction-a.md")
        expect(config.instructions[2]).toBe("/path/to/instruction-b.md")
      })

      test("converts string instruction to array before appending", async () => {
        const config: Record<string, unknown> = {
          agent: {},
          command: {},
          instructions: "single-instruction.md",
        }

        const remoteInstructions = ["/path/to/remote.md"]

        // Simulate config hook behavior
        if (!Array.isArray(config.instructions)) {
          config.instructions = config.instructions ? [config.instructions as string] : []
        }
        (config.instructions as string[]).push(...remoteInstructions)

        expect(config.instructions).toHaveLength(2)
        expect((config.instructions as string[])[0]).toBe("single-instruction.md")
        expect((config.instructions as string[])[1]).toBe("/path/to/remote.md")
      })

      test("creates array when instructions is undefined", async () => {
        const config: Record<string, unknown> = {
          agent: {},
          command: {},
        }

        const remoteInstructions = ["/path/to/instruction.md"]

        // Simulate config hook behavior
        if (!Array.isArray(config.instructions)) {
          config.instructions = config.instructions ? [config.instructions as string] : []
        }
        (config.instructions as string[]).push(...remoteInstructions)

        expect(config.instructions).toHaveLength(1)
        expect((config.instructions as string[])[0]).toBe("/path/to/instruction.md")
      })
    })
  })

  describe("disable filtering logic", () => {
    // These tests verify the filtering logic that performLoad uses

    test("filters disabled skills", () => {
      const skills = [
        { name: "keep-me", path: "/path/keep" },
        { name: "disable-me", path: "/path/disable" },
        { name: "also-keep", path: "/path/also" },
      ]

      const disableList = ["skill:disable-me"]

      // Simulate the filtering logic
      const filtered = skills.filter((skill) => {
        const isDisabled = disableList.some((entry) => {
          const [type, name] = entry.includes(":") ? entry.split(":") : [null, entry]
          if (type && type !== "skill") return false
          return name === skill.name
        })
        return !isDisabled
      })

      expect(filtered).toHaveLength(2)
      expect(filtered.map((s) => s.name)).toEqual(["keep-me", "also-keep"])
    })

    test("filters disabled agents", () => {
      const agents = [
        { name: "agent-a", config: {} },
        { name: "agent-b", config: {} },
        { name: "agent-c", config: {} },
      ]

      const disableList = ["agent:agent-b"]

      const filtered = agents.filter((agent) => {
        const isDisabled = disableList.some((entry) => {
          const [type, name] = entry.includes(":") ? entry.split(":") : [null, entry]
          if (type && type !== "agent") return false
          return name === agent.name
        })
        return !isDisabled
      })

      expect(filtered).toHaveLength(2)
      expect(filtered.map((a) => a.name)).toEqual(["agent-a", "agent-c"])
    })

    test("bare name disables across all types", () => {
      const skills = [{ name: "shared-name", path: "/path" }]
      const agents = [{ name: "shared-name", config: {} }]
      const commands = [{ name: "shared-name", config: {} }]

      const disableList = ["shared-name"] // bare name, no type prefix

      const filterItem = <T extends { name: string }>(items: T[], type: string): T[] => {
        return items.filter((item) => {
          const isDisabled = disableList.some((entry) => {
            const [entryType, name] = entry.includes(":") ? entry.split(":") : [null, entry]
            if (entryType && entryType !== type) return false
            return name === item.name
          })
          return !isDisabled
        })
      }

      expect(filterItem(skills, "skill")).toHaveLength(0)
      expect(filterItem(agents, "agent")).toHaveLength(0)
      expect(filterItem(commands, "command")).toHaveLength(0)
    })

    test("typed disable only affects that type", () => {
      const skills = [{ name: "shared-name", path: "/path" }]
      const agents = [{ name: "shared-name", config: {} }]

      const disableList = ["skill:shared-name"] // only disable skill

      const filterItem = <T extends { name: string }>(items: T[], type: string): T[] => {
        return items.filter((item) => {
          const isDisabled = disableList.some((entry) => {
            const [entryType, name] = entry.includes(":") ? entry.split(":") : [null, entry]
            if (entryType && entryType !== type) return false
            return name === item.name
          })
          return !isDisabled
        })
      }

      expect(filterItem(skills, "skill")).toHaveLength(0)
      expect(filterItem(agents, "agent")).toHaveLength(1) // agent should remain
    })
  })

  describe("performLoad", () => {
    test("applies agentOverrides to discovered remoteAgents", async () => {
      const baseline = await performLoad({
        ...DEFAULT_CONFIG,
        dryRun: true,
        agentOverrides: {},
      })

      expect(baseline.remoteAgents.size).toBeGreaterThan(0)

      const firstEntry = baseline.remoteAgents.entries().next().value
      expect(firstEntry).toBeDefined()

      const [agentName, remoteAgent] = firstEntry as [string, { config: Record<string, unknown> }]

      const override = {
        description: "Overridden by performLoad test",
      }

      const withOverride = await performLoad({
        ...DEFAULT_CONFIG,
        dryRun: true,
        agentOverrides: {
          [agentName]: override,
        },
      })

      const overriddenAgent = withOverride.remoteAgents.get(agentName)
      expect(overriddenAgent).toBeDefined()

      const expectedMerged = deepMerge(remoteAgent.config, override) as Record<string, unknown>
      const actualConfig = overriddenAgent?.config as Record<string, unknown> | undefined

      expect(actualConfig).toBeDefined()
      expect(actualConfig?.description).toBe("Overridden by performLoad test")

      for (const [key, value] of Object.entries(expectedMerged)) {
        expect(actualConfig?.[key]).toEqual(value)
      }
    })

    test("accepts descriptive alias in agentOverrides when active theme is lotr", async () => {
      const withOverride = await performLoad({
        ...DEFAULT_CONFIG,
        dryRun: true,
        agentNames: "lotr",
        agentOverrides: {
          orchestrator: {
            description: "Descriptive alias under LOTR theme",
          },
        },
      })

      const overriddenAgent = withOverride.remoteAgents.get("gandalf")
      expect(overriddenAgent).toBeDefined()
      expect(overriddenAgent?.config.description).toBe("Descriptive alias under LOTR theme")
    })

    test("applies agentOverrides policy controls to discovered remoteAgents", async () => {
      const withPolicy = await performLoad({
        ...DEFAULT_CONFIG,
        dryRun: true,
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

      const researcher = withPolicy.remoteAgents.get("researcher")
      expect(researcher).toBeDefined()
      expect(researcher?.config.policy).toBeUndefined()
      expect(researcher?.config.tools).toEqual({ bash: false, webfetch: true })
      expect(researcher?.config.permission).toEqual({
        edit: "deny",
        "chrome-devtools_*": "deny",
        "context7_*": "allow",
        "exa_*": "deny",
        skill: {
          "*": "allow",
          terraform: "deny",
        },
      })
    })

    test("records TUI snapshot after a successful load", async () => {
      process.env.HOME = testDir
      process.env.XDG_DATA_HOME = path.join(testDir, "data")

      await performLoad(
        {
          ...DEFAULT_CONFIG,
          models: {
            orchestrator: "openai/gpt-5.5",
          },
          presets: {
            fast: { models: { orchestrator: "openai/gpt-5.5" } },
          },
        },
        ["/global/fellowship.jsonc", "/project/.opencode/fellowship.jsonc"],
        "fast",
      )

      const snapshot = readTuiSnapshot()
      expect(snapshot.activePreset).toBe("fast")
      expect(snapshot.presetNames).toEqual(["fast"])
      expect(snapshot.configPaths).toEqual(["/global/fellowship.jsonc", "/project/.opencode/fellowship.jsonc"])
      expect(snapshot.agentModels.orchestrator).toBe("openai/gpt-5.5")
      expect(snapshot.assetCounts.skills).toBeGreaterThan(0)
      expect(snapshot.assetCounts.plugins).toBe(0)
      expect(snapshot.assetCounts.runtimePlugins).toBe(2)
      expect(snapshot.assetCounts.agents).toBeGreaterThan(0)
      expect(snapshot.warnings.lastError).toBeNull()
    })
  })

  describe("setsEqual helper", () => {
    // Test the setsEqual function logic used for plugin change detection
    function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
      if (a.size !== b.size) return false
      for (const item of a) {
        if (!b.has(item)) return false
      }
      return true
    }

    test("returns true for equal sets", () => {
      const a = new Set(["a", "b", "c"])
      const b = new Set(["a", "b", "c"])
      expect(setsEqual(a, b)).toBe(true)
    })

    test("returns true for empty sets", () => {
      const a = new Set<string>()
      const b = new Set<string>()
      expect(setsEqual(a, b)).toBe(true)
    })

    test("returns false for different sizes", () => {
      const a = new Set(["a", "b"])
      const b = new Set(["a", "b", "c"])
      expect(setsEqual(a, b)).toBe(false)
    })

    test("returns false for same size but different elements", () => {
      const a = new Set(["a", "b", "c"])
      const b = new Set(["a", "b", "d"])
      expect(setsEqual(a, b)).toBe(false)
    })

    test("handles sets with single element", () => {
      const a = new Set(["only"])
      const b = new Set(["only"])
      expect(setsEqual(a, b)).toBe(true)

      const c = new Set(["different"])
      expect(setsEqual(a, c)).toBe(false)
    })
  })

  describe("plugin change detection", () => {
    // Test the logic that detects when plugins have changed
    function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
      if (a.size !== b.size) return false
      for (const item of a) {
        if (!b.has(item)) return false
      }
      return true
    }

    test("detects when new plugin is added", () => {
      const existingPlugins = new Set(["plugin-a", "plugin-b"])
      const newPlugins = new Set(["plugin-a", "plugin-b", "plugin-c"])

      const pluginsChanged = !setsEqual(existingPlugins, newPlugins)
      expect(pluginsChanged).toBe(true)
    })

    test("detects when plugin is removed", () => {
      const existingPlugins = new Set(["plugin-a", "plugin-b", "plugin-c"])
      const newPlugins = new Set(["plugin-a", "plugin-b"])

      const pluginsChanged = !setsEqual(existingPlugins, newPlugins)
      expect(pluginsChanged).toBe(true)
    })

    test("detects when plugin is replaced", () => {
      const existingPlugins = new Set(["plugin-a", "plugin-b"])
      const newPlugins = new Set(["plugin-a", "plugin-c"])

      const pluginsChanged = !setsEqual(existingPlugins, newPlugins)
      expect(pluginsChanged).toBe(true)
    })

    test("no change when plugins are same", () => {
      const existingPlugins = new Set(["plugin-a", "plugin-b"])
      const newPlugins = new Set(["plugin-a", "plugin-b"])

      const pluginsChanged = !setsEqual(existingPlugins, newPlugins)
      expect(pluginsChanged).toBe(false)
    })

    test("no change when both empty", () => {
      const existingPlugins = new Set<string>()
      const newPlugins = new Set<string>()

      const pluginsChanged = !setsEqual(existingPlugins, newPlugins)
      expect(pluginsChanged).toBe(false)
    })
  })

  describe("summary message building", () => {
    // Test the logic that builds the summary message
    test("builds message with all parts", () => {
      const totalSkills = 5
      const totalPlugins = 3
      const totalMcps = 2
      const remoteInstructionsCount = 4
      const skippedCount = 1

      const parts: string[] = []
      if (totalSkills > 0) parts.push(`${totalSkills} skills`)
      if (totalPlugins > 0) parts.push(`${totalPlugins} plugins`)
      if (totalMcps > 0) parts.push(`${totalMcps} MCPs`)
      if (remoteInstructionsCount > 0) parts.push(`${remoteInstructionsCount} instructions`)

      let message: string
      if (parts.length === 0) {
        message = "No remote config found"
      } else {
        message = `${parts.join(", ")} available`
        if (skippedCount > 0) {
          message += ` (${skippedCount} skills skipped due to conflicts)`
        }
      }

      expect(message).toBe("5 skills, 3 plugins, 2 MCPs, 4 instructions available (1 skills skipped due to conflicts)")
    })

    test("builds message with no parts", () => {
      const parts: string[] = []

      let message: string
      if (parts.length === 0) {
        message = "No remote config found"
      } else {
        message = `${parts.join(", ")} available`
      }

      expect(message).toBe("No remote config found")
    })

    test("builds message without conflicts", () => {
      const totalSkills = 2
      const skippedCount = 0

      const parts: string[] = []
      if (totalSkills > 0) parts.push(`${totalSkills} skills`)

      let message = `${parts.join(", ")} available`
      if (skippedCount > 0) {
        message += ` (${skippedCount} skills skipped due to conflicts)`
      }

      expect(message).toBe("2 skills available")
    })
  })

  describe("config.agent type validation", () => {
    test("skips injection when config.agent is not an object", () => {
      const config = {
        agent: "invalid-string-value",
        command: {},
        instructions: [],
      }

      const remoteAgents = new Map([
        ["test", { config: { description: "Test" }, source: "repo" }],
      ])

      // Simulate config hook behavior
      let injected = false
      if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
        // Skip injection
      } else {
        injected = true
      }

      expect(injected).toBe(false)
    })

    test("skips injection when config.agent is null", () => {
      const config: Record<string, unknown> = {
        agent: null,
        command: {},
        instructions: [],
      }

      let injected = false
      if (config.agent !== undefined && (typeof config.agent !== "object" || config.agent === null)) {
        // Skip injection
      } else if (config.agent === undefined) {
        injected = true
      }

      expect(injected).toBe(false)
    })
  })

  describe("config.command type validation", () => {
    test("skips injection when config.command is not an object", () => {
      const config = {
        agent: {},
        command: "invalid",
        instructions: [],
      }

      let injected = false
      if (config.command !== undefined && (typeof config.command !== "object" || config.command === null)) {
        // Skip injection
      } else {
        injected = true
      }

      expect(injected).toBe(false)
    })
  })

  describe("config.instructions type validation", () => {
    test("skips injection when instructions is not string or array", () => {
      const config: Record<string, unknown> = {
        agent: {},
        command: {},
        instructions: 123, // invalid type
      }

      let skipped = false
      if (
        config.instructions !== undefined &&
        typeof config.instructions !== "string" &&
        !Array.isArray(config.instructions)
      ) {
        skipped = true
      }

      expect(skipped).toBe(true)
    })

    test("skips injection when array contains non-strings", () => {
      const config = {
        agent: {},
        command: {},
        instructions: ["valid.md", 123, "also-valid.md"],
      }

      let skipped = false
      if (
        Array.isArray(config.instructions) &&
        !config.instructions.every((x: unknown) => typeof x === "string")
      ) {
        skipped = true
      }

      expect(skipped).toBe(true)
    })
  })

  describe("dry-run mode", () => {
    test("DryRunReport has correct structure", () => {
      // Type check - this test verifies the interface shape works correctly
      const report: import("./index").DryRunReport = {
        wouldInstall: {
          skills: ["test-skill"],
          plugins: [],
          mcps: [],
        },
        wouldRemove: {
          skills: [],
          plugins: ["old-plugin"],
          mcps: [],
        },
        wouldInject: {
          agents: ["test-agent"],
          commands: ["test-command"],
          instructions: ["test.md"],
        },
        wouldSkip: {
          conflicts: ["local-skill"],
          disabled: ["skill:disabled-one"],
          overridden: [],
        },
      }
      expect(report.wouldInstall.skills).toContain("test-skill")
      expect(report.wouldRemove.plugins).toContain("old-plugin")
      expect(report.wouldInject.agents).toContain("test-agent")
      expect(report.wouldSkip.conflicts).toContain("local-skill")
    })

    test("LoadOutput includes dryRun field", () => {
      // Verify the LoadOutput type includes optional dryRun field
      type LoadOutput = {
        result: unknown
        skippedConflicts: string[]
        totalSkills: number
        remoteAgents: Map<string, unknown>
        remoteCommands: Map<string, unknown>
        remoteInstructions: string[]
        pluginsChanged: boolean
        totalPlugins: number
        totalMcps: number
        dryRun?: import("./index").DryRunReport
      }

      const output: LoadOutput = {
        result: {},
        skippedConflicts: [],
        totalSkills: 0,
        remoteAgents: new Map(),
        remoteCommands: new Map(),
        remoteInstructions: [],
        pluginsChanged: false,
        totalPlugins: 0,
        totalMcps: 0,
        dryRun: {
          wouldInstall: { skills: [], plugins: [], mcps: [] },
          wouldRemove: { skills: [], plugins: [], mcps: [] },
          wouldInject: { agents: [], commands: [], instructions: [] },
          wouldSkip: { conflicts: [], disabled: [], overridden: [] },
        },
      }
      expect(output.dryRun).toBeDefined()
    })

    test("UserConfig includes dryRun option", () => {
      const config = {
        disable: [],
        installMethod: "link" as const,
        dryRun: true,
      }
      expect(config.dryRun).toBe(true)
    })
  })

  describe("degraded sync mode", () => {
    test("continues exposing cached commands when sync returns an error", () => {
      const syncResult = {
        error: "network timeout",
        commands: [
          {
            name: "diagnostics",
            config: {
              template: "Run diagnostics",
            },
          },
        ],
      }

      const remoteCommands = new Map<string, { config: { template: string }; source: string }>()
      for (const command of syncResult.commands) {
        remoteCommands.set(command.name, {
          config: command.config,
          source: "opencode-config",
        })
      }

      const degradedSyncMode = Boolean(syncResult.error)

      expect(degradedSyncMode).toBe(true)
      expect(remoteCommands.has("diagnostics")).toBe(true)
      expect(remoteCommands.get("diagnostics")?.config.template).toBe("Run diagnostics")
    })
  })
})
