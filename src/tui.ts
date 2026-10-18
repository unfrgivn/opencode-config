import { Plugin } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createElement, insert, setProp } from "@opentui/solid"
import { formatCompactCount, getSidebarAgentNames, hasSidebarWarning, splitModelId } from "./tui-model"
import { readTuiSnapshot, readTuiSnapshotAsync, type TuiSnapshot } from "./tui-state"
import { homeDir } from "./paths"

const PLUGIN_LABEL = "Fellowship"
const PLUGIN_ID = "@unfrgivn/opencode-config:tui"
const REFRESH_INTERVAL_MS = 1000
const WARNING_COLOR = "orange"

type Child = JSX.Element | string | number | null | undefined | false

function element<Tag extends Extract<keyof JSX.IntrinsicElements, string>>(
  tag: Tag,
  props: JSX.IntrinsicElements[Tag],
  children: Child[] = [],
): JSX.Element {
  const node = createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    insert(node, child)
  }

  return node
}

function box(props: JSX.IntrinsicElements["box"], children: Child[] = []): JSX.Element {
  return element("box", props, children)
}

function text(props: JSX.IntrinsicElements["text"], children: Child[]): JSX.Element {
  return element("text", props, children)
}

function shortPath(configPath: string): string {
  const home = homeDir()
  if (home && configPath.startsWith(home)) return `~${configPath.slice(home.length)}`
  return configPath
}

type ThemeColors = {
  accent: string
  background: string
  borderActive: string
  text: string
  textMuted: string
}

type ColorSource = Pick<RGBA, "toInts">

type HostTheme = {
  text: {
    default: ColorSource
    subdued: ColorSource
    action: { primary: { default: ColorSource } }
  }
  background: {
    action: { primary: { default: ColorSource } }
  }
  border: { default: ColorSource }
}

export function toPortableColor(color: ColorSource): string {
  return `#${color
    .toInts()
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")}`
}

export function portableTheme(theme: HostTheme): ThemeColors {
  return {
    accent: toPortableColor(theme.background.action.primary.default),
    background: toPortableColor(theme.text.action.primary.default),
    borderActive: toPortableColor(theme.border.default),
    text: toPortableColor(theme.text.default),
    textMuted: toPortableColor(theme.text.subdued),
  }
}

function countRow(label: string, count: number, theme: Pick<ThemeColors, "textMuted">): JSX.Element {
  return text({ fg: theme.textMuted }, [formatCompactCount(label, count)])
}

function agentRow(agentName: string, model: string, theme: Pick<ThemeColors, "textMuted">): JSX.Element {
  const modelParts = splitModelId(model)
  const modelLabel = modelParts.provider ? `${modelParts.provider}/${modelParts.model}` : modelParts.model
  return box({ width: "100%", flexDirection: "row", justifyContent: "space-between" }, [
    text({ fg: theme.textMuted, width: 14 }, [agentName]),
    text({ fg: theme.textMuted }, [modelLabel]),
  ])
}

function warningRows(snapshot: TuiSnapshot, theme: Pick<ThemeColors, "textMuted">): JSX.Element[] {
  if (!hasSidebarWarning(snapshot)) return []

  const rows: JSX.Element[] = [text({ fg: WARNING_COLOR }, ["Attention"])]
  if (snapshot.warnings.lastError) {
    rows.push(text({ fg: theme.textMuted }, ["last load error"]))
  }
  if (snapshot.warnings.pluginsChanged) {
    rows.push(text({ fg: theme.textMuted }, ["restart for plugin changes"]))
  }
  if (snapshot.warnings.skippedConflicts > 0) {
    rows.push(text({ fg: theme.textMuted }, [`${snapshot.warnings.skippedConflicts} local skill conflicts`]))
  }
  if (snapshot.warnings.stagedSkillUpdates > 0) {
    rows.push(text({ fg: theme.textMuted }, [`${snapshot.warnings.stagedSkillUpdates} staged skill updates`]))
  }
  if (snapshot.warnings.dirtySkillCopies > 0) {
    rows.push(text({ fg: theme.textMuted }, [`${snapshot.warnings.dirtySkillCopies} dirty skill copies`]))
  }
  if (snapshot.warnings.disabledAssets > 0) {
    rows.push(text({ fg: theme.textMuted }, [`${snapshot.warnings.disabledAssets} disabled assets`]))
  }

  return [box({ width: "100%", flexDirection: "column", marginTop: 1 }, rows)]
}

function configRows(snapshot: TuiSnapshot, theme: Pick<ThemeColors, "textMuted">): JSX.Element[] {
  if (snapshot.configPaths.length === 0) {
    return [text({ fg: theme.textMuted }, ["config default"])]
  }

  return snapshot.configPaths.slice(-2).map((configPath) => text({ fg: theme.textMuted }, [shortPath(configPath)]))
}

export function renderSidebar(snapshot: TuiSnapshot, theme: ThemeColors): JSX.Element {
  const version = snapshot.pluginVersion ?? "dev"
  const counts = snapshot.assetCounts

  return box(
    {
      width: "100%",
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: theme.borderActive,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 1,
      paddingRight: 1,
    },
    [
      box({ width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, [
        box({ paddingLeft: 1, paddingRight: 1, backgroundColor: theme.accent }, [
          text({ fg: theme.background }, [PLUGIN_LABEL]),
        ]),
        text({ fg: theme.textMuted }, [`v${version}`]),
      ]),
      ...warningRows(snapshot, theme),
      box({ width: "100%", flexDirection: "column", marginTop: 1 }, [
        text({ fg: theme.text }, ["Assets"]),
        countRow("presets", snapshot.presetNames.length, theme),
        countRow("skills", counts.skills, theme),
        countRow("agents", counts.agents, theme),
        countRow("cmds", counts.commands, theme),
        countRow("mcps", counts.mcps, theme),
        countRow("runtime", counts.runtimePlugins, theme),
        countRow("instructions", counts.instructions, theme),
      ]),
      box({ width: "100%", flexDirection: "column", marginTop: 1 }, [
        text({ fg: theme.text }, ["Preset"]),
        text({ fg: theme.textMuted }, [snapshot.activePreset ?? "default"]),
      ]),
      box({ width: "100%", flexDirection: "column", marginTop: 1 }, [
        text({ fg: theme.text }, ["Agents"]),
        ...getSidebarAgentNames(snapshot).map((agentName) =>
          agentRow(agentName, snapshot.agentModels[agentName] ?? "pending", theme),
        ),
      ]),
      box({ width: "100%", flexDirection: "column", marginTop: 1 }, [
        text({ fg: theme.text }, ["Config"]),
        ...configRows(snapshot, theme),
      ]),
    ],
  )
}

const plugin = Plugin.define({
  id: PLUGIN_ID,
  setup: async (api) => {
    const projectDir = api.location?.directory ?? process.cwd()
    let snapshot = readTuiSnapshot(projectDir)
    let snapshotJSON = JSON.stringify(snapshot)
    let reading = false
    let disposed = false
    const refresh = async () => {
      if (reading || disposed) return
      reading = true
      try {
        const nextSnapshot = await readTuiSnapshotAsync(projectDir)
        const nextJSON = JSON.stringify(nextSnapshot)
        if (disposed || nextJSON === snapshotJSON) return
        snapshot = nextSnapshot
        snapshotJSON = nextJSON
        api.renderer.requestRender()
      } catch {
        // Sidebar state is best-effort only.
      } finally {
        reading = false
      }
    }
    const renderTimer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)

    const disposeSlot = api.ui.slot({
      append: "sidebar.content",
      render: () => renderSidebar(snapshot, portableTheme(api.theme)),
    })

    return () => {
      disposed = true
      clearInterval(renderTimer)
      disposeSlot()
    }
  },
})

export default plugin
