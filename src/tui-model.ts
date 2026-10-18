import type { TuiSnapshot } from "./tui-state"

export function splitModelId(model: string): { provider: string | null; model: string } {
  const slashIndex = model.indexOf("/")
  if (slashIndex === -1) return { provider: null, model }

  return {
    provider: model.slice(0, slashIndex),
    model: model.slice(slashIndex + 1),
  }
}

export function getSidebarAgentNames(snapshot: TuiSnapshot): string[] {
  const agentNames = Object.keys(snapshot.agentModels)
  if (agentNames.length > 0) return agentNames.sort((left, right) => left.localeCompare(right))
  return ["orchestrator", "planner", "explorer", "researcher", "implementer", "architect", "analyst", "tdd"]
}

export function hasSidebarWarning(snapshot: TuiSnapshot): boolean {
  return (
    snapshot.warnings.lastError !== null ||
    snapshot.warnings.pluginsChanged ||
    snapshot.warnings.skippedConflicts > 0 ||
    snapshot.warnings.stagedSkillUpdates > 0 ||
    snapshot.warnings.dirtySkillCopies > 0 ||
    snapshot.warnings.disabledAssets > 0
  )
}

export function formatCompactCount(label: string, count: number): string {
  return `${label} ${count}`
}
