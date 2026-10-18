import * as path from "path"
import * as fs from "fs"
import matter from "gray-matter"
import { AgentConfigSchema, type AgentInfo } from "./agent"
import { CommandConfigSchema, type CommandInfo } from "./command"
import { discoverInstructions, type InstructionInfo } from "./instruction"
import type { PluginInfo } from "./plugin-info"
import { REPO_SHORT_NAME } from "./constants"
import { logError, logWarn } from "./logging"
import {
  type AgentNameTheme,
  resolveAgentName,
  buildTemplateVars,
  resolveTemplateVars,
} from "./agent-names"

export interface SkillInfo {
  name: string
  path: string
  description?: string
}

export interface McpInfo {
  name: string
  path: string
  relativePath: string
}

export type { AgentInfo } from "./agent"
export type { CommandInfo } from "./command"
export type { PluginInfo } from "./plugin-info"
export type { InstructionInfo } from "./instruction"

const DISCOVERY_LIMITS = {
  maxFiles: 100,
  maxFileSize: 256 * 1024,
  maxDepth: 10,
}

/** Result of discovering all assets from the package directory */
export interface DiscoveryResult {
  shortName: string
  skills: SkillInfo[]
  agents: AgentInfo[]
  commands: CommandInfo[]
  plugins: PluginInfo[]
  instructions: InstructionInfo[]
  mcps: McpInfo[]
}

/**
 * Discover all bundled assets from the given root directory.
 * This scans the package's bundled asset directories.
 */
export async function discoverAssets(packageRoot: string, theme: AgentNameTheme = "descriptive"): Promise<DiscoveryResult> {
  const skills = await discoverSkills(packageRoot)
  const agents = await discoverAgents(packageRoot, theme)
  const commands = await discoverCommands(packageRoot, theme)
  const plugins = await discoverPlugins(packageRoot, REPO_SHORT_NAME)
  const instructions = discoverInstructions(packageRoot)
  const mcps = await discoverMcps(packageRoot)

  return {
    shortName: REPO_SHORT_NAME,
    skills,
    agents,
    commands,
    plugins,
    instructions,
    mcps,
  }
}

export async function discoverSkills(repoPath: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []

  const skillDir = path.join(repoPath, "skill")
  if (!fs.existsSync(skillDir)) return skills

  const findSkills = (dir: string, depth: number) => {
    if (depth > DISCOVERY_LIMITS.maxDepth) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const skillMdPath = path.join(fullPath, "SKILL.md")
        if (fs.existsSync(skillMdPath)) {
          const relativePath = path.relative(skillDir, fullPath)
          const skillName = relativePath.replace(/\\/g, "/").replace(/\//g, "-")

          let description: string | undefined
          try {
            const content = fs.readFileSync(skillMdPath, "utf-8")
            const match = content.match(/^---\n[\s\S]*?description:\s*(.+?)\n[\s\S]*?---/m)
            if (match) description = match[1].trim().replace(/^["']|["']$/g, "")
          } catch {}

          skills.push({ name: skillName, path: fullPath, description })
        } else {
          findSkills(fullPath, depth + 1)
        }
      }
    }
  }

  findSkills(skillDir, 0)
  return skills
}

export async function discoverAgents(repoPath: string, theme: AgentNameTheme = "descriptive"): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = []
  let filesProcessed = 0
  let warned = false

  const agentDir = path.join(repoPath, "agent")
  if (!fs.existsSync(agentDir)) return agents

  const templateVars = buildTemplateVars(theme)

  const walk = (dir: string, depth: number) => {
    if (depth > DISCOVERY_LIMITS.maxDepth) {
      if (!warned) {
        logWarn(`Skipping deep directories (max depth: ${DISCOVERY_LIMITS.maxDepth})`)
        warned = true
      }
      return
    }
    if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) {
      if (!warned) {
        logWarn(`Stopping discovery (max files: ${DISCOVERY_LIMITS.maxFiles})`)
        warned = true
      }
      return
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) break
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        try {
          const stats = fs.statSync(fullPath)
          if (stats.size > DISCOVERY_LIMITS.maxFileSize) {
            logWarn(`Skipping large file (${Math.round(stats.size / 1024)}KB): ${entry.name}`)
            continue
          }

          filesProcessed++
          const content = fs.readFileSync(fullPath, "utf-8")
          const parsed = parseAgentMarkdown(fullPath, content, agentDir, theme, templateVars)
          if (parsed) agents.push(parsed)
        } catch (err) {
          logError(`Failed to parse agent ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  walk(agentDir, 0)
  return agents
}

function parseAgentMarkdown(
  filePath: string,
  content: string,
  agentDir: string,
  theme: AgentNameTheme,
  templateVars: Record<string, string>,
): AgentInfo | null {
  let md: matter.GrayMatterFile<string>
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yamlEngine = require("gray-matter/lib/engines").yaml
    const disabledEngine = () => {
      throw new Error("JavaScript/CoffeeScript frontmatter is disabled")
    }
    md = matter(content, {
      language: "yaml",
      engines: {
        yaml: yamlEngine,
        javascript: disabledEngine,
        coffee: disabledEngine,
        json: JSON.parse.bind(JSON),
      },
    })
  } catch (err) {
    logError(`Failed to parse frontmatter in ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  if (!md.data || Object.keys(md.data).length === 0) return null

  const relativePath = path.relative(agentDir, filePath).replace(/\\/g, "/")
  const agentName = relativePath.replace(/\.md$/i, "")
  if (!/^[a-zA-Z0-9_/-]+$/.test(agentName)) {
    logWarn(`Skipping agent with invalid name characters: ${filePath}`)
    return null
  }

  const rawConfig = { ...md.data, prompt: md.content.trim() || undefined }
  const result = AgentConfigSchema.safeParse(rawConfig)
  if (!result.success) {
    logError(`Invalid agent config in ${filePath}: ${JSON.stringify(result.error.format())}`)
    return null
  }

  // Apply theme: remap canonical filename to themed name
  const themedName = resolveAgentName(agentName, theme)

  // Resolve template variables in the prompt (e.g. {{explorer}} → "legolas" with lotr theme)
  const resolvedConfig = { ...result.data }
  if (resolvedConfig.prompt) {
    resolvedConfig.prompt = resolveTemplateVars(resolvedConfig.prompt, templateVars)
  }

  return { name: themedName, path: filePath, config: resolvedConfig }
}

export async function discoverCommands(repoPath: string, theme: AgentNameTheme = "descriptive"): Promise<CommandInfo[]> {
  const commands: CommandInfo[] = []
  let filesProcessed = 0
  let warned = false

  const commandDir = path.join(repoPath, "command")
  if (!fs.existsSync(commandDir)) return commands

  const templateVars = buildTemplateVars(theme)

  const walk = (dir: string, depth: number) => {
    if (depth > DISCOVERY_LIMITS.maxDepth) {
      if (!warned) {
        logWarn(`Skipping deep directories (max depth: ${DISCOVERY_LIMITS.maxDepth})`)
        warned = true
      }
      return
    }
    if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) {
      if (!warned) {
        logWarn(`Stopping discovery (max files: ${DISCOVERY_LIMITS.maxFiles})`)
        warned = true
      }
      return
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) break
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        try {
          const stats = fs.statSync(fullPath)
          if (stats.size > DISCOVERY_LIMITS.maxFileSize) {
            logWarn(`Skipping large file (${Math.round(stats.size / 1024)}KB): ${entry.name}`)
            continue
          }

          filesProcessed++
          const content = fs.readFileSync(fullPath, "utf-8")
          const parsed = parseCommandMarkdown(fullPath, content, commandDir, templateVars)
          if (parsed) commands.push(parsed)
        } catch (err) {
          logError(`Failed to parse command ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  walk(commandDir, 0)
  return commands
}

function parseCommandMarkdown(
  filePath: string,
  content: string,
  commandDir: string,
  templateVars: Record<string, string>,
): CommandInfo | null {
  let md: matter.GrayMatterFile<string>
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yamlEngine = require("gray-matter/lib/engines").yaml
    const disabledEngine = () => {
      throw new Error("JavaScript/CoffeeScript frontmatter is disabled")
    }
    md = matter(content, {
      language: "yaml",
      engines: {
        yaml: yamlEngine,
        javascript: disabledEngine,
        coffee: disabledEngine,
        json: JSON.parse.bind(JSON),
      },
    })
  } catch (err) {
    logError(`Failed to parse frontmatter in ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  const relativePath = path.relative(commandDir, filePath).replace(/\\/g, "/")
  const commandName = relativePath.replace(/\.md$/i, "")
  if (!/^[a-zA-Z0-9_/-]+$/.test(commandName)) {
    logWarn(`Skipping command with invalid name characters: ${filePath}`)
    return null
  }

  const rawConfig = { ...md.data, template: (md.data as any).template || md.content.trim() || undefined }
  const result = CommandConfigSchema.safeParse(rawConfig)
  if (!result.success) {
    logError(`Invalid command config in ${filePath}: ${JSON.stringify(result.error.format())}`)
    return null
  }

  // Resolve template variables in the command template (e.g. {{explorer}} → "legolas" with lotr theme)
  const resolvedConfig = { ...result.data }
  if (resolvedConfig.template) {
    resolvedConfig.template = resolveTemplateVars(resolvedConfig.template, templateVars)
  }

  return { name: commandName, path: filePath, config: resolvedConfig }
}

export async function discoverPlugins(repoPath: string, repoShortName: string): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = []
  let filesProcessed = 0
  let warned = false

  const pluginDir = path.join(repoPath, "plugin")
  if (!fs.existsSync(pluginDir)) return plugins

  const walk = (dir: string, depth: number) => {
    if (depth > DISCOVERY_LIMITS.maxDepth) {
      if (!warned) {
        logWarn(`Skipping deep directories (max depth: ${DISCOVERY_LIMITS.maxDepth})`)
        warned = true
      }
      return
    }
    if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) {
      if (!warned) {
        logWarn(`Stopping discovery (max files: ${DISCOVERY_LIMITS.maxFiles})`)
        warned = true
      }
      return
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.name.toLowerCase().endsWith(".ts") || entry.name.toLowerCase().endsWith(".js")) {
        try {
          const stats = fs.statSync(fullPath)
          if (stats.size > DISCOVERY_LIMITS.maxFileSize) {
            logWarn(`Skipping large file (${Math.round(stats.size / 1024)}KB): ${entry.name}`)
            continue
          }
          filesProcessed++
          const relativePath = path.relative(pluginDir, fullPath).replace(/\\/g, "/")
          const ext = path.extname(relativePath)
          const pluginName = relativePath.slice(0, -ext.length).replace(/\//g, "-")
          if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
            logWarn(`Skipping plugin with invalid name characters: ${fullPath}`)
            continue
          }
          plugins.push({ name: pluginName, path: fullPath, repoShortName, extension: ext })
        } catch (err) {
          logError(`Failed to process plugin ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  walk(pluginDir, 0)
  return plugins
}

export async function discoverMcps(repoPath: string): Promise<McpInfo[]> {
  const mcps: McpInfo[] = []
  let filesProcessed = 0
  let warned = false

  const mcpDir = path.join(repoPath, "mcp")
  if (!fs.existsSync(mcpDir)) return mcps

  const walk = (dir: string, depth: number) => {
    if (depth > DISCOVERY_LIMITS.maxDepth) {
      if (!warned) {
        logWarn(`Skipping deep directories (max depth: ${DISCOVERY_LIMITS.maxDepth})`)
        warned = true
      }
      return
    }
    if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) {
      if (!warned) {
        logWarn(`Stopping discovery (max files: ${DISCOVERY_LIMITS.maxFiles})`)
        warned = true
      }
      return
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (filesProcessed >= DISCOVERY_LIMITS.maxFiles) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
        continue
      }

      if (!entry.name.toLowerCase().endsWith(".json")) {
        continue
      }

      try {
        const stats = fs.statSync(fullPath)
        if (stats.size > DISCOVERY_LIMITS.maxFileSize) {
          logWarn(`Skipping large file (${Math.round(stats.size / 1024)}KB): ${entry.name}`)
          continue
        }
        filesProcessed++
        const relativePath = path.relative(mcpDir, fullPath).replace(/\\/g, "/")
        const name =
          entry.name === "mcp.json"
            ? path.basename(path.dirname(fullPath))
            : relativePath.replace(/\.json$/i, "")
        mcps.push({ name, path: fullPath, relativePath })
      } catch (err) {
        logError(`Failed to process mcp ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  walk(mcpDir, 0)
  return mcps
}
