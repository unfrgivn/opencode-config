import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import type { PluginInfo } from "./plugin-info"
import type { InstallMethod } from "./install"

/** Default directory where OpenCode looks for plugins */
const PLUGIN_DIR_PLURAL = path.join(homedir(), ".config", "opencode", "plugins")
const PLUGIN_DIR_SINGULAR = path.join(homedir(), ".config", "opencode", "plugin")

/** Prefix for remote plugin symlinks */
const REMOTE_PREFIX = "_remote_"

type PluginDirInput = string | string[] | undefined

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

export function getPluginDir(): string {
  try {
    if (fs.existsSync(PLUGIN_DIR_SINGULAR) && !fs.existsSync(PLUGIN_DIR_PLURAL)) {
      return PLUGIN_DIR_SINGULAR
    }
  } catch {
  }
  return PLUGIN_DIR_PLURAL
}

const DEFAULT_PLUGIN_DIR = getPluginDir()

function getPluginDirsForRead(pluginDir?: PluginDirInput): string[] {
  if (Array.isArray(pluginDir)) {
    return [...new Set(pluginDir)]
  }

  if (typeof pluginDir === "string") {
    return [pluginDir]
  }

  const existingDirs = [PLUGIN_DIR_SINGULAR, PLUGIN_DIR_PLURAL].filter((dir) => fs.existsSync(dir))
  if (existingDirs.length > 0) {
    return existingDirs
  }

  return [getPluginDir()]
}

function getRemotePluginInstallsInDir(pluginDir: string): string[] {
  if (!fs.existsSync(pluginDir)) {
    return []
  }

  try {
    const entries = fs.readdirSync(pluginDir)
    return entries.filter((name) => name.startsWith(REMOTE_PREFIX))
  } catch {
    return []
  }
}

function getRemotePluginInstallsForRepoInDir(repoShortName: string, pluginDir: string): string[] {
  const prefix = getRemotePrefixForRepo(repoShortName)
  if (!fs.existsSync(pluginDir)) {
    return []
  }

  try {
    const entries = fs.readdirSync(pluginDir)
    return entries.filter((name) => name.startsWith(prefix))
  } catch {
    return []
  }
}

function getRemotePrefixForRepo(repoShortName: string): string {
  return `${REMOTE_PREFIX}${repoShortName}_`
}

/**
 * Result of installing a plugin (symlink or copy)
 */
export interface PluginInstallResult {
  pluginName: string
  symlinkName: string
  symlinkPath: string
  targetPath: string
  error?: string
}

/**
 * @deprecated Use PluginInstallResult instead
 */
export type PluginSymlinkResult = PluginInstallResult

/**
 * Result of cleaning up plugin installs
 */
export interface PluginCleanupResult {
  removed: string[]
  errors: string[]
}

/**
 * Get the symlink name for a plugin.
 * Format: _remote_<repo>_<plugin-name>.<ext>
 * 
 * @example
 * getPluginSymlinkName({ name: "notify", repoShortName: "my-hooks", extension: ".ts" })
 * // Returns: "_remote_my-hooks_notify.ts"
 */
export function getPluginSymlinkName(plugin: PluginInfo): string {
  return `${REMOTE_PREFIX}${plugin.repoShortName}_${plugin.name}${plugin.extension}`
}

export function ensurePluginDir(pluginDir: string = DEFAULT_PLUGIN_DIR): void {
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true })
  }
}

export function createPluginInstall(
  plugin: PluginInfo,
  pluginDir: string = getPluginDir(),
  installMethod: InstallMethod = "link"
): PluginInstallResult {
  const symlinkName = getPluginSymlinkName(plugin)
  const symlinkPath = path.join(pluginDir, symlinkName)
  
  const result: PluginInstallResult = {
    pluginName: plugin.name,
    symlinkName,
    symlinkPath,
    targetPath: plugin.path,
  }
  
  try {
    ensurePluginDir(pluginDir)
    
    // Remove existing (works for both symlink and regular file)
    removePathIfExists(symlinkPath)
    
    if (installMethod === "copy") {
      // For plugin files, copy the single file (not directory)
      fs.cpSync(plugin.path, symlinkPath)
    } else {
      // Create symlink
      fs.symlinkSync(plugin.path, symlinkPath)
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  
  return result
}

/**
 * @deprecated Use createPluginInstall instead
 */
export function createPluginSymlink(
  plugin: PluginInfo,
  pluginDir: string = getPluginDir()
): PluginInstallResult {
  const symlinkName = getPluginSymlinkName(plugin)
  const symlinkPath = path.join(pluginDir, symlinkName)
  
  const result: PluginInstallResult = {
    pluginName: plugin.name,
    symlinkName,
    symlinkPath,
    targetPath: plugin.path,
  }
  
  try {
    ensurePluginDir(pluginDir)
    
    // Remove existing (works for symlink, file, or directory)
    removePathIfExists(symlinkPath)
    
    // Create symlink
    fs.symlinkSync(plugin.path, symlinkPath)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  
  return result
}

export function createPluginInstalls(
  plugins: PluginInfo[],
  pluginDir: string = getPluginDir(),
  installMethod: InstallMethod = "link"
): PluginInstallResult[] {
  return plugins.map(plugin => createPluginInstall(plugin, pluginDir, installMethod))
}

/**
 * @deprecated Use createPluginInstalls instead
 */
export function createPluginSymlinks(
  plugins: PluginInfo[],
  pluginDir: string = getPluginDir()
): PluginInstallResult[] {
  return plugins.map(p => createPluginSymlink(p, pluginDir))
}

export function getRemotePluginInstalls(pluginDir?: string | string[]): string[] {
  const pluginDirs = getPluginDirsForRead(pluginDir)
  const installs = new Set<string>()

  for (const dir of pluginDirs) {
    const entries = getRemotePluginInstallsInDir(dir)
    for (const entry of entries) {
      installs.add(entry)
    }
  }

  return [...installs]
}

export function getRemotePluginInstallsForRepo(
  repoShortName: string,
  pluginDir?: string | string[]
): string[] {
  const pluginDirs = getPluginDirsForRead(pluginDir)
  const installs = new Set<string>()

  for (const dir of pluginDirs) {
    const entries = getRemotePluginInstallsForRepoInDir(repoShortName, dir)
    for (const entry of entries) {
      installs.add(entry)
    }
  }

  return [...installs]
}

/**
 * @deprecated Use getRemotePluginInstalls instead
 */
export function getRemotePluginSymlinks(pluginDir: string = DEFAULT_PLUGIN_DIR): string[] {
  return getRemotePluginInstalls(pluginDir)
}

export function cleanupStalePluginInstalls(
  currentInstalls: Set<string>,
  pluginDir?: string | string[]
): PluginCleanupResult {
  const result: PluginCleanupResult = {
    removed: [],
    errors: [],
  }

  const pluginDirs = getPluginDirsForRead(pluginDir)
  const removed = new Set<string>()

  for (const dir of pluginDirs) {
    const existing = getRemotePluginInstallsInDir(dir)

    for (const name of existing) {
      if (!currentInstalls.has(name)) {
        const installPath = path.join(dir, name)
        try {
          removePathIfExists(installPath)
          removed.add(name)
        } catch (err) {
          result.errors.push(`Failed to remove ${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  result.removed = [...removed]
  return result
}

export function cleanupStalePluginInstallsForRepo(
  repoShortName: string,
  currentInstalls: Set<string>,
  pluginDir?: string | string[]
): PluginCleanupResult {
  const result: PluginCleanupResult = {
    removed: [],
    errors: [],
  }

  const pluginDirs = getPluginDirsForRead(pluginDir)
  const removed = new Set<string>()

  for (const dir of pluginDirs) {
    const existing = getRemotePluginInstallsForRepoInDir(repoShortName, dir)

    for (const name of existing) {
      if (!currentInstalls.has(name)) {
        const installPath = path.join(dir, name)
        try {
          removePathIfExists(installPath)
          removed.add(name)
        } catch (err) {
          result.errors.push(`Failed to remove ${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  result.removed = [...removed]
  return result
}

/**
 * @deprecated Use cleanupStalePluginInstalls instead
 */
export function cleanupStalePluginSymlinks(
  currentSymlinks: Set<string>,
  pluginDir: string = DEFAULT_PLUGIN_DIR
): PluginCleanupResult {
  return cleanupStalePluginInstalls(currentSymlinks, pluginDir)
}

export function getPluginInstallPath(
  installName: string,
  pluginDir: string = getPluginDir()
): string {
  return path.join(pluginDir, installName)
}

/**
 * @deprecated Use getPluginInstallPath instead
 */
export function getPluginSymlinkPath(
  symlinkName: string,
  pluginDir: string = DEFAULT_PLUGIN_DIR
): string {
  return getPluginInstallPath(symlinkName, pluginDir)
}

/**
 * Check if a name is a remote plugin install
 */
export function isRemotePluginInstall(name: string): boolean {
  return name.startsWith(REMOTE_PREFIX)
}

export interface BrokenUnmanagedPluginLink {
  name: string
  path: string
  targetPath: string
}

export function findBrokenUnmanagedPluginLinks(pluginDir?: string | string[]): BrokenUnmanagedPluginLink[] {
  const pluginDirs = getPluginDirsForRead(pluginDir)
  const brokenLinks: BrokenUnmanagedPluginLink[] = []

  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) {
      continue
    }

    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const name of entries) {
      if (isRemotePluginInstall(name)) {
        continue
      }

      const linkPath = path.join(dir, name)
      let stats: fs.Stats
      try {
        stats = fs.lstatSync(linkPath)
      } catch {
        continue
      }

      if (!stats.isSymbolicLink()) {
        continue
      }

      let targetPath = ""
      try {
        targetPath = fs.readlinkSync(linkPath)
      } catch {
        continue
      }

      const resolvedTargetPath = path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(dir, targetPath)

      if (!fs.existsSync(resolvedTargetPath)) {
        brokenLinks.push({
          name,
          path: linkPath,
          targetPath: resolvedTargetPath,
        })
      }
    }
  }

  return brokenLinks
}

/**
 * @deprecated Use isRemotePluginInstall instead
 */
export function isRemotePluginSymlink(name: string): boolean {
  return isRemotePluginInstall(name)
}
