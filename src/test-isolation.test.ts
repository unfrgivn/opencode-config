import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs"
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
import { REAL_HOME, SANDBOX_HOME } from "./test-preload"

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

function expectSandboxed(target: string): void {
  expect(isInside(target, SANDBOX_HOME)).toBe(true)
  for (const realDir of REAL_OPENCODE_DIRS) {
    expect(isInside(target, realDir)).toBe(false)
  }
}

describe("test filesystem isolation", () => {
  test("resolves every default writer inside the sandbox home", () => {
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
    for (const writer of writers) {
      expectSandboxed(writer)
    }
  })

  test("performLoad links bundled skills inside the sandbox home", async () => {
    await performLoad({ ...DEFAULT_CONFIG, dryRun: false })

    const installedSkill = getInstallPath("opencode-config", "example")
    expectSandboxed(installedSkill)
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
})
