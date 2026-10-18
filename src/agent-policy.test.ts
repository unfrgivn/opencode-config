import { describe, expect, test } from "bun:test"
import { applyAgentPolicy } from "./agent-policy"
import type { AgentConfig } from "./agent"

describe("applyAgentPolicy", () => {
  test("merges tool and permission policy then removes internal policy field", () => {
    const agentConfig: AgentConfig = {
      description: "Researcher",
      tools: { webfetch: true, bash: true },
      permission: {
        bash: { "*": "ask" },
      },
      policy: {
        tools: { bash: false, websearch: true },
        permission: {
          edit: "deny",
        },
      },
    }

    const result = applyAgentPolicy(agentConfig)

    expect(result.policy).toBeUndefined()
    expect(result.tools).toEqual({ webfetch: true, bash: false, websearch: true })
    expect(result.permission).toEqual({
      bash: { "*": "ask" },
      edit: "deny",
    })
  })

  test("synthesizes MCP and skill allowlists into agent permissions", () => {
    const agentConfig: AgentConfig = {
      permission: {
        bash: "deny",
      },
      policy: {
        mcps: ["*", "!chrome-devtools"],
        skills: ["*", "!terraform"],
      },
    }

    const result = applyAgentPolicy(agentConfig, {
      availableMcps: ["context7", "chrome-devtools"],
    })

    expect(result.permission).toEqual({
      bash: "deny",
      "chrome-devtools_*": "deny",
      "context7_*": "allow",
      skill: {
        "*": "allow",
        terraform: "deny",
      },
    })
  })

  test("uses explicit MCP names when no available MCP list is supplied", () => {
    const result = applyAgentPolicy({ policy: { mcps: ["context7"] } })

    expect(result.permission).toEqual({
      "context7_*": "allow",
    })
  })

  test("treats deny-only MCP and skill policies as blocklists", () => {
    const result = applyAgentPolicy(
      { policy: { mcps: ["!chrome-devtools"], skills: ["!terraform"] } },
      { availableMcps: ["context7", "chrome-devtools"] },
    )

    expect(result.permission).toEqual({
      "chrome-devtools_*": "deny",
      "context7_*": "allow",
      skill: {
        "*": "allow",
        terraform: "deny",
      },
    })
  })
})
