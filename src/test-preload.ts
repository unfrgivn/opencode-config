import { afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { homeDir } from "./paths"

// Captured before HOME is replaced below.
export const REAL_HOME = homedir()
export const SANDBOX_HOME = mkdtempSync(join(tmpdir(), "fellowship-test-home-"))

process.env.HOME = SANDBOX_HOME
process.env.XDG_CONFIG_HOME = join(SANDBOX_HOME, ".config")
process.env.XDG_CACHE_HOME = join(SANDBOX_HOME, ".cache")
process.env.XDG_DATA_HOME = join(SANDBOX_HOME, ".local", "share")
process.env.XDG_STATE_HOME = join(SANDBOX_HOME, ".local", "state")

if (homeDir() !== SANDBOX_HOME) {
  throw new Error(`Test home escaped the sandbox: ${homeDir()}`)
}

// Bun's test runner never fires process "exit" handlers. A top-level afterAll in
// a preload file runs once after every test file has finished.
afterAll(() => {
  rmSync(SANDBOX_HOME, { recursive: true, force: true })
})
