import { describe, expect, test } from "bun:test"
import { FellowshipConfigPlugin } from "./index"

function applyOpenCodeLoader(module: unknown, invoke: (setup: unknown) => void): void {
  if (!module || typeof module !== "object") {
    throw new TypeError("Plugin module is not an object")
  }

  const defaultExport = "default" in module ? module.default : undefined
  if (defaultExport && typeof defaultExport === "object" && "setup" in defaultExport) {
    if (typeof defaultExport.setup !== "function") {
      throw new TypeError("Plugin setup is not a function")
    }
    invoke(defaultExport.setup)
    return
  }

  throw new TypeError("Plugin default export is not a V2 plugin")
}

function readVisionToolPlugin(module: unknown): unknown {
  if (!module || typeof module !== "object" || !("VisionToolPlugin" in module)) return undefined
  return module.VisionToolPlugin
}

describe("OpenCode V2 plugin loading", () => {
  test("invokes only each default setup and ignores named exports", async () => {
    const indexModule: unknown = await import("./index")
    const visionModule: unknown = await import(new URL("./vision-tool-plugin.ts", import.meta.url).href)
    const invoked: unknown[] = []

    applyOpenCodeLoader(indexModule, (server) => invoked.push(server))
    applyOpenCodeLoader(visionModule, (server) => invoked.push(server))

    expect(invoked).toEqual([
      FellowshipConfigPlugin.setup,
      readVisionToolPlugin(visionModule),
    ])
  })
})
