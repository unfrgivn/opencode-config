import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  createEmptyTuiSnapshot,
  getTuiStatePath,
  readTuiSnapshot,
  recordTuiError,
  recordTuiSnapshot,
} from "./tui-state"
import { REPO_SHORT_NAME } from "./constants"

let originalXdgDataHome: string | undefined
let tempDataHome: string

describe("TUI state", () => {
  beforeEach(() => {
    originalXdgDataHome = process.env.XDG_DATA_HOME
    tempDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "fellowship-tui-state-"))
    process.env.XDG_DATA_HOME = tempDataHome
  })

  afterEach(() => {
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    fs.rmSync(tempDataHome, { recursive: true, force: true })
  })

  test("stores snapshots under opencode storage", () => {
    const statePath = getTuiStatePath("/project/a")
    expect(statePath).toStartWith(path.join(tempDataHome, "opencode", "storage", "fellowship"))
    expect(statePath).toEndWith(`${REPO_SHORT_NAME}.tui-state.json`)
    expect(getTuiStatePath("/project/a")).not.toBe(getTuiStatePath("/project/b"))
  })

  test("returns an empty snapshot when no state file exists", () => {
    expect(readTuiSnapshot()).toEqual(createEmptyTuiSnapshot())
  })

  test("records and reads sidebar snapshot data", () => {
    recordTuiSnapshot({
      pluginVersion: "1.2.3",
      activePreset: "fast",
      presetNames: ["fast", "careful"],
      configPaths: ["/Users/test/.config/opencode/fellowship.jsonc", "/repo/.opencode/fellowship.jsonc"],
      agentModels: {
        orchestrator: "openai/gpt-5.5",
        explorer: "anthropic/claude-sonnet-4-6",
      },
      skillNames: ["skill-a", "skill-b"],
      pluginNames: ["runtime"],
      runtimePluginNames: ["@tarquinen/opencode-dcp@latest"],
      mcpNames: ["context7", "exa"],
      agentNames: ["orchestrator", "explorer"],
      commandNames: ["continue"],
      instructionNames: ["getting-started.md"],
      skippedConflicts: ["local-skill"],
      stagedSkillUpdates: ["reflect"],
      dirtySkillCopies: ["reflect"],
      disabledAssets: ["skill:example"],
      pluginsChanged: true,
    })

    const snapshot = readTuiSnapshot()
    expect(snapshot.pluginVersion).toBe("1.2.3")
    expect(snapshot.activePreset).toBe("fast")
    expect(snapshot.presetNames).toEqual(["fast", "careful"])
    expect(snapshot.configPaths).toEqual(["/Users/test/.config/opencode/fellowship.jsonc", "/repo/.opencode/fellowship.jsonc"])
    expect(snapshot.agentModels).toEqual({
      orchestrator: "openai/gpt-5.5",
      explorer: "anthropic/claude-sonnet-4-6",
    })
    expect(snapshot.assetCounts).toEqual({
      skills: 2,
      plugins: 1,
      runtimePlugins: 1,
      mcps: 2,
      agents: 2,
      commands: 1,
      instructions: 1,
    })
    expect(snapshot.warnings).toEqual({
      skippedConflicts: 1,
      stagedSkillUpdates: 1,
      dirtySkillCopies: 1,
      disabledAssets: 1,
      pluginsChanged: true,
      lastError: null,
    })
    expect(snapshot.updatedAt).not.toBe(createEmptyTuiSnapshot().updatedAt)
  })

  test("does not rewrite an unchanged snapshot", () => {
    const input = {
      pluginVersion: "1.2.3",
      activePreset: null,
      presetNames: [],
      configPaths: [],
      agentModels: {},
      skillNames: [],
      pluginNames: [],
      runtimePluginNames: [],
      mcpNames: [],
      agentNames: [],
      commandNames: [],
      instructionNames: [],
      skippedConflicts: [],
      stagedSkillUpdates: [],
      dirtySkillCopies: [],
      disabledAssets: [],
      pluginsChanged: false,
    }
    recordTuiSnapshot(input)
    const statePath = getTuiStatePath()
    const oldTime = new Date("2000-01-01T00:00:00Z")
    fs.utimesSync(statePath, oldTime, oldTime)

    recordTuiSnapshot(input)

    expect(fs.statSync(statePath).mtimeMs).toBe(oldTime.getTime())
  })

  test("records startup errors for the sidebar", () => {
    recordTuiError("failed to load runtime")

    expect(readTuiSnapshot().warnings.lastError).toBe("failed to load runtime")
  })

  test("falls back to an empty snapshot for corrupt state", () => {
    const statePath = getTuiStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, "{this is not json")

    expect(readTuiSnapshot()).toEqual(createEmptyTuiSnapshot())
  })

  test("sanitizes malformed snapshot fields", () => {
    const statePath = getTuiStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        updatedAt: 123,
        pluginVersion: false,
        activePreset: 42,
        presetNames: ["fast", 42, "careful"],
        configPaths: ["/valid", 42],
        agentModels: { orchestrator: "openai/gpt-5.5", broken: 42 },
        assetCounts: { skills: 3, plugins: -1, runtimePlugins: Number.NaN, mcps: "2" },
        warnings: {
          skippedConflicts: 2,
          stagedSkillUpdates: 3,
          dirtySkillCopies: "bad",
          disabledAssets: -1,
          pluginsChanged: true,
          lastError: "boom",
        },
      }),
    )

    const snapshot = readTuiSnapshot()
    expect(snapshot.updatedAt).toBe(createEmptyTuiSnapshot().updatedAt)
    expect(snapshot.pluginVersion).toBeNull()
    expect(snapshot.activePreset).toBeNull()
    expect(snapshot.presetNames).toEqual(["fast", "careful"])
    expect(snapshot.configPaths).toEqual(["/valid"])
    expect(snapshot.agentModels).toEqual({ orchestrator: "openai/gpt-5.5" })
    expect(snapshot.assetCounts.skills).toBe(3)
    expect(snapshot.assetCounts.plugins).toBe(0)
    expect(snapshot.assetCounts.runtimePlugins).toBe(0)
    expect(snapshot.assetCounts.mcps).toBe(0)
    expect(snapshot.warnings).toEqual({
      skippedConflicts: 2,
      stagedSkillUpdates: 3,
      dirtySkillCopies: 0,
      disabledAssets: 0,
      pluginsChanged: true,
      lastError: "boom",
    })
  })
})
