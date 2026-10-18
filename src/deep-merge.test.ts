import { describe, expect, test } from "bun:test"
import { deepMerge } from "./deep-merge"

describe("deepMerge", () => {
  test("merges nested objects without dropping base keys", () => {
    const base = {
      permission: {
        write: "deny",
        bash: {
          "*": "ask",
          "git diff*": "allow",
        },
      },
      temperature: 0.1,
      prompt: "keep this",
    }

    const override = {
      permission: {
        bash: {
          "git log*": "allow",
        },
      },
      temperature: 0.3,
    }

    expect(deepMerge(base, override)).toEqual({
      permission: {
        write: "deny",
        bash: {
          "*": "ask",
          "git diff*": "allow",
          "git log*": "allow",
        },
      },
      temperature: 0.3,
      prompt: "keep this",
    })
  })

  test("replaces arrays instead of merging", () => {
    const base = { options: { tags: ["a", "b"] } }
    const override = { options: { tags: ["c"] } }

    expect(deepMerge(base, override)).toEqual({ options: { tags: ["c"] } })
  })

  test("supports explicit null overrides", () => {
    expect(deepMerge({ prompt: "x" }, { prompt: null })).toEqual({ prompt: null })
  })

  test("does not mutate base object", () => {
    const base = { permission: { write: "deny" } }
    const override = { permission: { edit: "deny" } }

    const result = deepMerge(base, override) as Record<string, unknown>
    expect(base).toEqual({ permission: { write: "deny" } })
    expect(result).toEqual({ permission: { write: "deny", edit: "deny" } })
  })
})
