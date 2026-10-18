import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { REPO_SHORT_NAME, STORAGE_DIR_NAME } from "./constants"

export interface PresetSelectionState {
  version: 1
  activePreset: string | null
  updatedAt: string
}

function cacheDir(): string {
  const home = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : os.homedir()
  return path.join(home, ".cache", "opencode", STORAGE_DIR_NAME)
}

export function getPresetSelectionPath(): string {
  return path.join(cacheDir(), `${REPO_SHORT_NAME}.preset-state.json`)
}

export function createEmptyPresetSelection(): PresetSelectionState {
  return {
    version: 1,
    activePreset: null,
    updatedAt: new Date(0).toISOString(),
  }
}

function parsePresetSelection(content: string): PresetSelectionState {
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createEmptyPresetSelection()

  const record = parsed as Record<string, unknown>
  if (record.version !== 1) return createEmptyPresetSelection()

  return {
    version: 1,
    activePreset: typeof record.activePreset === "string" ? record.activePreset : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  }
}

export function readPresetSelection(): PresetSelectionState | null {
  try {
    return parsePresetSelection(fs.readFileSync(getPresetSelectionPath(), "utf-8"))
  } catch {
    return null
  }
}

export function writePresetSelection(activePreset: string | null): PresetSelectionState {
  const state: PresetSelectionState = {
    version: 1,
    activePreset,
    updatedAt: new Date().toISOString(),
  }
  const statePath = getPresetSelectionPath()
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  return state
}
