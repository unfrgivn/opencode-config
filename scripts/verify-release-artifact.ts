import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const projectRoot = join(import.meta.dir, "..")
const tempDir = mkdtempSync(join(tmpdir(), "fellowship-release-"))

try {
  const packOutput = run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", tempDir], projectRoot)
  const packResult: unknown = JSON.parse(packOutput)
  if (!Array.isArray(packResult) || packResult.length !== 1) throw new Error("npm pack returned an unexpected result")
  if (!isRecord(packResult[0])) throw new Error("npm pack returned invalid artifact metadata")
  const filename = packResult[0].filename
  if (typeof filename !== "string") throw new Error("npm pack did not return an artifact filename")

  writeFileSync(join(tempDir, "package.json"), '{"private":true,"type":"module"}\n')
  run(["bun", "add", join(tempDir, filename)], tempDir)
  run(
    [
      "bun",
      "-e",
      "const server = (await import('@unfrgivn/opencode-config')).default; const tui = (await import('@unfrgivn/opencode-config/tui')).default; if (typeof server?.setup !== 'function' || typeof tui?.setup !== 'function') throw new Error('invalid plugin exports')",
    ],
    tempDir,
  )

  const installedManifest: unknown = JSON.parse(
    readFileSync(join(tempDir, "node_modules", "@unfrgivn", "opencode-config", "package.json"), "utf8"),
  )
  if (!isRecord(installedManifest)) throw new Error("installed package manifest is invalid")
  if (installedManifest.types !== "dist/index.d.ts" || typeof installedManifest.exports !== "object") {
    throw new Error("installed package metadata is incomplete")
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
