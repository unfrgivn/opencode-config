import * as fs from "fs"
import * as path from "path"
import { opencodeConfigDir } from "./paths"
import type { McpInfo } from "./assets"
import type { InstallMethod } from "./install"

export const DEFAULT_MCP_DIR = path.join(opencodeConfigDir(), "mcp")

export const MCP_PLUGINS_SUBDIR = "_plugins/fellowship"

function getMcpPluginsSubdirForRepo(repoShortName: string): string {
  return path.join("_plugins", repoShortName)
}

function resolveMcpSourcePath(mcp: McpInfo): string {
  return mcp.path.endsWith(".json") ? mcp.path : path.join(mcp.path, "mcp.json")
}

/**
 * Result of installing an MCP config (symlink or copy)
 */
export interface McpInstallResult {
  mcpName: string
  sourcePath: string
  targetPath: string
  created: boolean
  error?: string
}

/**
 * Result of cleaning up MCP installs
 */
export interface McpCleanupResult {
  removed: string[]
  errors: string[]
}

/**
 * Remove a path if it exists, handling files, symlinks, and directories.
 * Silently ignores ENOENT (path doesn't exist).
 * @param targetPath Path to remove
 * @throws Re-throws any error except ENOENT
 */
function removePathIfExists(targetPath: string): void {
  try {
    const stats = fs.lstatSync(targetPath)
    if (stats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true })
    } else {
      fs.unlinkSync(targetPath)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
}

export function ensureMcpPluginsDir(mcpDir: string = DEFAULT_MCP_DIR): string {
  const pluginsDir = path.join(mcpDir, MCP_PLUGINS_SUBDIR)
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true })
  }
  return pluginsDir
}

export function ensureMcpPluginsDirForRepo(
  repoShortName: string,
  mcpDir: string = DEFAULT_MCP_DIR
): string {
  const pluginsDir = path.join(mcpDir, getMcpPluginsSubdirForRepo(repoShortName))
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true })
  }
  return pluginsDir
}

export function createMcpInstall(
  mcp: McpInfo,
  mcpDir: string = DEFAULT_MCP_DIR,
  installMethod: InstallMethod = "link"
): McpInstallResult {
  const pluginsDir = ensureMcpPluginsDir(mcpDir)
  const targetPath = path.join(pluginsDir, mcp.relativePath)
  
  const sourcePath = resolveMcpSourcePath(mcp)

  const result: McpInstallResult = {
    mcpName: mcp.name,
    sourcePath,
    targetPath,
    created: false,
  }
  
  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    
    // Remove existing (works for both symlink and regular file)
    removePathIfExists(targetPath)
    
    if (installMethod === "copy") {
      // For MCP files, copy the single file (not directory)
      fs.cpSync(sourcePath, targetPath)
    } else {
      // Create symlink
      fs.symlinkSync(sourcePath, targetPath)
    }
    
    result.created = true
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  
  return result
}

export function createMcpInstallForRepo(
  repoShortName: string,
  mcp: McpInfo,
  mcpDir: string = DEFAULT_MCP_DIR,
  installMethod: InstallMethod = "link"
): McpInstallResult {
  const pluginsDir = ensureMcpPluginsDirForRepo(repoShortName, mcpDir)
  const targetPath = path.join(pluginsDir, mcp.relativePath)

  const sourcePath = resolveMcpSourcePath(mcp)

  const result: McpInstallResult = {
    mcpName: mcp.name,
    sourcePath,
    targetPath,
    created: false,
  }

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    removePathIfExists(targetPath)

    if (installMethod === "copy") {
      fs.cpSync(sourcePath, targetPath)
    } else {
      fs.symlinkSync(sourcePath, targetPath)
    }

    result.created = true
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

export function createMcpInstalls(
  mcps: McpInfo[],
  mcpDir: string = DEFAULT_MCP_DIR,
  installMethod: InstallMethod = "link"
): McpInstallResult[] {
  return mcps.map(mcp => createMcpInstall(mcp, mcpDir, installMethod))
}

export function createMcpInstallsForRepo(
  repoShortName: string,
  mcps: McpInfo[],
  mcpDir: string = DEFAULT_MCP_DIR,
  installMethod: InstallMethod = "link"
): McpInstallResult[] {
  return mcps.map((mcp) => createMcpInstallForRepo(repoShortName, mcp, mcpDir, installMethod))
}

export function getExistingMcpInstalls(mcpDir: string = DEFAULT_MCP_DIR): Set<string> {
  const pluginsDir = path.join(mcpDir, MCP_PLUGINS_SUBDIR)
  const installs = new Set<string>()
  
  if (!fs.existsSync(pluginsDir)) {
    return installs
  }
  
  try {
    const scanDir = (dir: string, prefix: string = ""): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        
        const fullPath = path.join(dir, entry.name)
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        
        if (entry.isDirectory()) {
          scanDir(fullPath, relativePath)
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          installs.add(relativePath)
        }
      }
    }
    
    scanDir(pluginsDir)
  } catch {
    // Silently ignore errors reading directory
  }
  
  return installs
}

export function getExistingMcpInstallsForRepo(
  repoShortName: string,
  mcpDir: string = DEFAULT_MCP_DIR
): Set<string> {
  const pluginsDir = path.join(mcpDir, getMcpPluginsSubdirForRepo(repoShortName))
  const installs = new Set<string>()

  if (!fs.existsSync(pluginsDir)) {
    return installs
  }

  try {
    const scanDir = (dir: string, prefix: string = ""): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue

        const fullPath = path.join(dir, entry.name)
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          scanDir(fullPath, relativePath)
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          installs.add(relativePath)
        }
      }
    }

    scanDir(pluginsDir)
  } catch {
  }

  return installs
}

export function cleanupStaleMcpInstalls(
  currentInstalls: Set<string>,
  mcpDir: string = DEFAULT_MCP_DIR
): McpCleanupResult {
  const result: McpCleanupResult = {
    removed: [],
    errors: [],
  }
  
  const pluginsDir = path.join(mcpDir, MCP_PLUGINS_SUBDIR)
  const existing = getExistingMcpInstalls(mcpDir)
  
  for (const relativePath of existing) {
    if (!currentInstalls.has(relativePath)) {
      const fullPath = path.join(pluginsDir, relativePath)
      
      try {
        removePathIfExists(fullPath)
        result.removed.push(relativePath)
        
        // Try to remove empty parent directories
        let parentDir = path.dirname(fullPath)
        while (parentDir !== pluginsDir && parentDir.startsWith(pluginsDir)) {
          try {
            const entries = fs.readdirSync(parentDir)
            if (entries.length === 0) {
              fs.rmdirSync(parentDir)
              parentDir = path.dirname(parentDir)
            } else {
              break
            }
          } catch {
            break
          }
        }
      } catch (err) {
        result.errors.push(
          `Failed to remove ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }
  
  return result
}

export function cleanupStaleMcpInstallsForRepo(
  repoShortName: string,
  currentInstalls: Set<string>,
  mcpDir: string = DEFAULT_MCP_DIR
): McpCleanupResult {
  const result: McpCleanupResult = {
    removed: [],
    errors: [],
  }

  const pluginsDir = path.join(mcpDir, getMcpPluginsSubdirForRepo(repoShortName))
  const existing = getExistingMcpInstallsForRepo(repoShortName, mcpDir)

  for (const relativePath of existing) {
    if (!currentInstalls.has(relativePath)) {
      const fullPath = path.join(pluginsDir, relativePath)

      try {
        removePathIfExists(fullPath)
        result.removed.push(relativePath)

        let parentDir = path.dirname(fullPath)
        while (parentDir !== pluginsDir && parentDir.startsWith(pluginsDir)) {
          try {
            const entries = fs.readdirSync(parentDir)
            if (entries.length === 0) {
              fs.rmdirSync(parentDir)
              parentDir = path.dirname(parentDir)
            } else {
              break
            }
          } catch {
            break
          }
        }
      } catch (err) {
        result.errors.push(
          `Failed to remove ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return result
}
