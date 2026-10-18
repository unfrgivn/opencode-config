import { describe, test, expect } from "bun:test"
import { createEmptyTuiSnapshot, type TuiSnapshot } from "./tui-state"
import { formatCompactCount, getSidebarAgentNames, hasSidebarWarning, splitModelId } from "./tui-model"

interface SnapshotOverrides extends Partial<Omit<TuiSnapshot, "assetCounts" | "warnings">> {
  assetCounts?: Partial<TuiSnapshot["assetCounts"]>
  warnings?: Partial<TuiSnapshot["warnings"]>
}

function snapshotWith(overrides: SnapshotOverrides): TuiSnapshot {
  return {
    ...createEmptyTuiSnapshot(),
    ...overrides,
    assetCounts: {
      ...createEmptyTuiSnapshot().assetCounts,
      ...overrides.assetCounts,
    },
    warnings: {
      ...createEmptyTuiSnapshot().warnings,
      ...overrides.warnings,
    },
  }
}

describe("TUI model helpers", () => {
  test("splits provider-prefixed model ids", () => {
    expect(splitModelId("openai/gpt-5.5")).toEqual({ provider: "openai", model: "gpt-5.5" })
  })

  test("keeps provider empty for plain model ids", () => {
    expect(splitModelId("gpt-5.5")).toEqual({ provider: null, model: "gpt-5.5" })
  })

  test("uses a stable fallback agent list before the plugin records state", () => {
    expect(getSidebarAgentNames(createEmptyTuiSnapshot())).toEqual([
      "orchestrator",
      "planner",
      "explorer",
      "researcher",
      "implementer",
      "architect",
      "analyst",
      "tdd",
    ])
  })

  test("sorts agent names from recorded model state", () => {
    const snapshot = snapshotWith({
      agentModels: {
        researcher: "openai/gpt-5.5",
        architect: "anthropic/claude-sonnet-4-6",
      },
    })

    expect(getSidebarAgentNames(snapshot)).toEqual(["architect", "researcher"])
  })

  test("detects warning-worthy sidebar states", () => {
    expect(hasSidebarWarning(createEmptyTuiSnapshot())).toBe(false)
    expect(hasSidebarWarning(snapshotWith({ warnings: { skippedConflicts: 1 } }))).toBe(true)
    expect(hasSidebarWarning(snapshotWith({ warnings: { stagedSkillUpdates: 1 } }))).toBe(true)
    expect(hasSidebarWarning(snapshotWith({ warnings: { dirtySkillCopies: 1 } }))).toBe(true)
    expect(hasSidebarWarning(snapshotWith({ warnings: { disabledAssets: 1 } }))).toBe(true)
    expect(hasSidebarWarning(snapshotWith({ warnings: { pluginsChanged: true } }))).toBe(true)
    expect(hasSidebarWarning(snapshotWith({ warnings: { lastError: "boom" } }))).toBe(true)
  })

  test("formats compact count labels", () => {
    expect(formatCompactCount("skills", 37)).toBe("skills 37")
  })
})
