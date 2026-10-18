import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { presetTool } from "./preset-tool"
import { readPresetSelection } from "./preset-state"

describe("preset tool", () => {
  let originalCwd: string
  let originalHome: string | undefined
  let originalPresetEnv: string | undefined
  let tempDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    originalHome = process.env.HOME
    originalPresetEnv = process.env.FELLOWSHIP_PRESET
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fellowship-preset-tool-"))
    process.chdir(tempDir)
    process.env.HOME = tempDir
    delete process.env.FELLOWSHIP_PRESET
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalPresetEnv === undefined) {
      delete process.env.FELLOWSHIP_PRESET
    } else {
      process.env.FELLOWSHIP_PRESET = originalPresetEnv
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeProjectConfig(config: unknown): void {
    const configDir = path.join(tempDir, ".opencode")
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, "fellowship.json"), JSON.stringify(config))
  }

  async function runPresetTool(input: unknown): Promise<string> {
    const result = await presetTool.execute(input)
    return result.content ?? ""
  }

  test("lists configured presets with the active marker", async () => {
    writeProjectConfig({
      preset: "fast",
      presets: {
        careful: {
          description: "Use stronger models",
          orchestration: { providerMode: "native" },
        },
        fast: {
          description: "Move quickly",
          models: { orchestrator: "openai/gpt-5.5" },
        },
      },
    })

    const output = await runPresetTool({ action: "list" })

    expect(output).toContain("# Fellowship Presets")
    expect(output).toContain("Active: fast")
    expect(output).toContain("[ ] careful - Use stronger models (0 model overrides, orchestration)")
    expect(output).toContain("[*] fast - Move quickly (1 model override)")
  })

  test("selects a configured preset", async () => {
    writeProjectConfig({
      presets: {
        fast: { models: { orchestrator: "openai/gpt-5.5" } },
      },
    })

    const output = await runPresetTool({ action: "set", preset: " fast " })

    expect(output).toContain("Runtime preset selected: fast")
    expect(readPresetSelection()?.activePreset).toBe("fast")
  })

  test("clears runtime preset selection", async () => {
    writeProjectConfig({ presets: { fast: {} } })
    await runPresetTool({ action: "set", preset: "fast" })

    const output = await runPresetTool({ action: "clear" })

    expect(output).toContain("Runtime preset selection cleared")
    expect(readPresetSelection()?.activePreset).toBeNull()
  })

  test("reports unknown presets with available choices", async () => {
    writeProjectConfig({ presets: { fast: {}, careful: {} } })

    const output = await runPresetTool({ action: "set", preset: "missing" })

    expect(output).toContain("Unknown preset: missing")
    expect(output).toContain("Available presets: careful, fast")
    expect(readPresetSelection()).toBeNull()
  })

  test("rejects multi-word preset arguments", async () => {
    writeProjectConfig({ presets: { fast: {} } })

    const output = await runPresetTool({ action: "set", preset: "fast please" })

    expect(output).toContain("Preset names cannot contain spaces")
    expect(readPresetSelection()).toBeNull()
  })

  test("explains when no presets are configured", async () => {
    const output = await runPresetTool({ action: "list" })

    expect(output).toContain("No presets are configured yet")
  })
})
