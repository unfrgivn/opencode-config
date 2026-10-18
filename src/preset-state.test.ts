import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { REPO_SHORT_NAME } from "./constants"
import {
  createEmptyPresetSelection,
  getPresetSelectionPath,
  readPresetSelection,
  writePresetSelection,
} from "./preset-state"

describe("preset state", () => {
  let originalHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    originalHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "fellowship-preset-state-"))
    process.env.HOME = tempHome
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  test("stores selection under the plugin cache directory", () => {
    expect(getPresetSelectionPath()).toBe(
      path.join(tempHome, ".cache", "opencode", "fellowship", `${REPO_SHORT_NAME}.preset-state.json`),
    )
  })

  test("returns null when no selection file exists", () => {
    expect(readPresetSelection()).toBeNull()
  })

  test("writes and reads an active preset selection", () => {
    const written = writePresetSelection("fast")

    expect(written.activePreset).toBe("fast")
    expect(readPresetSelection()).toEqual(written)
  })

  test("writes and reads a cleared preset selection", () => {
    writePresetSelection(null)

    const state = readPresetSelection()
    expect(state?.activePreset).toBeNull()
    expect(state?.updatedAt).not.toBe(createEmptyPresetSelection().updatedAt)
  })

  test("falls back for malformed selection fields", () => {
    const statePath = getPresetSelectionPath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        activePreset: 42,
        updatedAt: false,
      }),
    )

    expect(readPresetSelection()).toEqual(createEmptyPresetSelection())
  })
})
