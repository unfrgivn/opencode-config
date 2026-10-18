import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"
import { execFile } from "node:child_process"
import type { SkillInfo, DiscoveryResult } from "./assets"
import { syncDirectory } from "./copy"
import { logDebug, logError, logWarn } from "./logging"
import { opencodeConfigDir } from "./paths"

/** How to install skills: symlink or copy */
export type InstallMethod = "link" | "copy"

/** Base directory for OpenCode config */
const CONFIG_BASE = opencodeConfigDir()

/** Base directory for OpenCode skills */
const SKILL_BASE = path.join(CONFIG_BASE, "skill")

/** Directory for plugin-managed skills */
const PLUGINS_DIR = path.join(SKILL_BASE, "_plugins")

/** Directory for materialized schemas */
const SCHEMAS_DIR = path.join(CONFIG_BASE, "schemas")

/**
 * Information about an install operation (symlink or copy)
 */
export interface InstallResult {
  skillName: string
  sourcePath: string
  targetPath: string
  created: boolean
  staged: boolean
  dirty: boolean
  stagedPath?: string
  error?: string
}

/**
 * @deprecated Use InstallResult instead
 */
export type SymlinkResult = InstallResult

/**
 * Information about cleaning up stale symlinks
 */
export interface CleanupResult {
  removed: string[]
  errors: string[]
}

export interface RepoCleanupResult extends CleanupResult {
  repoShortName: string
}

export interface SkillInstallMetadata {
  version: 1
  skillName: string
  sourceHash: string
  installedHash: string
  installedAt: string
}

export interface SkillCopyState {
  sourceHash: string
  targetHash: string | null
  pristine: boolean
  metadata: SkillInstallMetadata | null
}

const SKILL_METADATA_FILENAME = ".fellowship-skill-install.json"

/**
 * Get the path where a skill should be installed
 */
export function getInstallPath(repoShortName: string, skillName: string, pluginsDir: string = PLUGINS_DIR): string {
  return path.join(pluginsDir, repoShortName, skillName)
}

export function getRepoInstallRoot(repoShortName: string, pluginsDir: string = PLUGINS_DIR): string {
  return path.join(pluginsDir, repoShortName)
}

export function getStagedSkillUpdatePath(
  repoShortName: string,
  skillName: string,
  pluginsDir: string = PLUGINS_DIR,
): string {
  return path.join(getRepoInstallRoot(repoShortName, pluginsDir), ".updates", skillName)
}

export function getSkillMetadataPath(targetPath: string): string {
  return path.join(targetPath, SKILL_METADATA_FILENAME)
}

/**
 * @deprecated Use getInstallPath instead
 */
export const getSymlinkPath = getInstallPath

/**
 * Ensure the _plugins directory structure exists
 */
export function ensurePluginsDir(): void {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true })
}

/**
 * Internal helper: create a symlink for a skill (sync).
 * Used by both createSkillInstall (for link mode) and deprecated createSkillSymlink.
 */
function createSymlinkSync(
  sourcePath: string,
  targetPath: string
): { created: boolean; error?: string } {
  // Check if symlink already exists
  if (fs.existsSync(targetPath)) {
    const stats = fs.lstatSync(targetPath)
    
    if (stats.isSymbolicLink()) {
      const existingTarget = fs.readlinkSync(targetPath)
      
      // If pointing to same location, nothing to do
      if (existingTarget === sourcePath) {
        return { created: false }
      }
      
      // Remove old symlink pointing to different location
      fs.unlinkSync(targetPath)
    } else if (stats.isDirectory()) {
      const copyState = getSkillCopyState(sourcePath, targetPath)
      if (!copyState.pristine) {
        return { created: false, error: `Path exists and has local edits: ${targetPath}` }
      }
      fs.rmSync(targetPath, { recursive: true, force: true })
    } else {
      return { created: false, error: `Path exists and is not a symlink: ${targetPath}` }
    }
  }
  
  // Create the symlink
  fs.symlinkSync(sourcePath, targetPath, "dir")
  return { created: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readSkillMetadata(targetPath: string): SkillInstallMetadata | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(getSkillMetadataPath(targetPath), "utf-8"))
    if (!isRecord(parsed)) return null
    if (parsed.version !== 1) return null
    if (typeof parsed.skillName !== "string") return null
    if (typeof parsed.sourceHash !== "string") return null
    if (typeof parsed.installedHash !== "string") return null
    if (typeof parsed.installedAt !== "string") return null

    return {
      version: 1,
      skillName: parsed.skillName,
      sourceHash: parsed.sourceHash,
      installedHash: parsed.installedHash,
      installedAt: parsed.installedAt,
    }
  } catch {
    return null
  }
}

function writeSkillMetadata(targetPath: string, metadata: SkillInstallMetadata): void {
  fs.writeFileSync(getSkillMetadataPath(targetPath), `${JSON.stringify(metadata, null, 2)}\n`)
}

function hashDirectory(dirPath: string): string {
  const hash = crypto.createHash("sha256")

  const walk = (currentPath: string, relativePrefix: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      .filter(entry => entry.name !== SKILL_METADATA_FILENAME)
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      hash.update(relativePath)

      if (entry.isSymbolicLink()) {
        hash.update("symlink")
        hash.update(fs.readlinkSync(fullPath))
      } else if (entry.isDirectory()) {
        hash.update("dir")
        walk(fullPath, relativePath)
      } else if (entry.isFile()) {
        hash.update("file")
        hash.update(fs.readFileSync(fullPath))
      }
    }
  }

  walk(dirPath, "")
  return hash.digest("hex")
}

export function getSkillCopyState(sourcePath: string, targetPath: string): SkillCopyState {
  const sourceHash = hashDirectory(sourcePath)
  if (!fs.existsSync(targetPath)) {
    return { sourceHash, targetHash: null, pristine: true, metadata: null }
  }

  const stats = fs.lstatSync(targetPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return { sourceHash, targetHash: null, pristine: true, metadata: null }
  }

  const targetHash = hashDirectory(targetPath)
  const metadata = readSkillMetadata(targetPath)
  const pristine = metadata !== null
    ? targetHash === metadata.installedHash
    : targetHash === sourceHash

  return { sourceHash, targetHash, pristine, metadata }
}

function createMetadata(skillName: string, sourceHash: string): SkillInstallMetadata {
  return {
    version: 1,
    skillName,
    sourceHash,
    installedHash: sourceHash,
    installedAt: new Date().toISOString(),
  }
}

/**
 * Install a skill (symlink or copy)
 * 
 * @param skill The skill to install
 * @param repoShortName The short name of the repository
 * @param installMethod How to install: "link" (symlink) or "copy" (file copy)
 * @returns Result of the install operation
 */
export async function createSkillInstall(
  skill: SkillInfo,
  repoShortName: string,
  installMethod: InstallMethod = "link",
  pluginsDir: string = PLUGINS_DIR,
): Promise<InstallResult> {
  const targetPath = getInstallPath(repoShortName, skill.name, pluginsDir)
  const result: InstallResult = {
    skillName: skill.name,
    sourcePath: skill.path,
    targetPath,
    created: false,
    staged: false,
    dirty: false,
  }
  
  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    
    if (installMethod === "copy") {
      // Copy mode: clean up any existing symlink or file before syncing
      if (fs.existsSync(targetPath)) {
        const stats = fs.lstatSync(targetPath)
        if (stats.isSymbolicLink() || stats.isFile()) {
          fs.unlinkSync(targetPath)
        }
      }

      const copyState = getSkillCopyState(skill.path, targetPath)
      if (!copyState.pristine) {
        const stagedPath = getStagedSkillUpdatePath(repoShortName, skill.name, pluginsDir)
        await syncDirectory(skill.path, stagedPath)
        writeSkillMetadata(stagedPath, createMetadata(skill.name, copyState.sourceHash))

        result.staged = true
        result.dirty = true
        result.stagedPath = stagedPath
        return result
      }

      // Always sync to ensure content is up-to-date (handles both fresh installs
      // and re-syncs when the source package has been updated to a new version)
      await syncDirectory(skill.path, targetPath)
      writeSkillMetadata(targetPath, createMetadata(skill.name, copyState.sourceHash))
      result.created = true
    } else {
      // Link mode: delegate to shared helper
      const symlinkResult = createSymlinkSync(skill.path, targetPath)
      result.created = symlinkResult.created
      if (symlinkResult.error) {
        result.error = symlinkResult.error
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  
  return result
}

/**
 * @deprecated Use createSkillInstall instead
 */
export function createSkillSymlink(
  skill: SkillInfo,
  repoShortName: string
): InstallResult {
  const targetPath = getInstallPath(repoShortName, skill.name)
  const result: InstallResult = {
    skillName: skill.name,
    sourcePath: skill.path,
    targetPath,
    created: false,
    staged: false,
    dirty: false,
  }
  
  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    
    // Delegate to shared helper
    const symlinkResult = createSymlinkSync(skill.path, targetPath)
    result.created = symlinkResult.created
    if (symlinkResult.error) {
      result.error = symlinkResult.error
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  
  return result
}

/**
 * Install all skills from a sync result
 * 
 * @param syncResult The sync result containing skills to install
 * @param installMethod How to install: "link" (symlink) or "copy" (file copy)
 * @returns Results of all install operations
 */
export async function createInstallsForRepo(
  syncResult: DiscoveryResult,
  installMethod: InstallMethod = "link",
  pluginsDir: string = PLUGINS_DIR,
): Promise<InstallResult[]> {
  fs.mkdirSync(pluginsDir, { recursive: true })
  
  const results: InstallResult[] = []
  
  for (const skill of syncResult.skills) {
    const result = await createSkillInstall(skill, syncResult.shortName, installMethod, pluginsDir)
    results.push(result)
  }
  
  return results
}

/**
 * @deprecated Use createInstallsForRepo instead
 */
export function createSymlinksForRepo(syncResult: DiscoveryResult): InstallResult[] {
  ensurePluginsDir()
  
  const results: InstallResult[] = []
  
  for (const skill of syncResult.skills) {
    const result = createSkillSymlink(skill, syncResult.shortName)
    results.push(result)
  }
  
  return results
}

/**
 * Get all existing installed skills in the _plugins directory
 * Returns both symlinks and copied directories (detects SKILL.md files)
 */
export function getExistingInstalls(): Map<string, string> {
  return getExistingInstallsForRepo(null)
}

export function getExistingInstallsForRepo(repoShortName: string | null): Map<string, string> {
  const installs = new Map<string, string>()

  if (!fs.existsSync(PLUGINS_DIR)) {
    return installs
  }

  const repoDirs = repoShortName ? [repoShortName] : fs.readdirSync(PLUGINS_DIR)
  for (const repoDirName of repoDirs) {
    if (!repoDirName || repoDirName.startsWith(".")) continue
    const repoPath = path.join(PLUGINS_DIR, repoDirName)
    try {
      const repoStats = fs.lstatSync(repoPath)
      if (!repoStats.isDirectory() || repoStats.isSymbolicLink()) continue
    } catch {
      continue
    }

    const skillEntries = fs.readdirSync(repoPath, { withFileTypes: true })
    for (const skillEntry of skillEntries) {
      if (skillEntry.name.startsWith(".")) continue

      const fullPath = path.join(repoPath, skillEntry.name)
      const relativePath = `${repoDirName}/${skillEntry.name}`

      if (skillEntry.isSymbolicLink()) {
        const target = fs.readlinkSync(fullPath)
        installs.set(relativePath, target)
      } else if (skillEntry.isDirectory()) {
        installs.set(relativePath, fullPath)
      }
    }
  }

  return installs
}

/**
 * @deprecated Use getExistingInstalls instead
 */
export function getExistingSymlinks(): Map<string, string> {
  const symlinks = new Map<string, string>()
  
  if (!fs.existsSync(PLUGINS_DIR)) {
    return symlinks
  }
  
  const scanDir = (dir: string, prefix: string = "") => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      
      const fullPath = path.join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(fullPath)
        symlinks.set(relativePath, target)
      } else if (entry.isDirectory()) {
        scanDir(fullPath, relativePath)
      }
    }
  }
  
  scanDir(PLUGINS_DIR)
  return symlinks
}

/**
 * Remove installed skills that are no longer needed
 * Works for both symlinks and copied directories
 * 
 * @param currentSkills Set of skill paths that should exist (format: "repo/skill")
 * @returns Cleanup result
 */
export function cleanupStaleInstalls(currentSkills: Set<string>): CleanupResult {
  return cleanupStaleInstallsForRepo(null, currentSkills)
}

export function cleanupStaleInstallsForRepo(
  repoShortName: string | null,
  currentSkills: Set<string>
): RepoCleanupResult {
  const scopedRepo = repoShortName ?? "*"
  const result: RepoCleanupResult = {
    repoShortName: scopedRepo,
    removed: [],
    errors: [],
  }

  const existingInstalls = getExistingInstallsForRepo(repoShortName)
  for (const [relativePath] of existingInstalls) {
    if (currentSkills.has(relativePath)) continue

    const fullPath = path.join(PLUGINS_DIR, relativePath)
    try {
      const stats = fs.lstatSync(fullPath)
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(fullPath)
      } else if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(fullPath)
      }

      result.removed.push(relativePath)

      let parentDir = path.dirname(fullPath)
      const repoRoot = repoShortName ? getRepoInstallRoot(repoShortName) : PLUGINS_DIR
      while (parentDir !== repoRoot && parentDir.startsWith(repoRoot)) {
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

  return result
}

/**
 * @deprecated Use cleanupStaleInstalls instead
 */
export const cleanupStaleSymlinks = cleanupStaleInstalls

/**
 * Check if a skill name conflicts with a local (non-plugin) skill
 * 
 * @param skillName The skill name to check
 * @returns True if there's a conflict
 */
export function hasLocalConflict(skillName: string): boolean {
  const localSkillPath = path.join(SKILL_BASE, skillName)
  
  // Check if the path exists and is NOT inside _plugins
  if (fs.existsSync(localSkillPath)) {
    const realPath = fs.realpathSync(localSkillPath)
    return !realPath.includes("_plugins")
  }
  
  return false
}

/**
 * Get the base skill directory path
 */
export function getSkillBasePath(): string {
  return SKILL_BASE
}

/**
 * Get the plugins directory path
 */
export function getPluginsPath(): string {
  return PLUGINS_DIR
}

/**
 * Find the git root for a given path
 * 
 * @param startPath The path to start searching from
 * @returns The git root path, or null if not in a git repo
 */
export async function findGitRoot(startPath: string): Promise<string | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-C", startPath, "rev-parse", "--show-toplevel"], (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      })
    })
    return stdout.trim()
  } catch {
    // Not in a git repo
  }
  return null
}

/**
 * Ensure _plugins/ is in .gitignore at the git root
 * 
 * This prevents accidentally committing imported skills to version control.
 * Only modifies .gitignore if the skill directory is inside a git repository.
 * 
 * @returns Object indicating whether .gitignore was modified
 */
export async function ensureGitignore(): Promise<{ modified: boolean; gitRoot: string | null }> {
  const gitRoot = await findGitRoot(SKILL_BASE)
  
  if (!gitRoot) {
    // Not in a git repo, nothing to do
    return { modified: false, gitRoot: null }
  }
  
  const gitignorePath = path.join(gitRoot, ".gitignore")
  const pluginsEntry = "_plugins/"
  
  // Calculate relative path from git root to _plugins
  const relativePath = path.relative(gitRoot, PLUGINS_DIR)
  const gitignoreEntry = relativePath ? `${relativePath}/` : pluginsEntry
  
  let content = ""
  let exists = false
  
  try {
    content = fs.readFileSync(gitignorePath, "utf-8")
    exists = true
  } catch {
    // .gitignore doesn't exist
  }
  
  // Check if already in .gitignore
  const lines = content.split("\n")
  const alreadyIgnored = lines.some(line => {
    const trimmed = line.trim()
    return trimmed === gitignoreEntry || 
           trimmed === pluginsEntry ||
           trimmed === "_plugins" ||
           trimmed === relativePath
  })
  
  if (alreadyIgnored) {
    return { modified: false, gitRoot }
  }
  
  // Add to .gitignore
  const newContent = exists
    ? content.endsWith("\n")
      ? `${content}# OpenCode remote skills plugin\n${gitignoreEntry}\n`
      : `${content}\n\n# OpenCode remote skills plugin\n${gitignoreEntry}\n`
    : `# OpenCode remote skills plugin\n${gitignoreEntry}\n`
  
  fs.writeFileSync(gitignorePath, newContent)
  
  return { modified: true, gitRoot }
}

/**
 * Result of a schema materialization operation.
 */
export interface MaterializeSchemaResult {
  /** Whether the schema file was written (created or updated) */
  written: boolean
  /** Target path where the schema was placed */
  targetPath: string
  /** Error message if the operation failed */
  error?: string
}

/**
 * Materialize `fellowship.schema.json` from the package root into the user's
 * OpenCode config directory (`~/.config/opencode/schemas/fellowship.schema.json`).
 *
 * This ensures IDEs can resolve `"$schema": "./schemas/fellowship.schema.json"`
 * from `fellowship.json` without needing access to the source repo or knowing
 * where the npm package is cached.
 *
 * The file is only written when the source is newer or the target is missing,
 * keeping the operation cheap on repeated startups.
 */
export function materializeSchema(packageRoot: string, schemasDir: string = SCHEMAS_DIR): MaterializeSchemaResult {
  const sourcePath = path.join(packageRoot, "fellowship.schema.json")
  const targetPath = path.join(schemasDir, "fellowship.schema.json")

  try {
    // Verify source schema exists in the package
    if (!fs.existsSync(sourcePath)) {
      logWarn(`Source schema not found: ${sourcePath}`)
      return { written: false, targetPath, error: `Source schema not found: ${sourcePath}` }
    }

    // Ensure schemas directory exists
    fs.mkdirSync(schemasDir, { recursive: true })

    // Skip write if target already matches source content.
    // We compare file contents instead of mtime because fs.utimesSync
    // can lose sub-millisecond precision on some platforms, causing
    // the target mtime to drift below the source and triggering
    // unnecessary rewrites on every startup.
    if (fs.existsSync(targetPath)) {
      const sourceContent = fs.readFileSync(sourcePath)
      const targetContent = fs.readFileSync(targetPath)
      if (sourceContent.equals(targetContent)) {
        logDebug("Schema already up-to-date, skipping materialization")
        return { written: false, targetPath }
      }
    }

    // Copy schema to target
    fs.copyFileSync(sourcePath, targetPath)

    logDebug(`Materialized schema to ${targetPath}`)
    return { written: true, targetPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logError(`Failed to materialize schema: ${message}`)
    return { written: false, targetPath, error: message }
  }
}
