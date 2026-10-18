import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import {
  readPluginStatus,
  writePluginStatus,
  updatePluginStatus,
  formatPluginStatus,
  getStatusFilePath,
  type PluginStatus,
} from "./status"
import { REPO_SHORT_NAME } from "./constants"

/** Build a PluginStatus with sensible defaults, overriding specific fields */
function makeStatus(overrides: Partial<PluginStatus> = {}): PluginStatus {
  return {
    lastLoadTime: "2025-02-27T10:00:00Z",
    pluginVersion: "1.0.0",
    skillNames: [],
    pluginNames: [],
    runtimePluginNames: [],
    mcpNames: [],
    agentNames: [],
    commandNames: [],
    instructionNames: [],
    activePreset: null,
    presetNames: [],
    skippedConflicts: [],
    stagedSkillUpdates: [],
    dirtySkillCopies: [],
    disabledAssets: [],
    lastError: null,
    pluginsChanged: false,
    ...overrides,
  }
}

describe("Status module", () => {
  // Ensure the status directory exists for tests
  beforeEach(() => {
    const statusDir = path.dirname(getStatusFilePath())
    fs.mkdirSync(statusDir, { recursive: true })
    // Clean up any existing status file
    try {
      fs.unlinkSync(getStatusFilePath())
    } catch {
      // File doesn't exist, that's fine
    }
  })

  afterEach(() => {
    // Clean up status file after each test
    try {
      fs.unlinkSync(getStatusFilePath())
    } catch {
      // File doesn't exist, that's fine
    }
  })

  describe("getStatusFilePath", () => {
    test("returns path in cache status directory", () => {
      const statusPath = getStatusFilePath()
      const expected = path.join(
        process.env.HOME || "~",
        ".cache",
        "opencode",
        "fellowship",
        `${REPO_SHORT_NAME}.plugin-status.json`
      )
      expect(statusPath).toBe(expected)
    })
  })

  describe("readPluginStatus", () => {
    test("returns null when no status file exists", () => {
      const status = readPluginStatus()
      expect(status).toBeNull()
    })

    test("reads existing status file", () => {
      const testStatus = makeStatus({
        skillNames: ["frontend-design", "docx", "xlsx", "pdf", "pptx"],
        pluginNames: ["orchestration-core", "readme-editor"],
        mcpNames: ["context7", "chrome-devtools", "exa"],
        agentNames: ["implementer", "explorer", "researcher", "planner"],
        commandNames: ["fellowship-status", "fellowship-list", "diagnostics", "test-orchestration", "check-file", "review"],
        instructionNames: ["orchestration-core.md", "session-protocol.md"],
        skippedConflicts: ["my-local-skill"],
      })
      fs.writeFileSync(getStatusFilePath(), JSON.stringify(testStatus))

      const status = readPluginStatus()
      expect(status).toEqual(testStatus)
    })

    test("returns null for invalid JSON", () => {
      fs.writeFileSync(getStatusFilePath(), "not valid json{")
      const status = readPluginStatus()
      expect(status).toBeNull()
    })
  })

  describe("writePluginStatus", () => {
    test("writes status to file", () => {
      const testStatus = makeStatus({
        skillNames: ["skill-a", "skill-b"],
        pluginNames: ["plugin-a"],
        runtimePluginNames: ["@tarquinen/opencode-dcp@latest"],
        pluginsChanged: true,
      })

      writePluginStatus(testStatus)

      const content = fs.readFileSync(getStatusFilePath(), "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed).toEqual(testStatus)
    })

    test("creates directory if it does not exist", () => {
      // Clean up and remove the directory
      const statusDir = path.dirname(getStatusFilePath())
      try {
        fs.rmSync(statusDir, { recursive: true })
      } catch {
        // Directory may not exist
      }

      const testStatus = makeStatus({ skillNames: ["one-skill"] })

      writePluginStatus(testStatus)
      expect(fs.existsSync(getStatusFilePath())).toBe(true)
    })
  })

  describe("updatePluginStatus", () => {
    test("creates new status with current timestamp", () => {
      const before = new Date().toISOString()

      updatePluginStatus({
        skillNames: ["frontend-design", "docx", "xlsx", "pdf", "pptx"],
        pluginNames: ["orchestration-core", "readme-editor"],
        runtimePluginNames: ["@tarquinen/opencode-dcp@latest"],
        mcpNames: ["context7"],
        agentNames: ["implementer", "explorer", "researcher"],
        commandNames: ["fellowship-status", "fellowship-list", "diagnostics", "review"],
        instructionNames: ["orchestration-core.md"],
        activePreset: "fast",
        presetNames: ["fast", "careful"],
        skippedConflicts: [],
        stagedSkillUpdates: ["reflect"],
        dirtySkillCopies: ["reflect"],
        disabledAssets: ["skill:slack-gif-creator"],
        pluginsChanged: false,
      })

      const after = new Date().toISOString()
      const status = readPluginStatus()

      expect(status).not.toBeNull()
      expect(status!.skillNames).toEqual(["frontend-design", "docx", "xlsx", "pdf", "pptx"])
      expect(status!.runtimePluginNames).toEqual(["@tarquinen/opencode-dcp@latest"])
      expect(status!.activePreset).toBe("fast")
      expect(status!.presetNames).toEqual(["fast", "careful"])
      expect(status!.stagedSkillUpdates).toEqual(["reflect"])
      expect(status!.dirtySkillCopies).toEqual(["reflect"])
      expect(status!.lastError).toBeNull()
      expect(typeof status!.pluginVersion).toBe("string")
      // Timestamp should be between before and after
      expect(status!.lastLoadTime! >= before).toBe(true)
      expect(status!.lastLoadTime! <= after).toBe(true)
    })
  })

  describe("formatPluginStatus", () => {
    test("formats null status as 'not loaded'", () => {
      const output = formatPluginStatus(null)
      expect(output).toContain("Plugin has not loaded yet")
    })

    test("formats successful load status with asset names", () => {
      const status = makeStatus({
        pluginVersion: "1.2.0",
        skillNames: ["frontend-design", "docx", "xlsx", "pdf", "pptx"],
        pluginNames: ["orchestration-core", "readme-editor"],
        runtimePluginNames: ["@tarquinen/opencode-dcp@latest"],
        mcpNames: ["context7", "chrome-devtools", "exa"],
        agentNames: ["implementer", "explorer"],
        commandNames: ["fellowship-status", "diagnostics"],
        instructionNames: ["orchestration-core.md"],
        activePreset: "fast",
        presetNames: ["fast", "careful"],
      })

      const output = formatPluginStatus(status)
      expect(output).toContain("Fellowship Status")
      expect(output).toContain("Plugin Version**: 1.2.0")
      expect(output).toContain("Active Preset**: fast")
      expect(output).toContain("Available Presets**: fast, careful")
      expect(output).toContain("Last Loaded")
      // Asset names listed
      expect(output).toContain("Skills (5): frontend-design, docx, xlsx, pdf, pptx")
      expect(output).toContain("Bundled Plugins (2): orchestration-core, readme-editor")
      expect(output).toContain("MCPs (3): context7, chrome-devtools, exa")
      expect(output).toContain("Agents (2): implementer, explorer")
      expect(output).toContain("Commands (2): fellowship-status, diagnostics")
      expect(output).toContain("Instructions (1): orchestration-core.md")
      // Runtime plugins section
      expect(output).toContain("Runtime Plugins")
      expect(output).toContain("@tarquinen/opencode-dcp@latest")
    })

    test("shows 'none' for empty asset categories", () => {
      const status = makeStatus()

      const output = formatPluginStatus(status)
      expect(output).toContain("Skills: none")
      expect(output).toContain("Bundled Plugins: none")
      expect(output).toContain("MCPs: none")
    })

    test("includes error when present", () => {
      const status = makeStatus({
        lastError: "Failed to read package directory",
      })

      const output = formatPluginStatus(status)
      expect(output).toContain("Last Error")
      expect(output).toContain("Failed to read package directory")
    })

    test("includes conflict warning with skill names", () => {
      const status = makeStatus({
        skillNames: ["skill-a", "skill-b", "skill-c"],
        skippedConflicts: ["local-skill-x", "local-skill-y"],
      })

      const output = formatPluginStatus(status)
      expect(output).toContain("2 skill(s) skipped due to local conflicts: local-skill-x, local-skill-y")
    })

    test("includes staged and dirty copied skill warnings", () => {
      const status = makeStatus({
        stagedSkillUpdates: ["reflect", "codemap"],
        dirtySkillCopies: ["reflect"],
      })

      const output = formatPluginStatus(status)
      expect(output).toContain("Staged Skill Updates**: reflect, codemap")
      expect(output).toContain("Review staged copies")
      expect(output).toContain("Dirty Managed Skill Copies**: reflect")
    })

    test("includes plugins changed action when present", () => {
      const status = makeStatus({
        pluginNames: ["new-plugin"],
        pluginsChanged: true,
      })

      const output = formatPluginStatus(status)
      expect(output).toContain("Action Required")
      expect(output).toContain("Restart OpenCode")
    })

    test("omits runtime plugins section when empty", () => {
      const status = makeStatus({ runtimePluginNames: [] })

      const output = formatPluginStatus(status)
      expect(output).not.toContain("Runtime Plugins")
    })
  })
})
