import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { z } from "zod"

const JsonRecordSchema = z.record(z.string(), z.unknown())
const StringRecordSchema = z.record(z.string(), z.string())

function readJsonRecord(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"))
  return JsonRecordSchema.parse(parsed)
}

function readStringRecord(parent: Record<string, unknown>, key: string): Record<string, string> {
  return StringRecordSchema.parse(parent[key])
}

describe("TUI dependency compatibility", () => {
  test("pins OpenTUI to the exact versions used by the OpenCode plugin SDK", () => {
    const packageJson = readJsonRecord(join(import.meta.dir, "..", "package.json"))
    const sdkPackageJson = readJsonRecord(
      join(import.meta.dir, "..", "node_modules", "@opencode-ai", "plugin", "package.json"),
    )
    const dependencies = readStringRecord(packageJson, "dependencies")
    const sdkDevDependencies = readStringRecord(sdkPackageJson, "devDependencies")

    expect(dependencies["@opentui/core"]).toBe(sdkDevDependencies["@opentui/core"])
    expect(dependencies["@opentui/solid"]).toBe(sdkDevDependencies["@opentui/solid"])
  })
})
