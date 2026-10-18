import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { performLoad } from "./index"
import { DEFAULT_CONFIG } from "./config"
import { getInstallPath, materializeSchema } from "./install"
import { DEFAULT_LOG_DIR } from "./logging"
import { DEFAULT_MCP_DIR } from "./mcp-install"
import { getPluginDir } from "./plugin-install"
import { getPresetSelectionPath } from "./preset-state"
import { getCompanionStatePath } from "./companion"
import { getTuiStatePath } from "./tui-state"
import { getOrchestrationCacheDir, getOrchestrationTaskStorageDir } from "./orchestration-plugin"
import { REAL_HOME } from "./test-preload"

const PACKAGE_ROOT = resolve(import.meta.dir, "..")

// The developer's live OpenCode directories. Asserting against these (not all of
// REAL_HOME) keeps the test valid when TMPDIR, and so the sandbox, lives under $HOME.
const REAL_OPENCODE_DIRS = [
  join(REAL_HOME, ".config", "opencode"),
  join(REAL_HOME, ".cache", "opencode"),
  join(REAL_HOME, ".local", "share", "opencode"),
]

function isInside(child: string, parent: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

// Writers must land in temp space, but not necessarily the preload sandbox: modules
// resolve some paths at import time, and a few tests point HOME at their own temp dir
// first, so which temp dir wins depends on test file order.
function escapesTempSpace(target: string): boolean {
  return !isInside(target, tmpdir()) || REAL_OPENCODE_DIRS.some((realDir) => isInside(target, realDir))
}

describe("test filesystem isolation", () => {
  test("resolves every default writer into temp space", () => {
    const schema = materializeSchema(PACKAGE_ROOT)
    expect(schema.error).toBeUndefined()
    expect(existsSync(schema.targetPath)).toBe(true)

    const writers = [
      schema.targetPath,
      getInstallPath("opencode-config", "example"),
      DEFAULT_LOG_DIR,
      DEFAULT_MCP_DIR,
      getPluginDir(),
      getPresetSelectionPath(),
      getCompanionStatePath(),
      getTuiStatePath(),
      getOrchestrationCacheDir(),
      getOrchestrationTaskStorageDir(),
    ]
    expect(writers.filter(escapesTempSpace)).toEqual([])
  })

  test("performLoad links bundled skills into temp space", async () => {
    await performLoad({ ...DEFAULT_CONFIG, dryRun: false })

    const installedSkill = getInstallPath("opencode-config", "example")
    expect([installedSkill].filter(escapesTempSpace)).toEqual([])
    expect(lstatSync(installedSkill).isSymbolicLink()).toBe(true)
    expect(readlinkSync(installedSkill)).toBe(join(PACKAGE_ROOT, "skill", "example"))
  })

  // Bun's os.homedir() ignores the sandboxed HOME, so any module that resolves
  // home on its own writes into the developer's real OpenCode directories.
  test("only src/paths.ts resolves the home directory", () => {
    const allowed = new Set(["paths.ts", "test-preload.ts"])
    const offenders = readdirSync(import.meta.dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !allowed.has(file))
      .filter((file) => /homedir\(|process\.env\.HOME\b/.test(readFileSync(join(import.meta.dir, file), "utf8")))
    expect(offenders).toEqual([])
  })

  // Bun module mocks are process-wide: a stub installed by one test file leaks into
  // every file loaded after it, so results depend on file order (which differs
  // between macOS and Linux).
  test("no test file mocks modules", () => {
    const offenders = readdirSync(import.meta.dir)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => /\bmock\.module\(/.test(readFileSync(join(import.meta.dir, file), "utf8")))
    expect(offenders).toEqual([])
  })
})
