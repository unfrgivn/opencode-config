import { describe, test, expect } from "bun:test"
import {
  resolveAgentName,
  buildTemplateVars,
  resolveTemplateVars,
  buildReverseMap,
  getAgentNameTable,
  getAgentNameAliases,
  lookupAgentAlias,
  type AgentNameTheme,
} from "./agent-names"

describe("agent-names", () => {
  describe("getAgentNameTable", () => {
    test("returns a non-empty readonly table", () => {
      const table = getAgentNameTable()
      expect(table.length).toBeGreaterThan(0)
    })

    test("every entry has canonical, role, and both themed names", () => {
      for (const entry of getAgentNameTable()) {
        expect(entry.canonical).toBeTruthy()
        expect(entry.role).toBeTruthy()
        expect(entry.themed.lotr).toBeTruthy()
        expect(entry.themed.descriptive).toBeTruthy()
      }
    })

    test("canonical names are unique", () => {
      const table = getAgentNameTable()
      const canonicals = table.map((e) => e.canonical)
      expect(new Set(canonicals).size).toBe(canonicals.length)
    })

    test("roles are unique", () => {
      const table = getAgentNameTable()
      const roles = table.map((e) => e.role)
      expect(new Set(roles).size).toBe(roles.length)
    })

    test("lotr themed names are unique", () => {
      const table = getAgentNameTable()
      const names = table.map((e) => e.themed.lotr)
      expect(new Set(names).size).toBe(names.length)
    })

    test("descriptive themed names are unique", () => {
      const table = getAgentNameTable()
      const names = table.map((e) => e.themed.descriptive)
      expect(new Set(names).size).toBe(names.length)
    })

    test("descriptive theme uses canonical names (they match by convention)", () => {
      for (const entry of getAgentNameTable()) {
        expect(entry.themed.descriptive).toBe(entry.canonical)
      }
    })
  })

  describe("resolveAgentName", () => {
    test("returns lotr name for lotr theme", () => {
      expect(resolveAgentName("orchestrator", "lotr")).toBe("gandalf")
      expect(resolveAgentName("explorer", "lotr")).toBe("legolas")
      expect(resolveAgentName("implementer", "lotr")).toBe("celebrimbor")
    })

    test("returns descriptive name for descriptive theme (passthrough)", () => {
      expect(resolveAgentName("orchestrator", "descriptive")).toBe("orchestrator")
      expect(resolveAgentName("explorer", "descriptive")).toBe("explorer")
      expect(resolveAgentName("implementer", "descriptive")).toBe("implementer")
      expect(resolveAgentName("researcher", "descriptive")).toBe("researcher")
      expect(resolveAgentName("planner", "descriptive")).toBe("planner")
      expect(resolveAgentName("architect", "descriptive")).toBe("architect")
      expect(resolveAgentName("analyst", "descriptive")).toBe("analyst")
      expect(resolveAgentName("tdd", "descriptive")).toBe("tdd")
    })

    test("passes through unknown names unchanged", () => {
      expect(resolveAgentName("custom-agent", "lotr")).toBe("custom-agent")
      expect(resolveAgentName("custom-agent", "descriptive")).toBe("custom-agent")
    })

    test("passes through empty string unchanged", () => {
      expect(resolveAgentName("", "lotr")).toBe("")
      expect(resolveAgentName("", "descriptive")).toBe("")
    })
  })

  describe("buildTemplateVars", () => {
    test("lotr theme maps roles to lotr names", () => {
      const vars = buildTemplateVars("lotr")
      expect(vars.orchestrator).toBe("gandalf")
      expect(vars.explorer).toBe("legolas")
      expect(vars.researcher).toBe("radagast")
      expect(vars.planner).toBe("treebeard")
      expect(vars.implementer).toBe("celebrimbor")
      expect(vars.architect).toBe("elrond")
      expect(vars.analyst).toBe("galadriel")
      expect(vars.tdd).toBe("aragorn")
    })

    test("descriptive theme maps roles to descriptive names", () => {
      const vars = buildTemplateVars("descriptive")
      expect(vars.orchestrator).toBe("orchestrator")
      expect(vars.explorer).toBe("explorer")
      expect(vars.researcher).toBe("researcher")
      expect(vars.planner).toBe("planner")
      expect(vars.implementer).toBe("implementer")
      expect(vars.architect).toBe("architect")
      expect(vars.analyst).toBe("analyst")
      expect(vars.tdd).toBe("tdd")
    })

    test("returns correct number of entries", () => {
      const table = getAgentNameTable()
      const vars = buildTemplateVars("lotr")
      expect(Object.keys(vars).length).toBe(table.length)
    })
  })

  describe("resolveTemplateVars", () => {
    test("replaces known template variables", () => {
      const vars = buildTemplateVars("lotr")
      const input = "Use `{{explorer}}` for codebase discovery."
      expect(resolveTemplateVars(input, vars)).toBe("Use `legolas` for codebase discovery.")
    })

    test("replaces multiple variables in same string", () => {
      const vars = buildTemplateVars("descriptive")
      const input = "{{explorer}} and {{researcher}} work together"
      expect(resolveTemplateVars(input, vars)).toBe("explorer and researcher work together")
    })

    test("leaves unknown template variables as-is", () => {
      const vars = buildTemplateVars("lotr")
      const input = "{{unknown_var}} stays and {{explorer}} resolves"
      expect(resolveTemplateVars(input, vars)).toBe("{{unknown_var}} stays and legolas resolves")
    })

    test("leaves OpenCode argument variables untouched", () => {
      // OpenCode uses {{$arguments}} which has a $ that won't match \w+
      const vars = buildTemplateVars("lotr")
      const input = "Deploy to {{$arguments}} using {{explorer}}"
      expect(resolveTemplateVars(input, vars)).toBe("Deploy to {{$arguments}} using legolas")
    })

    test("handles text with no template variables", () => {
      const vars = buildTemplateVars("lotr")
      const input = "No variables here, just plain text."
      expect(resolveTemplateVars(input, vars)).toBe("No variables here, just plain text.")
    })

    test("handles empty string", () => {
      const vars = buildTemplateVars("lotr")
      expect(resolveTemplateVars("", vars)).toBe("")
    })

    test("handles empty vars map", () => {
      const input = "{{explorer}} stays"
      expect(resolveTemplateVars(input, {})).toBe("{{explorer}} stays")
    })

    test("replaces multiple occurrences of same variable", () => {
      const vars = buildTemplateVars("lotr")
      const input = "{{explorer}} meets {{explorer}} again"
      expect(resolveTemplateVars(input, vars)).toBe("legolas meets legolas again")
    })
  })

  describe("buildReverseMap", () => {
    test("lotr reverse map: lotr name → canonical (descriptive)", () => {
      const reverse = buildReverseMap("lotr")
      expect(reverse.gandalf).toBe("orchestrator")
      expect(reverse.legolas).toBe("explorer")
    })

    test("descriptive reverse map: descriptive name → canonical (identity)", () => {
      const reverse = buildReverseMap("descriptive")
      expect(reverse.orchestrator).toBe("orchestrator")
      expect(reverse.explorer).toBe("explorer")
      expect(reverse.researcher).toBe("researcher")
      expect(reverse.planner).toBe("planner")
      expect(reverse.implementer).toBe("implementer")
      expect(reverse.architect).toBe("architect")
      expect(reverse.analyst).toBe("analyst")
      expect(reverse.tdd).toBe("tdd")
    })

    test("reverse map has correct number of entries", () => {
      const table = getAgentNameTable()
      const reverse = buildReverseMap("lotr")
      expect(Object.keys(reverse).length).toBe(table.length)
    })
  })

  describe("getAgentNameAliases", () => {
    test("returns both descriptive and LOTR names for built-in agents", () => {
      expect(getAgentNameAliases("orchestrator")).toEqual(["orchestrator", "gandalf"])
      expect(getAgentNameAliases("gandalf")).toEqual(["orchestrator", "gandalf"])
    })

    test("passes through unknown names unchanged", () => {
      expect(getAgentNameAliases("custom-agent")).toEqual(["custom-agent"])
    })
  })

  describe("lookupAgentAlias", () => {
    test("finds exact matches first", () => {
      const result = lookupAgentAlias({ orchestrator: "a", gandalf: "b" }, "gandalf")
      expect(result).toEqual({ key: "gandalf", value: "b" })
    })

    test("finds alternate built-in alias when exact key is absent", () => {
      const result = lookupAgentAlias({ gandalf: "model" }, "orchestrator")
      expect(result).toEqual({ key: "gandalf", value: "model" })
    })

    test("returns null when no alias matches", () => {
      expect(lookupAgentAlias({ explorer: "model" }, "orchestrator")).toBeNull()
    })
  })

  describe("theme integration", () => {
    test("descriptive theme is identity: resolved names equal canonical names", () => {
      for (const entry of getAgentNameTable()) {
        expect(resolveAgentName(entry.canonical, "descriptive")).toBe(entry.canonical)
      }
    })

    test("lotr theme: all names differ from canonical for known agents", () => {
      for (const entry of getAgentNameTable()) {
        const lotr = resolveAgentName(entry.canonical, "lotr")
        expect(lotr).toBe(entry.themed.lotr)
        // LOTR names should differ from the descriptive canonical names
        expect(lotr).not.toBe(entry.canonical)
      }
    })

    test("template vars resolve consistently with agent names per theme", () => {
      const themes: AgentNameTheme[] = ["lotr", "descriptive"]
      for (const theme of themes) {
        const vars = buildTemplateVars(theme)
        for (const entry of getAgentNameTable()) {
          // Template var for the role should match the themed name
          expect(vars[entry.role]).toBe(resolveAgentName(entry.canonical, theme))
        }
      }
    })
  })
})
