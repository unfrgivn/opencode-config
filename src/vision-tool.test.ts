import { describe, test, expect } from "bun:test"

type VisionToolModule = {
  default: unknown
  VisionToolPlugin: unknown
  parseJsonOrJsonc: (text: string) => unknown
  parseMimeFromDataUrl: (data: string) => string | null
  inferMimeTypeFromBase64: (data: string) => string
  extractBase64Data: (data: string) => string
  createVisionSessionInput: (goal: string, agent: string, parentID: string, directory: string) => {
    title: string
    parentID: string
    agent: string
    location: { directory: string }
  }
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

  test("classifies analysis sessions as children of the calling session", () => {
    return visionToolPromise.then(({ createVisionSessionInput }) => {
      expect(createVisionSessionInput("inspect chart", "analyst", "ses_parent", "/project")).toMatchObject({
        parentID: "ses_parent",
        agent: "analyst",
        location: { directory: "/project" },
      })
    })
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

  describe("MIME_TYPES", () => {
    test("contains expected image extensions", () => {
      return visionToolPromise.then(({ MIME_TYPES }) => {
        expect(MIME_TYPES[".png"]).toBe("image/png")
        expect(MIME_TYPES[".jpg"]).toBe("image/jpeg")
        expect(MIME_TYPES[".jpeg"]).toBe("image/jpeg")
        expect(MIME_TYPES[".gif"]).toBe("image/gif")
        expect(MIME_TYPES[".webp"]).toBe("image/webp")
      })
    })

    test("contains expected video extensions", () => {
      return visionToolPromise.then(({ MIME_TYPES }) => {
        expect(MIME_TYPES[".mp4"]).toBe("video/mp4")
        expect(MIME_TYPES[".mov"]).toBe("video/quicktime")
        expect(MIME_TYPES[".avi"]).toBe("video/x-msvideo")
        expect(MIME_TYPES[".webm"]).toBe("video/webm")
      })
    })

    test("contains expected audio extensions", () => {
      return visionToolPromise.then(({ MIME_TYPES }) => {
        expect(MIME_TYPES[".wav"]).toBe("audio/wav")
        expect(MIME_TYPES[".mp3"]).toBe("audio/mpeg")
        expect(MIME_TYPES[".ogg"]).toBe("audio/ogg")
      })
    })

    test("contains .pdf", () => {
      return visionToolPromise.then(({ MIME_TYPES }) => {
        expect(MIME_TYPES[".pdf"]).toBe("application/pdf")
      })
    })
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

  describe("SUPPORTED_MIME_TYPES", () => {
    test("is a Set", () => {
      return visionToolPromise.then(({ SUPPORTED_MIME_TYPES }) => {
        expect(SUPPORTED_MIME_TYPES).toBeInstanceOf(Set)
      })
    })

    test("contains all unique values from MIME_TYPES", () => {
      return visionToolPromise.then(({ MIME_TYPES, SUPPORTED_MIME_TYPES }) => {
        for (const value of new Set(Object.values(MIME_TYPES))) {
          expect(SUPPORTED_MIME_TYPES.has(value)).toBe(true)
        }
      })
    })

    test("contains expected MIME types", () => {
      return visionToolPromise.then(({ SUPPORTED_MIME_TYPES }) => {
        expect(SUPPORTED_MIME_TYPES.has("image/png")).toBe(true)
        expect(SUPPORTED_MIME_TYPES.has("image/jpeg")).toBe(true)
        expect(SUPPORTED_MIME_TYPES.has("application/pdf")).toBe(true)
      })
    })
  })
})
