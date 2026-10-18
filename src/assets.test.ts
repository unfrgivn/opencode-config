import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { discoverSkills, discoverAgents, discoverCommands, discoverPlugins, discoverMcps } from "./assets"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import type { AgentNameTheme } from "./agent-names"

describe("assets", () => {
  describe("discoverSkills", () => {
    test("returns empty array for non-existent repo", async () => {
      const skills = await discoverSkills("/non/existent/path")
      expect(skills).toEqual([])
    })

    test("returns empty array for repo without skill directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))
      try {
        const skills = await discoverSkills(tmpDir)
        expect(skills).toEqual([])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers skills in skill directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))
      const skillDir = path.join(tmpDir, "skill", "test-skill")
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill
---

# Test Skill

This is a test skill.
`
      )

      try {
        const skills = await discoverSkills(tmpDir)
        expect(skills).toHaveLength(1)
        expect(skills[0].name).toBe("test-skill")
        expect(skills[0].description).toBe("A test skill")
        expect(skills[0].path).toBe(skillDir)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers nested skills", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))
      const skill1Dir = path.join(tmpDir, "skill", "category", "skill-a")
      const skill2Dir = path.join(tmpDir, "skill", "skill-b")

      fs.mkdirSync(skill1Dir, { recursive: true })
      fs.mkdirSync(skill2Dir, { recursive: true })

      fs.writeFileSync(
        path.join(skill1Dir, "SKILL.md"),
        `---
name: category-skill-a
description: Skill A
---
Content A
`
      )
      fs.writeFileSync(
        path.join(skill2Dir, "SKILL.md"),
        `---
name: skill-b
description: Skill B
---
Content B
`
      )

      try {
        const skills = await discoverSkills(tmpDir)
        expect(skills).toHaveLength(2)
        const names = skills.map((s) => s.name).sort()
        expect(names).toEqual(["category-skill-a", "skill-b"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    // Note: The implementation only checks 'skill/' directory (singular)
    // This test documents that 'skills/' (plural) is NOT supported
    test("does not discover skills in 'skills' directory (only singular supported)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))
      const skillDir = path.join(tmpDir, "skills", "my-skill")
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: my-skill
description: A skill in plural directory
---
Content
`
      )

      try {
        const skills = await discoverSkills(tmpDir)
        // Plural directory is NOT supported - should return empty
        expect(skills).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers bundled reflect and codemap skills", async () => {
      const repoRoot = path.resolve(import.meta.dir, "..")
      const skills = await discoverSkills(repoRoot)
      const skillsByName = new Map(skills.map(skill => [skill.name, skill]))

      expect(skillsByName.get("reflect")?.description).toContain("Review recent work")
      expect(skillsByName.get("codemap")?.description).toContain("Create or update concise repository codemaps")
    })
  })

  describe("discoverAgents", () => {
    test("returns empty array for non-existent repo", async () => {
      const agents = await discoverAgents("/non/existent/path")
      expect(agents).toEqual([])
    })

    test("returns empty array for repo without agent directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toEqual([])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers agents in agent/ directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      fs.writeFileSync(
        path.join(agentDir, "test-agent.md"),
        `---
description: A test agent
mode: subagent
---

You are a test agent.
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("test-agent")
        expect(agents[0].config.description).toBe("A test agent")
        expect(agents[0].config.mode).toBe("subagent")
        expect(agents[0].config.prompt).toBe("You are a test agent.")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("bundled planner allows filesystem inspection commands with optional arguments", async () => {
      const repoRoot = path.resolve(import.meta.dir, "..")
      const agents = await discoverAgents(repoRoot)
      const planner = agents.find(agent => agent.name === "planner")

      expect(planner?.config.permission).toMatchObject({
        bash: {
          "*": "ask",
          "ls": "allow",
          "ls *": "allow",
          "pwd": "allow",
          "pwd *": "allow",
          "stat": "allow",
          "stat *": "allow",
          "file": "allow",
          "file *": "allow",
          "wc": "allow",
          "wc *": "allow",
          "du": "allow",
          "du *": "allow",
          "df": "allow",
          "df *": "allow",
          "tree": "allow",
          "tree *": "allow",
          "realpath": "allow",
          "realpath *": "allow",
          "readlink": "allow",
          "readlink *": "allow",
        },
      })
    })

    test("bundled orchestrator keeps planner opt-in for write-oriented work in every theme", async () => {
      const repoRoot = path.resolve(import.meta.dir, "..")
      const themes: ReadonlyArray<{
        theme: AgentNameTheme
        orchestrator: string
        explorer: string
        planner: string
        implementer: string
        tdd: string
      }> = [
        {
          theme: "descriptive",
          orchestrator: "orchestrator",
          explorer: "explorer",
          planner: "planner",
          implementer: "implementer",
          tdd: "tdd",
        },
        {
          theme: "lotr",
          orchestrator: "gandalf",
          explorer: "legolas",
          planner: "treebeard",
          implementer: "celebrimbor",
          tdd: "aragorn",
        },
      ]

      for (const names of themes) {
        const agents = await discoverAgents(repoRoot, names.theme)
        const orchestrator = agents.find(agent => agent.name === names.orchestrator)
        const prompt = orchestrator?.config.prompt

        expect(prompt).toContain(
          `Use ${names.planner} only when the requested deliverable is a plan or plan review, or unresolved ambiguity or risk blocks safe execution.`
        )
        expect(prompt).toContain(
          `Do not invoke ${names.planner} merely because a task is complex, multi-step, coding, implementation, or fix work.`
        )
        expect(prompt).toContain(
          `For implementation or fix work involving behavioral changes, tests, or multiple files, delegate execution to \`${names.implementer}\` or \`${names.tdd}\` by default.`
        )
        expect(prompt).toContain(
          `Use \`${names.explorer}\` only for bounded discovery when needed; do not make discovery a mandatory prelude to execution.`
        )
        expect(prompt).toContain(
          `Route test design and test strategy to ${names.tdd}, not ${names.planner}.`
        )
        expect(prompt).not.toContain("launch discovery and planning/research delegates in parallel")
      }
    })

    // Note: The implementation only checks 'agent/' directory (singular)
    // This test documents that 'agents/' (plural) is NOT supported
    test("does not discover agents in agents/ directory (only singular supported)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agents")
      fs.mkdirSync(agentDir)
      fs.writeFileSync(
        path.join(agentDir, "my-agent.md"),
        `---
description: Agent in plural directory
---
Prompt content
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // Plural directory is NOT supported - should return empty
        expect(agents).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("prefers agent/ over agents/ when both exist", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      
      // Create both directories with different agents
      const singularDir = path.join(tmpDir, "agent")
      const pluralDir = path.join(tmpDir, "agents")
      fs.mkdirSync(singularDir)
      fs.mkdirSync(pluralDir)
      
      fs.writeFileSync(
        path.join(singularDir, "from-singular.md"),
        `---
description: From singular
---
Singular prompt
`
      )
      fs.writeFileSync(
        path.join(pluralDir, "from-plural.md"),
        `---
description: From plural
---
Plural prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("from-singular")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers nested agents with correct naming", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const nestedDir = path.join(tmpDir, "agent", "category", "subcategory")
      fs.mkdirSync(nestedDir, { recursive: true })
      
      fs.writeFileSync(
        path.join(tmpDir, "agent", "top-level.md"),
        `---
description: Top level agent
---
Top prompt
`
      )
      fs.writeFileSync(
        path.join(tmpDir, "agent", "category", "middle.md"),
        `---
description: Category agent
---
Middle prompt
`
      )
      fs.writeFileSync(
        path.join(nestedDir, "deep.md"),
        `---
description: Deep nested agent
---
Deep prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(3)
        const names = agents.map(a => a.name).sort()
        expect(names).toEqual([
          "category/middle",
          "category/subcategory/deep",
          "top-level",
        ])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips files without frontmatter", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Valid agent with frontmatter
      fs.writeFileSync(
        path.join(agentDir, "valid.md"),
        `---
description: Valid agent
---
Prompt
`
      )
      // Markdown without frontmatter (should be skipped)
      fs.writeFileSync(
        path.join(agentDir, "readme.md"),
        `# README

This is just documentation, not an agent.
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("valid")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips hidden files and directories", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      const hiddenDir = path.join(agentDir, ".hidden")
      fs.mkdirSync(hiddenDir, { recursive: true })
      
      fs.writeFileSync(
        path.join(agentDir, "visible.md"),
        `---
description: Visible agent
---
Prompt
`
      )
      fs.writeFileSync(
        path.join(agentDir, ".hidden-agent.md"),
        `---
description: Hidden agent
---
Should not be discovered
`
      )
      fs.writeFileSync(
        path.join(hiddenDir, "in-hidden-dir.md"),
        `---
description: Agent in hidden dir
---
Should not be discovered either
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("visible")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips agents with invalid schema", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Valid agent
      fs.writeFileSync(
        path.join(agentDir, "valid.md"),
        `---
description: Valid agent
mode: subagent
---
Prompt
`
      )
      // Invalid agent (bad color format)
      fs.writeFileSync(
        path.join(agentDir, "invalid.md"),
        `---
description: Invalid agent
color: red
---
Should be skipped due to invalid color
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("valid")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles agent with all config fields", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "full-config.md"),
        `---
description: Full config agent
model: anthropic/claude-3-5-sonnet
mode: subagent
temperature: 0.7
top_p: 0.9
color: "#FF5733"
steps: 10
disable: false
tools:
  bash: true
  edit: false
permission:
  edit: deny
  bash: ask
---

You are a comprehensive test agent with all configuration fields.
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        const agent = agents[0]
        expect(agent.name).toBe("full-config")
        expect(agent.config.description).toBe("Full config agent")
        expect(agent.config.model).toBe("anthropic/claude-3-5-sonnet")
        expect(agent.config.mode).toBe("subagent")
        expect(agent.config.temperature).toBe(0.7)
        expect(agent.config.top_p).toBe(0.9)
        expect(agent.config.color).toBe("#FF5733")
        expect(agent.config.steps).toBe(10)
        expect(agent.config.disable).toBe(false)
        expect(agent.config.tools).toEqual({ bash: true, edit: false })
        expect(agent.config.permission).toEqual({ edit: "deny", bash: "ask" })
        expect(agent.config.prompt).toContain("comprehensive test agent")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles agent without prompt body", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "no-prompt.md"),
        `---
description: Agent without prompt
mode: subagent
---
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].config.prompt).toBeUndefined()
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("trims whitespace from prompt body", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "whitespace.md"),
        `---
description: Agent with whitespace
---

   
  Actual prompt content  
   
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        expect(agents[0].config.prompt).toBe("Actual prompt content")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("rejects JavaScript frontmatter for security (no code execution)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Malicious attempt to use JavaScript frontmatter
      // gray-matter by default supports ---js which uses eval()
      // Our safe options should prevent this
      fs.writeFileSync(
        path.join(agentDir, "malicious.md"),
        `---js
{
  description: "Malicious agent",
  get mode() { 
    // This would execute if JS engine was enabled
    require('child_process').execSync('echo PWNED > /tmp/pwned');
    return "subagent";
  }
}
---
Prompt
`
      )
      
      // Also add a valid YAML agent to ensure discovery still works
      fs.writeFileSync(
        path.join(agentDir, "valid.md"),
        `---
description: Valid agent
---
Prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // The JS frontmatter file should be skipped (parsed as invalid YAML)
        // Only the valid YAML agent should be discovered
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("valid")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("rejects YAML with dangerous tags", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Attempt to use YAML tags that could be dangerous
      // js-yaml's safeLoad (used by gray-matter) should reject these
      fs.writeFileSync(
        path.join(agentDir, "dangerous-yaml.md"),
        `---
description: !!js/function "function() { return 'evil'; }"
---
Prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // Should be skipped due to unsafe YAML tag
        expect(agents).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips files larger than 256KB", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Create a large file (> 256KB)
      const largeContent = `---
description: Large agent
---
${"x".repeat(300 * 1024)}
`
      fs.writeFileSync(path.join(agentDir, "large.md"), largeContent)
      
      // Create a normal-sized file
      fs.writeFileSync(
        path.join(agentDir, "normal.md"),
        `---
description: Normal agent
---
Prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // Only the normal file should be discovered
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("normal")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("respects max depth limit", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      
      // Create deeply nested directory (12 levels deep, limit is 10)
      let deepPath = path.join(tmpDir, "agent")
      for (let i = 0; i < 12; i++) {
        deepPath = path.join(deepPath, `level${i}`)
      }
      fs.mkdirSync(deepPath, { recursive: true })
      
      // Put an agent at the deepest level (should be skipped)
      fs.writeFileSync(
        path.join(deepPath, "deep.md"),
        `---
description: Deep agent
---
Prompt
`
      )
      
      // Put an agent at a reasonable depth (level 5)
      let shallowPath = path.join(tmpDir, "agent")
      for (let i = 0; i < 5; i++) {
        shallowPath = path.join(shallowPath, `level${i}`)
      }
      fs.mkdirSync(shallowPath, { recursive: true })
      fs.writeFileSync(
        path.join(shallowPath, "shallow.md"),
        `---
description: Shallow agent
---
Prompt
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // Only the shallow agent should be discovered
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toContain("shallow")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles case-insensitive .md extension", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Different case variations of .md extension
      fs.writeFileSync(
        path.join(agentDir, "lowercase.md"),
        `---
description: Lowercase extension
---
`
      )
      fs.writeFileSync(
        path.join(agentDir, "uppercase.MD"),
        `---
description: Uppercase extension
---
`
      )
      fs.writeFileSync(
        path.join(agentDir, "mixed.Md"),
        `---
description: Mixed case extension
---
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(3)
        const names = agents.map(a => a.name).sort()
        // All should have .md stripped regardless of case
        expect(names).toEqual(["lowercase", "mixed", "uppercase"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips agents with invalid name characters", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      // Valid agent
      fs.writeFileSync(
        path.join(agentDir, "valid-agent.md"),
        `---
description: Valid agent
---
`
      )
      
      // Invalid: contains spaces (via directory with space)
      const spacedDir = path.join(agentDir, "spaced dir")
      fs.mkdirSync(spacedDir)
      fs.writeFileSync(
        path.join(spacedDir, "agent.md"),
        `---
description: Agent in spaced directory
---
`
      )
      
      // Invalid: contains special characters
      fs.writeFileSync(
        path.join(agentDir, "special@char.md"),
        `---
description: Agent with special char
---
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        // Only the valid agent should be discovered
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("valid-agent")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("allows valid nested agent names with slashes", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-"))
      const agentDir = path.join(tmpDir, "agent")
      const nestedDir = path.join(agentDir, "category", "subcategory")
      fs.mkdirSync(nestedDir, { recursive: true })
      
      fs.writeFileSync(
        path.join(nestedDir, "my-agent_v2.md"),
        `---
description: Nested agent with underscores and hyphens
---
`
      )

      try {
        const agents = await discoverAgents(tmpDir)
        expect(agents).toHaveLength(1)
        // Should preserve slashes from directory structure
        expect(agents[0].name).toBe("category/subcategory/my-agent_v2")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("remaps known agent names with lotr theme", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-theme-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "orchestrator.md"),
        `---
description: The orchestrator
---
You are the orchestrator.
`
      )
      fs.writeFileSync(
        path.join(agentDir, "explorer.md"),
        `---
description: The explorer
---
You explore code.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "lotr")
        expect(agents).toHaveLength(2)
        const names = agents.map(a => a.name).sort()
        expect(names).toEqual(["gandalf", "legolas"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("remaps known agent names with descriptive theme (passthrough)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-theme-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "orchestrator.md"),
        `---
description: The orchestrator
---
You are the orchestrator.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "descriptive")
        expect(agents).toHaveLength(1)
        expect(agents[0].name).toBe("orchestrator")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("passes unknown agent names through unchanged regardless of theme", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-theme-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "custom-agent.md"),
        `---
description: A custom agent not in the name table
---
Custom prompt.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "descriptive")
        expect(agents).toHaveLength(1)
        // Not in the name table, so it passes through unchanged
        expect(agents[0].name).toBe("custom-agent")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("resolves template variables in agent prompts (lotr theme)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-tpl-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "orchestrator.md"),
        `---
description: The orchestrator
---
Delegate to {{explorer}} for codebase search. Use {{researcher}} for external docs.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "lotr")
        expect(agents).toHaveLength(1)
        expect(agents[0].config.prompt).toBe(
          "Delegate to legolas for codebase search. Use radagast for external docs."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("resolves template variables in agent prompts (descriptive theme)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-tpl-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "orchestrator.md"),
        `---
description: The orchestrator
---
Delegate to {{explorer}} for codebase search. Use {{researcher}} for external docs.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "descriptive")
        expect(agents).toHaveLength(1)
        expect(agents[0].config.prompt).toBe(
          "Delegate to explorer for codebase search. Use researcher for external docs."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("leaves unknown template variables untouched", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-tpl-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "test-agent.md"),
        `---
description: Test agent
---
Use {{explorer}} and {{unknownRole}} for work.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "lotr")
        expect(agents).toHaveLength(1)
        // Known role resolved, unknown left as-is
        expect(agents[0].config.prompt).toBe(
          "Use legolas and {{unknownRole}} for work."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("does not interfere with OpenCode {{$arguments}} syntax", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-agents-tpl-"))
      const agentDir = path.join(tmpDir, "agent")
      fs.mkdirSync(agentDir)
      
      fs.writeFileSync(
        path.join(agentDir, "test-agent.md"),
        `---
description: Test agent
---
Process {{$arguments}} using {{explorer}}.
`
      )

      try {
        const agents = await discoverAgents(tmpDir, "lotr")
        expect(agents).toHaveLength(1)
        // {{$arguments}} has $ so \w+ won't match it, left untouched
        expect(agents[0].config.prompt).toBe(
          "Process {{$arguments}} using legolas."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })
  })

  describe("discoverCommands", () => {
    test("discovers commands in command/ directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "review.md"),
        `---
template: Review the current PR and provide feedback
description: Review pull request
agent: code-reviewer
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].name).toBe("review")
        expect(commands[0].config.template).toBe("Review the current PR and provide feedback")
        expect(commands[0].config.description).toBe("Review pull request")
        expect(commands[0].config.agent).toBe("code-reviewer")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("does NOT discover commands in commands/ directory (only singular supported)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "commands")  // Note: plural - NOT supported
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "deploy.md"),
        `---
template: Deploy to {{$arguments}}
description: Deploy to environment
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        // Plural directory is NOT supported - only command/ (singular) works
        expect(commands).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("uses body as template when template not in frontmatter", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "fix.md"),
        `---
description: Fix issues
agent: fixer
---
Fix the following issues: {{$arguments}}`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].config.template).toBe("Fix the following issues: {{$arguments}}")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("supports nested command directories", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const nestedDir = path.join(tmpDir, "command", "deploy", "env")
      fs.mkdirSync(nestedDir, { recursive: true })
      
      fs.writeFileSync(
        path.join(nestedDir, "staging.md"),
        `---
template: Deploy to staging
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].name).toBe("deploy/env/staging")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers multiple commands", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(path.join(commandDir, "review.md"), `---
template: Review code
---
`)
      fs.writeFileSync(path.join(commandDir, "test.md"), `---
template: Run tests
---
`)
      fs.writeFileSync(path.join(commandDir, "deploy.md"), `---
template: Deploy
---
`)

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(3)
        const names = commands.map(c => c.name).sort()
        expect(names).toEqual(["deploy", "review", "test"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("includes files without frontmatter (body becomes template)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      // Valid command with frontmatter
      fs.writeFileSync(
        path.join(commandDir, "valid.md"),
        `---
template: Valid command
---
`
      )
      
      // No frontmatter - body becomes template (matches OpenCode native behavior)
      fs.writeFileSync(
        path.join(commandDir, "no-frontmatter.md"),
        `This is just a regular markdown file without frontmatter.`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(2)
        
        const validCmd = commands.find(c => c.name === "valid")
        expect(validCmd).toBeDefined()
        expect(validCmd!.config.template).toBe("Valid command")
        
        const noFrontmatterCmd = commands.find(c => c.name === "no-frontmatter")
        expect(noFrontmatterCmd).toBeDefined()
        expect(noFrontmatterCmd!.config.template).toBe("This is just a regular markdown file without frontmatter.")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips hidden files and directories", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      // Visible command
      fs.writeFileSync(
        path.join(commandDir, "visible.md"),
        `---
template: Visible command
---
`
      )
      
      // Hidden file
      fs.writeFileSync(
        path.join(commandDir, ".hidden.md"),
        `---
template: Hidden command
---
`
      )
      
      // Hidden directory
      const hiddenDir = path.join(commandDir, ".hidden")
      fs.mkdirSync(hiddenDir)
      fs.writeFileSync(
        path.join(hiddenDir, "inside.md"),
        `---
template: Inside hidden dir
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].name).toBe("visible")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips commands with invalid schema", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      // Valid command
      fs.writeFileSync(
        path.join(commandDir, "valid.md"),
        `---
template: Valid template
---
`
      )
      
      // Invalid: no template
      fs.writeFileSync(
        path.join(commandDir, "invalid.md"),
        `---
description: No template provided
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].name).toBe("valid")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles command with all config fields", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "full-config.md"),
        `---
template: Full config template {{$arguments}}
description: A fully configured command
agent: special-agent
model: anthropic/claude-3-5-sonnet
subtask: true
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        const cmd = commands[0]
        expect(cmd.name).toBe("full-config")
        expect(cmd.config.template).toBe("Full config template {{$arguments}}")
        expect(cmd.config.description).toBe("A fully configured command")
        expect(cmd.config.agent).toBe("special-agent")
        expect(cmd.config.model).toBe("anthropic/claude-3-5-sonnet")
        expect(cmd.config.subtask).toBe(true)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips commands with invalid name characters", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      // Valid command
      fs.writeFileSync(
        path.join(commandDir, "valid-cmd.md"),
        `---
template: Valid
---
`
      )
      
      // Invalid: contains space in path
      const spacedDir = path.join(commandDir, "spaced dir")
      fs.mkdirSync(spacedDir)
      fs.writeFileSync(
        path.join(spacedDir, "cmd.md"),
        `---
template: In spaced directory
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(1)
        expect(commands[0].name).toBe("valid-cmd")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles case-insensitive .md extension", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(path.join(commandDir, "lower.md"), `---
template: Lowercase
---
`)
      fs.writeFileSync(path.join(commandDir, "upper.MD"), `---
template: Uppercase
---
`)
      fs.writeFileSync(path.join(commandDir, "mixed.Md"), `---
template: Mixed
---
`)

      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(3)
        const names = commands.map(c => c.name).sort()
        expect(names).toEqual(["lower", "mixed", "upper"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("returns empty array when no command directory exists", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-"))
      
      try {
        const commands = await discoverCommands(tmpDir)
        expect(commands).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("resolves template variables in command templates (lotr theme)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-tpl-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "probe.md"),
        `---
description: Run a probe
---
Use {{explorer}} to search and {{researcher}} to look up docs.
`
      )

      try {
        const commands = await discoverCommands(tmpDir, "lotr")
        expect(commands).toHaveLength(1)
        expect(commands[0].config.template).toBe(
          "Use legolas to search and radagast to look up docs."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("resolves template variables in command templates (descriptive theme)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-tpl-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "probe.md"),
        `---
description: Run a probe
---
Use {{explorer}} to search and {{researcher}} to look up docs.
`
      )

      try {
        const commands = await discoverCommands(tmpDir, "descriptive")
        expect(commands).toHaveLength(1)
        expect(commands[0].config.template).toBe(
          "Use explorer to search and researcher to look up docs."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("preserves {{$arguments}} in command templates during template resolution", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-tpl-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "check.md"),
        `---
description: Check something
---
Use {{explorer}} to check {{$arguments}}.
`
      )

      try {
        const commands = await discoverCommands(tmpDir, "lotr")
        expect(commands).toHaveLength(1)
        // {{$arguments}} preserved, {{explorer}} resolved
        expect(commands[0].config.template).toBe(
          "Use legolas to check {{$arguments}}."
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("resolves template variables in frontmatter template field", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-commands-tpl-"))
      const commandDir = path.join(tmpDir, "command")
      fs.mkdirSync(commandDir)
      
      fs.writeFileSync(
        path.join(commandDir, "delegate.md"),
        `---
template: Delegate to {{planner}} for analysis
description: Delegation command
---
`
      )

      try {
        const commands = await discoverCommands(tmpDir, "lotr")
        expect(commands).toHaveLength(1)
        expect(commands[0].config.template).toBe(
          "Delegate to treebeard for analysis"
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })
  })

  describe("discoverPlugins", () => {
    test("discovers .ts plugins in plugin/ directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(
        path.join(pluginDir, "notify.ts"),
        `export const plugin = { name: "notify" }`
      )

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("notify")
        expect(plugins[0].extension).toBe(".ts")
        expect(plugins[0].repoShortName).toBe("my-repo")
        expect(plugins[0].path).toBe(path.join(pluginDir, "notify.ts"))
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("does NOT discover plugins in plugins/ directory (only singular supported)", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugins")  // Note: plural - NOT supported
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(
        path.join(pluginDir, "logger.js"),
        `module.exports = { name: "logger" }`
      )

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        // Plural directory is NOT supported - only plugin/ (singular) works
        expect(plugins).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers multiple plugins with different extensions", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(path.join(pluginDir, "hook1.ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, "hook2.js"), `module.exports = {}`)
      fs.writeFileSync(path.join(pluginDir, "hook3.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "test-repo")
        expect(plugins).toHaveLength(3)
        const names = plugins.map(p => p.name).sort()
        expect(names).toEqual(["hook1", "hook2", "hook3"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("converts nested paths to dashes in plugin name", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const nestedDir = path.join(tmpDir, "plugin", "utils", "helpers")
      fs.mkdirSync(nestedDir, { recursive: true })
      
      fs.writeFileSync(
        path.join(nestedDir, "logger.ts"),
        `export const logger = {}`
      )

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("utils-helpers-logger")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("returns empty array when no plugin directory exists", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      
      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips hidden files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(path.join(pluginDir, "visible.ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, ".hidden.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("visible")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips hidden directories", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      const hiddenDir = path.join(pluginDir, ".hidden")
      fs.mkdirSync(hiddenDir, { recursive: true })
      
      fs.writeFileSync(path.join(pluginDir, "visible.ts"), `export default {}`)
      fs.writeFileSync(path.join(hiddenDir, "inside.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("visible")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips non-.ts/.js files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(path.join(pluginDir, "valid.ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, "readme.md"), `# Readme`)
      fs.writeFileSync(path.join(pluginDir, "config.json"), `{}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("valid")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips plugins with invalid name characters", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      // Valid plugin
      fs.writeFileSync(path.join(pluginDir, "valid-plugin.ts"), `export default {}`)
      
      // Invalid: contains space in directory
      const spacedDir = path.join(pluginDir, "spaced dir")
      fs.mkdirSync(spacedDir)
      fs.writeFileSync(path.join(spacedDir, "plugin.ts"), `export default {}`)
      
      // Invalid: special characters in filename
      fs.writeFileSync(path.join(pluginDir, "special@char.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("valid-plugin")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("handles case-insensitive extensions", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      fs.writeFileSync(path.join(pluginDir, "lower.ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, "upper.TS"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, "mixed.Ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginDir, "jsLower.js"), `module.exports = {}`)
      fs.writeFileSync(path.join(pluginDir, "jsUpper.JS"), `module.exports = {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(5)
        const names = plugins.map(p => p.name).sort()
        expect(names).toEqual(["jsLower", "jsUpper", "lower", "mixed", "upper"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips files larger than 256KB", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      const pluginDir = path.join(tmpDir, "plugin")
      fs.mkdirSync(pluginDir)
      
      // Large file (> 256KB)
      const largeContent = `// ${"x".repeat(300 * 1024)}`
      fs.writeFileSync(path.join(pluginDir, "large.ts"), largeContent)
      
      // Normal file
      fs.writeFileSync(path.join(pluginDir, "normal.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("normal")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("respects max depth limit", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      
      // Create deeply nested directory (12 levels deep, limit is 10)
      let deepPath = path.join(tmpDir, "plugin")
      for (let i = 0; i < 12; i++) {
        deepPath = path.join(deepPath, `level${i}`)
      }
      fs.mkdirSync(deepPath, { recursive: true })
      
      // Plugin at deepest level (should be skipped)
      fs.writeFileSync(path.join(deepPath, "deep.ts"), `export default {}`)
      
      // Plugin at shallow level (should be discovered)
      const shallowPath = path.join(tmpDir, "plugin", "level0")
      fs.writeFileSync(path.join(shallowPath, "shallow.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toContain("shallow")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("prefers plugin/ over plugins/ when both exist", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugins-"))
      
      // Create both directories
      const pluginDir = path.join(tmpDir, "plugin")
      const pluginsDir = path.join(tmpDir, "plugins")
      fs.mkdirSync(pluginDir)
      fs.mkdirSync(pluginsDir)
      
      fs.writeFileSync(path.join(pluginDir, "from-plugin.ts"), `export default {}`)
      fs.writeFileSync(path.join(pluginsDir, "from-plugins.ts"), `export default {}`)

      try {
        const plugins = await discoverPlugins(tmpDir, "my-repo")
        // Should only discover from plugin/, not plugins/
        expect(plugins).toHaveLength(1)
        expect(plugins[0].name).toBe("from-plugin")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })
  })

  describe("discoverMcps", () => {
    test("returns empty array for non-existent repo", async () => {
      const mcps = await discoverMcps("/non/existent/path")
      expect(mcps).toEqual([])
    })

    test("returns empty array for repo without mcp directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-mcps-"))
      try {
        const mcps = await discoverMcps(tmpDir)
        expect(mcps).toEqual([])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers mcp configs in mcp/ directory", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-mcps-"))
      const mcpDir = path.join(tmpDir, "mcp")
      fs.mkdirSync(mcpDir)
      
      // Create a sample MCP config directory
      const sampleMcpDir = path.join(mcpDir, "sample-mcp")
      fs.mkdirSync(sampleMcpDir)
      fs.writeFileSync(
        path.join(sampleMcpDir, "mcp.json"),
        JSON.stringify({ name: "sample-mcp", command: "node", args: ["server.js"] })
      )

      try {
        const mcps = await discoverMcps(tmpDir)
        expect(mcps).toHaveLength(1)
        expect(mcps[0].name).toBe("sample-mcp")
        expect(mcps[0].path).toBe(path.join(sampleMcpDir, "mcp.json"))
        expect(mcps[0].relativePath).toBe("sample-mcp/mcp.json")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers flat mcp/<name>.json files", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-mcps-flat-"))
      const mcpDir = path.join(tmpDir, "mcp")
      fs.mkdirSync(mcpDir)

      fs.writeFileSync(
        path.join(mcpDir, "context7.json"),
        JSON.stringify({ type: "local", command: "npx", args: ["-y", "@upstash/context7-mcp"] })
      )

      try {
        const mcps = await discoverMcps(tmpDir)
        expect(mcps).toHaveLength(1)
        expect(mcps[0].name).toBe("context7")
        expect(mcps[0].path).toBe(path.join(mcpDir, "context7.json"))
        expect(mcps[0].relativePath).toBe("context7.json")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("discovers multiple mcp configs", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-mcps-"))
      const mcpDir = path.join(tmpDir, "mcp")
      fs.mkdirSync(mcpDir)
      
      // Create multiple MCP configs
      for (const name of ["mcp-a", "mcp-b", "mcp-c"]) {
        const dir = path.join(mcpDir, name)
        fs.mkdirSync(dir)
        fs.writeFileSync(
          path.join(dir, "mcp.json"),
          JSON.stringify({ name, command: "node", args: ["server.js"] })
        )
      }

      try {
        const mcps = await discoverMcps(tmpDir)
        expect(mcps).toHaveLength(3)
        const names = mcps.map(m => m.name).sort()
        expect(names).toEqual(["mcp-a", "mcp-b", "mcp-c"])
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })

    test("skips hidden directories", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-mcps-"))
      const mcpDir = path.join(tmpDir, "mcp")
      fs.mkdirSync(mcpDir)
      
      // Visible MCP
      const visibleDir = path.join(mcpDir, "visible-mcp")
      fs.mkdirSync(visibleDir)
      fs.writeFileSync(
        path.join(visibleDir, "mcp.json"),
        JSON.stringify({ name: "visible-mcp", command: "node" })
      )
      
      // Hidden MCP (should be skipped)
      const hiddenDir = path.join(mcpDir, ".hidden-mcp")
      fs.mkdirSync(hiddenDir)
      fs.writeFileSync(
        path.join(hiddenDir, "mcp.json"),
        JSON.stringify({ name: "hidden-mcp", command: "node" })
      )

      try {
        const mcps = await discoverMcps(tmpDir)
        expect(mcps).toHaveLength(1)
        expect(mcps[0].name).toBe("visible-mcp")
      } finally {
        fs.rmSync(tmpDir, { recursive: true })
      }
    })
  })

  test("orchestrator prompt keeps delegation selective while defaulting implementation execution", () => {
    const prompt = fs.readFileSync(path.join(import.meta.dir, "..", "agent", "orchestrator.md"), "utf-8")

    expect(prompt).toContain("Start with at most one child")
    expect(prompt).toContain("Avoid duplicate discovery or review agents")
    expect(prompt).toContain("delegate execution to `{{implementer}}` or `{{tdd}}` by default")
    expect(prompt).toContain("Execute directly only for tiny mechanical edits")
    expect(prompt).not.toContain("For substantial implementation")
    expect(prompt).not.toContain("Default to delegation for any non-trivial task")
  })

  test("diagnostics command runs the full fleet within available capacity", () => {
    const command = fs.readFileSync(path.join(import.meta.dir, "..", "command", "diagnostics.md"), "utf-8")

    expect(command).toContain("Run all 4 subagent probes")
    expect(command).toContain("batches no larger than the currently available capacity")
    expect(command).toContain("default per-session cap of 3 and global cap of 5")
    expect(command).toContain("{{explorer}}")
    expect(command).toContain("{{researcher}}")
    expect(command).toContain("{{planner}}")
    expect(command).toContain("{{implementer}}")
    expect(command).not.toContain("Spawn 4 subagent probes in parallel")
  })
})
