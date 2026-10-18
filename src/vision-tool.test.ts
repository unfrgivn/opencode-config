import { describe, test, expect } from "bun:test"
import type { VisionSessionMessage } from "./vision-tool-plugin"

type VisionToolModule = {
  default: unknown
  VisionToolPlugin: unknown
  parseJsonOrJsonc: (text: string) => unknown
  parseMimeFromDataUrl: (data: string) => string | null
  inferMimeTypeFromBase64: (data: string) => string
  extractBase64Data: (data: string) => string
  createVisionSessionInput: (input: {
    goal: string
    agent: string
    parentSessionID: string
    directory: string
    agentModel?: { id: string; providerID: string; variant?: string }
    callerModel?: { id: string; providerID: string; variant?: string }
  }) => Record<string, unknown>
  readVisionOutcome: (messages: ReadonlyArray<VisionSessionMessage>) => { ok: true; text: string } | { ok: false; error: string }
  fileExtensionError: (filePath: string) => string | null
  MIME_TYPES: Record<string, string>
  SUPPORTED_EXTENSIONS: string
  SUPPORTED_MIME_TYPES: Set<string>
}

const visionToolPromise = loadVisionToolModule()

async function loadVisionToolModule(): Promise<VisionToolModule> {
  const moduleUrl = new URL("./vision-tool-plugin.ts", import.meta.url)
  const loaded: unknown = await import(moduleUrl.href)
  if (!isVisionToolModule(loaded)) {
    throw new Error("Failed to load vision-tool module exports")
  }
  return loaded
}

function isVisionToolModule(value: unknown): value is VisionToolModule {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.VisionToolPlugin === "function" &&
    typeof record.parseJsonOrJsonc === "function" &&
    typeof record.parseMimeFromDataUrl === "function" &&
    typeof record.inferMimeTypeFromBase64 === "function" &&
    typeof record.extractBase64Data === "function" &&
    typeof record.createVisionSessionInput === "function" &&
    typeof record.readVisionOutcome === "function" &&
    typeof record.fileExtensionError === "function" &&
    typeof record.MIME_TYPES === "object" &&
    typeof record.SUPPORTED_EXTENSIONS === "string" &&
    record.SUPPORTED_MIME_TYPES instanceof Set
  )
}

describe("vision-tool", () => {
  test("exports the plugin through a stable V2 module", () => {
    return visionToolPromise.then((loaded) => {
      expect(loaded.default).toEqual({
        id: "@unfrgivn/opencode-config:vision-tool",
        setup: loaded.VisionToolPlugin,
      })
    })
  })

  test("builds a nested child analysis session that cannot open more sessions", () => {
    return visionToolPromise.then(({ createVisionSessionInput }) => {
      const input = createVisionSessionInput({
        goal: "inspect chart",
        agent: "analyst",
        parentSessionID: "ses_parent",
        directory: "/project",
        agentModel: { providerID: "github-copilot", id: "gemini-3.8-flash" },
        callerModel: { providerID: "opencode", id: "fallback" },
      })
      expect(input).toMatchObject({
        title: "vision: inspect chart",
        parentID: "ses_parent",
        agent: "analyst",
        location: { directory: "/project" },
        metadata: { source: "@unfrgivn/opencode-config:vision-tool" },
        permissions: [
          { action: "vision", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        ],
        model: { providerID: "github-copilot", id: "gemini-3.8-flash" },
      })
      expect(createVisionSessionInput({ goal: "inspect", agent: "analyst", parentSessionID: "p", directory: "/p", callerModel: { providerID: "opencode", id: "caller" } }).model).toEqual({ providerID: "opencode", id: "caller" })
      expect(createVisionSessionInput({ goal: "inspect", agent: "analyst", parentSessionID: "p", directory: "/p" })).not.toHaveProperty("model")
    })
  })

  describe("readVisionOutcome", () => {
    // Shapes match what session.context returned for real vision runs on OpenCode 2.0.32.
    const model = { providerID: "github-copilot", id: "gemini-3.8-flash" }

    test("joins text from the last assistant and ignores reasoning", () => visionToolPromise.then(({ readVisionOutcome }) => {
      const messages = [
        { id: "msg_1", time: { created: 1, completed: 2 }, type: "assistant", agent: "galadriel", model, content: [{ type: "text", text: "old" }] },
        {
          id: "msg_2",
          time: { created: 3, completed: 4 },
          type: "assistant",
          agent: "galadriel",
          model,
          content: [{ type: "reasoning", text: "hidden" }, { type: "text", text: "first" }, { type: "text", text: "second" }],
        },
        { id: "msg_3", time: { created: 5 }, type: "idle", outcome: "succeeded" },
      ] satisfies VisionSessionMessage[]
      expect(readVisionOutcome(messages)).toEqual({ ok: true, text: "first\nsecond" })
    }))
    test("returns the provider failure message", () => visionToolPromise.then(({ readVisionOutcome }) => {
      const messages = [
        {
          id: "msg_1",
          time: { created: 1 },
          type: "idle",
          outcome: "failed",
          error: { type: "provider.no-route", message: "Model unavailable: github-copilot/gemini-3-flash-preview" },
        },
      ] satisfies VisionSessionMessage[]
      expect(readVisionOutcome(messages)).toEqual({ ok: false, error: "Model unavailable: github-copilot/gemini-3-flash-preview" })
    }))
    test("returns an error for interruption and missing text", () => visionToolPromise.then(({ readVisionOutcome }) => {
      const interrupted = [{ id: "msg_1", time: { created: 1 }, type: "idle", outcome: "interrupted" }] satisfies VisionSessionMessage[]
      const reasoningOnly = [
        { id: "msg_1", time: { created: 1, completed: 2 }, type: "assistant", agent: "galadriel", model, content: [{ type: "reasoning", text: "thinking" }] },
        { id: "msg_2", time: { created: 3 }, type: "idle", outcome: "succeeded" },
      ] satisfies VisionSessionMessage[]
      expect(readVisionOutcome(interrupted)).toEqual({ ok: false, error: "Vision analysis was interrupted" })
      expect(readVisionOutcome(reasoningOnly)).toEqual({ ok: false, error: "Vision analysis returned no text" })
    }))
  })

  describe("fileExtensionError", () => {
    test("accepts supported extensions case-insensitively", () => visionToolPromise.then(({ fileExtensionError }) => {
      for (const extension of [".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JpEg"]) expect(fileExtensionError(`image${extension}`)).toBeNull()
    }))
    test("rejects unsupported extensions with conversion guidance", () => visionToolPromise.then(({ fileExtensionError }) => {
      for (const extension of [".gif", ".pdf", ".heic", ".bmp", ".mp4", ".wav"]) {
        const error = fileExtensionError(`input${extension}`)
        expect(error).toContain("Supported types are: .jpeg, .jpg, .png, .webp")
        expect(error).toContain("sips -s format png")
      }
      expect(fileExtensionError("input")).toContain("missing extension")
      expect(fileExtensionError("input.pdf")).toContain("first page")
    }))
  })

  describe("parseJsonOrJsonc", () => {
    test("parses plain JSON", () => {
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc('{"agentNames":"lotr"}')).toEqual({
          agentNames: "lotr",
        })
      })
    })

    test("strips line comments", () => {
      const input = `{
        // comment
        "agentNames": "lotr"
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ agentNames: "lotr" })
      })
    })

    test("strips block comments", () => {
      const input = `{
        /* comment */
        "agentNames": "lotr"
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ agentNames: "lotr" })
      })
    })

    test("strips multiline block comments", () => {
      const input = `{
        /* comment
           spanning lines */
        "agentNames": "lotr"
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ agentNames: "lotr" })
      })
    })

    test("does not strip // inside double-quoted strings", () => {
      const input = `{
        "url": "http://example.com//path",
        "agentNames": "lotr"
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({
          url: "http://example.com//path",
          agentNames: "lotr",
        })
      })
    })

    test("strips trailing commas before }", () => {
      const input = `{
        "agentNames": "lotr",
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ agentNames: "lotr" })
      })
    })

    test("strips trailing commas before ]", () => {
      const input = `{
        "values": [
          1,
          2,
        ]
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ values: [1, 2] })
      })
    })

    test("handles comments and trailing commas together", () => {
      const input = `{
        /* block comment */
        "values": [
          1, // line comment
          2,
        ],
      }`
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(parseJsonOrJsonc(input)).toEqual({ values: [1, 2] })
      })
    })

    test("throws on truly invalid JSON", () => {
      return visionToolPromise.then(({ parseJsonOrJsonc }) => {
        expect(() => parseJsonOrJsonc("{agentNames:lotr}")).toThrow()
      })
    })
  })

  describe("parseMimeFromDataUrl", () => {
    test("returns MIME from data:image/jpeg;base64", () => {
      return visionToolPromise.then(({ parseMimeFromDataUrl }) => {
        expect(parseMimeFromDataUrl("data:image/jpeg;base64,/9j/4AAQ"))
          .toBe("image/jpeg")
      })
    })

    test("returns MIME from data:image/png;base64", () => {
      return visionToolPromise.then(({ parseMimeFromDataUrl }) => {
        expect(parseMimeFromDataUrl("data:image/png;base64,iVBORw0KGgo"))
          .toBe("image/png")
      })
    })

    test("returns MIME from data:application/pdf;base64", () => {
      return visionToolPromise.then(({ parseMimeFromDataUrl }) => {
        expect(parseMimeFromDataUrl("data:application/pdf;base64,JVBERi0x"))
          .toBe("application/pdf")
      })
    })

    test("returns null for non-data-URL strings", () => {
      return visionToolPromise.then(({ parseMimeFromDataUrl }) => {
        expect(parseMimeFromDataUrl("not-a-data-url")).toBeNull()
      })
    })

    test("returns null for raw base64 data", () => {
      return visionToolPromise.then(({ parseMimeFromDataUrl }) => {
        expect(parseMimeFromDataUrl("iVBORw0KGgoAAAANSUhEUg"))
          .toBeNull()
      })
    })
  })

  describe("inferMimeTypeFromBase64", () => {
    test("detects PNG from magic bytes", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("iVBORw0KGgoAAAANSUhEUg"))
          .toBe("image/png")
      })
    })

    test("detects JPEG from magic bytes", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("/9j/4AAQSkZJRgABAQ"))
          .toBe("image/jpeg")
      })
    })

    test("detects GIF from magic bytes", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("R0lGODlhAQABAIA"))
          .toBe("image/gif")
      })
    })

    test("detects WebP from magic bytes", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("UklGRlIAAABXRUJQ"))
          .toBe("image/webp")
      })
    })

    test("detects PDF from magic bytes", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("JVBERi0xLjQK"))
          .toBe("application/pdf")
      })
    })

    test("extracts MIME from data URL", () => {
      const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64(dataUrl)).toBe("image/jpeg")
      })
    })

    test("falls back to image/png for unknown data", () => {
      return visionToolPromise.then(({ inferMimeTypeFromBase64 }) => {
        expect(inferMimeTypeFromBase64("AAAAAunknown"))
          .toBe("image/png")
      })
    })
  })

  describe("extractBase64Data", () => {
    test("strips data URL prefix", () => {
      return visionToolPromise.then(({ extractBase64Data }) => {
        expect(extractBase64Data("data:image/png;base64,ABCDEF"))
          .toBe("ABCDEF")
      })
    })

    test("returns raw base64 unchanged", () => {
      return visionToolPromise.then(({ extractBase64Data }) => {
        expect(extractBase64Data("iVBORw0KGgoAAAANSUhEUg"))
          .toBe("iVBORw0KGgoAAAANSUhEUg")
      })
    })

    test("handles different MIME types in data URL", () => {
      return visionToolPromise.then(({ extractBase64Data }) => {
        expect(extractBase64Data("data:application/pdf;base64,JVBERi0x"))
          .toBe("JVBERi0x")
      })
    })
  })

  describe("MIME_TYPES and supported MIME types", () => {
    test("contains only PNG, JPEG, and WebP", () => visionToolPromise.then(({ MIME_TYPES, SUPPORTED_MIME_TYPES }) => {
      expect(MIME_TYPES).toEqual({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })
      for (const mime of ["image/gif", "application/pdf", "video/mp4", "audio/wav"]) expect(SUPPORTED_MIME_TYPES.has(mime)).toBe(false)
    }))
  })

  describe("SUPPORTED_EXTENSIONS", () => {
    test("is derived from MIME_TYPES keys", () => {
      return visionToolPromise.then(({ MIME_TYPES, SUPPORTED_EXTENSIONS }) => {
        const expected = Object.keys(MIME_TYPES).sort().join(", ")
        expect(SUPPORTED_EXTENSIONS).toBe(expected)
      })
    })

    test("is sorted alphabetically", () => {
      return visionToolPromise.then(({ SUPPORTED_EXTENSIONS }) => {
        const pieces = SUPPORTED_EXTENSIONS.split(", ")
        const sorted = [...pieces].sort()
        expect(pieces).toEqual(sorted)
      })
    })

    test("contains all extensions from MIME_TYPES", () => {
      return visionToolPromise.then(({ MIME_TYPES, SUPPORTED_EXTENSIONS }) => {
        for (const ext of Object.keys(MIME_TYPES)) {
          expect(SUPPORTED_EXTENSIONS.split(", ")).toContain(ext)
        }
      })
    })
  })
})
