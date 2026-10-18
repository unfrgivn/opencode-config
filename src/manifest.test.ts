import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ManifestSchema, loadManifest } from "./manifest"

describe("manifest", () => {
  describe("ManifestSchema", () => {
    test("accepts minimal valid manifest", () => {
      const result = ManifestSchema.safeParse({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.instructions).toEqual([])
      }
    })

    test("accepts $schema key for editor support", () => {
      const result = ManifestSchema.safeParse({
        $schema: "https://example.com/schema.json",
      })
      expect(result.success).toBe(true)
    })

    test("accepts valid instructions array", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["README.md", "docs/setup.md"],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.instructions).toEqual(["README.md", "docs/setup.md"])
      }
    })

    test("rejects non-string instruction paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: [123, "valid.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects instructions that do not end with .md", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["README.txt"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects absolute paths in instructions", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["/absolute/path.md"],
      })
      expect(result.success).toBe(false)
    })

    test("accepts nested relative paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs/guide/intro.md", "nested/deep/file.md"],
      })
      expect(result.success).toBe(true)
    })

    test("rejects path traversal with leading ..", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["../secrets.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects path traversal with nested ..", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["nested/../../secrets.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths with dot segment in nested path", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs/./setup.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths with leading dot segments", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["././README.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths with backslashes", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs\\file.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects Windows-style absolute paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["C:\\path\\file.md"],
      })
      expect(result.success).toBe(false)
    })

    test("trims whitespace from paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["  README.md  "],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.instructions).toEqual(["README.md"])
      }
    })

    test("rejects empty string paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: [""],
      })
      expect(result.success).toBe(false)
    })

    test("rejects whitespace-only paths", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["   "],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths that are just .md with no filename", () => {
      const result = ManifestSchema.safeParse({
        instructions: [".md"],
      })
      expect(result.success).toBe(false)
    })

    test("normalizes paths starting with ./", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["./README.md"],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.instructions).toEqual(["README.md"])
      }
    })

    test("normalizes nested paths starting with ./", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["./docs/setup.md"],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.instructions).toEqual(["docs/setup.md"])
      }
    })

    test("rejects paths with consecutive slashes", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs//file.md"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths with trailing slash", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs/"],
      })
      expect(result.success).toBe(false)
    })

    test("rejects paths with .md in directory but no filename", () => {
      const result = ManifestSchema.safeParse({
        instructions: ["docs/.md"],
      })
      expect(result.success).toBe(false)
    })
  })

  describe("loadManifest", () => {
    let testDir: string

    beforeEach(() => {
      // Create unique temp directory for test isolation
      testDir = mkdtempSync(join(tmpdir(), "manifest-test-"))
    })

    afterEach(() => {
      // Clean up after each test
      rmSync(testDir, { recursive: true, force: true })
    })

    test("returns not-found when manifest.json does not exist", () => {
      const result = loadManifest(testDir)
      expect(result.status).toBe("not-found")
    })

    test("loads valid manifest.json", () => {
      const manifestPath = join(testDir, "manifest.json")
      writeFileSync(
        manifestPath,
        JSON.stringify({
          instructions: ["README.md"],
        })
      )

      const result = loadManifest(testDir)
      expect(result.status).toBe("found")
      if (result.status === "found") {
        expect(result.manifest.instructions).toEqual(["README.md"])
      }
    })

    test("returns invalid for invalid JSON", () => {
      const manifestPath = join(testDir, "manifest.json")
      writeFileSync(manifestPath, "{ invalid json }")

      const result = loadManifest(testDir)
      expect(result.status).toBe("invalid")
      if (result.status === "invalid") {
        expect(result.error).toBeDefined()
      }
    })

    test("returns invalid when validation fails", () => {
      const manifestPath = join(testDir, "manifest.json")
      writeFileSync(
        manifestPath,
        JSON.stringify({
          instructions: ["/absolute/path.md"],
        })
      )

      const result = loadManifest(testDir)
      expect(result.status).toBe("invalid")
    })

    test("returns default empty instructions when field is missing", () => {
      const manifestPath = join(testDir, "manifest.json")
      writeFileSync(manifestPath, JSON.stringify({}))

      const result = loadManifest(testDir)
      expect(result.status).toBe("found")
      if (result.status === "found") {
        expect(result.manifest.instructions).toEqual([])
      }
    })

    test("returns invalid for non-.md instructions", () => {
      const manifestPath = join(testDir, "manifest.json")
      writeFileSync(
        manifestPath,
        JSON.stringify({
          instructions: ["README.txt"],
        })
      )

      const result = loadManifest(testDir)
      expect(result.status).toBe("invalid")
    })
  })
})
