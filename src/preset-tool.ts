import { loadConfigWithLocation } from "./config"
import { readPresetSelection, writePresetSelection } from "./preset-state"

type PresetToolInput = {
  action: "list" | "set" | "clear"
  preset?: string
}

function formatPresetList(): string {
  const { config, activePreset } = loadConfigWithLocation()
  const presetEntries = Object.entries(config.presets).sort(([left], [right]) => left.localeCompare(right))

  if (presetEntries.length === 0) {
    return [
      "# Fellowship Presets",
      "",
      "No presets are configured yet.",
      "Add `presets` to `fellowship.json` or `.opencode/fellowship.jsonc`, then restart OpenCode.",
    ].join("\n")
  }

  const lines = ["# Fellowship Presets", "", `Active: ${activePreset ?? "default"}`, ""]
  for (const [name, preset] of presetEntries) {
    const marker = name === activePreset ? "*" : " "
    const description = preset.description ? ` - ${preset.description}` : ""
    const modelCount = Object.keys(preset.models ?? {}).length
    const orchestration = preset.orchestration ? ", orchestration" : ""
    lines.push(`[${marker}] ${name}${description} (${modelCount} model override${modelCount === 1 ? "" : "s"}${orchestration})`)
  }
  lines.push("", "Use `/preset <name>` to select a preset, or `/preset default` to clear the runtime selection.")
  lines.push("Preset changes apply after restarting OpenCode.")

  return lines.join("\n")
}

function selectPreset(presetName: string): string {
  const trimmed = presetName.trim()
  if (trimmed.length === 0) return formatPresetList()
  if (trimmed.includes(" ")) {
    return `Preset names cannot contain spaces in this command: '${trimmed}'. Run /preset to see available presets.`
  }

  if (trimmed === "default" || trimmed === "none" || trimmed === "off") {
    writePresetSelection(null)
    return [
      "Runtime preset selection cleared.",
      "The config-defined preset, if any, will apply after restarting OpenCode.",
    ].join("\n")
  }

  const { config } = loadConfigWithLocation()
  if (!Object.prototype.hasOwnProperty.call(config.presets, trimmed)) {
    const available = Object.keys(config.presets).sort((left, right) => left.localeCompare(right))
    return [
      `Unknown preset: ${trimmed}`,
      available.length > 0 ? `Available presets: ${available.join(", ")}` : "No presets are configured yet.",
    ].join("\n")
  }

  writePresetSelection(trimmed)
  return [
    `Runtime preset selected: ${trimmed}`,
    "Restart OpenCode to apply this preset to agents and orchestration settings.",
  ].join("\n")
}

function isPresetToolInput(input: unknown): input is PresetToolInput {
  if (typeof input !== "object" || input === null) return false
  const record = input as Record<string, unknown>
  if (record.action !== "list" && record.action !== "set" && record.action !== "clear") return false
  return record.preset === undefined || typeof record.preset === "string"
}

export const presetTool = {
  name: "fellowship_preset",
  description: "List and select Fellowship runtime presets. Preset changes apply after restart.",
  input: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "set", "clear"] },
      preset: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  execute: async (args: unknown) => {
    if (!isPresetToolInput(args)) return { content: "Invalid preset tool input" }
    if (args.action === "list") return { content: formatPresetList() }
    if (args.action === "clear") {
      writePresetSelection(null)
      const state = readPresetSelection()
      return { content: [
        "Runtime preset selection cleared.",
        `Updated: ${state?.updatedAt ?? "unknown"}`,
        "Restart OpenCode to apply the default/config-defined preset.",
      ].join("\n") }
    }

    return { content: selectPreset(args.preset ?? "") }
  },
}
