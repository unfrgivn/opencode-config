import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { z } from "zod"

const JsonRecordSchema = z.record(z.string(), z.unknown())
const StringRecordSchema = z.record(z.string(), z.string())
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function readPackageJson(...segments: string[]): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(import.meta.dir, "..", ...segments, "package.json"), "utf-8"))
  return JsonRecordSchema.parse(parsed)
}

function readStringRecord(parent: Record<string, unknown>, key: string): Record<string, string> {
  return StringRecordSchema.parse(parent[key])
}

describe("OpenCode dependency pins", () => {
  test("pins the plugin SDK exactly so verify:release boots the matching OpenCode release", () => {
    const dependencies = readStringRecord(readPackageJson(), "dependencies")

    expect(dependencies["@opencode/plugin"]).toMatch(EXACT_VERSION)
  })

  test("pins OpenTUI to the exact versions used by the OpenCode plugin SDK", () => {
    const dependencies = readStringRecord(readPackageJson(), "dependencies")
    const sdkDevDependencies = readStringRecord(readPackageJson("node_modules", "@opencode", "plugin"), "devDependencies")

    expect(dependencies["@opentui/core"]).toBe(sdkDevDependencies["@opentui/core"])
    expect(dependencies["@opentui/solid"]).toBe(sdkDevDependencies["@opentui/solid"])
  })

  test("pins solid-js to the exact peer OpenTUI Solid requires", () => {
    const dependencies = readStringRecord(readPackageJson(), "dependencies")
    const opentuiSolidPeers = readStringRecord(readPackageJson("node_modules", "@opentui", "solid"), "peerDependencies")

    expect(dependencies["solid-js"]).toBe(opentuiSolidPeers["solid-js"])
  })
})
