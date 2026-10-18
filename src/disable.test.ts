import { describe, test, expect } from "bun:test"
import { createDisableMatcher, type AssetType } from "./disable"

describe("DisableMatcher", () => {
  describe("exact matching", () => {
    test("matches exact skill name with type prefix", () => {
      const matcher = createDisableMatcher(["skill:my-skill"])
      expect(matcher.isDisabled("skill", "my-skill")).toBe(true)
      expect(matcher.isDisabled("skill", "other-skill")).toBe(false)
    })

    test("matches exact agent name with type prefix", () => {
      const matcher = createDisableMatcher(["agent:my-agent"])
      expect(matcher.isDisabled("agent", "my-agent")).toBe(true)
      expect(matcher.isDisabled("agent", "other-agent")).toBe(false)
    })

    test("matches exact command name with type prefix", () => {
      const matcher = createDisableMatcher(["command:my-command"])
      expect(matcher.isDisabled("command", "my-command")).toBe(true)
      expect(matcher.isDisabled("command", "other-command")).toBe(false)
    })

    test("matches exact plugin name with type prefix", () => {
      const matcher = createDisableMatcher(["plugin:my-plugin"])
      expect(matcher.isDisabled("plugin", "my-plugin")).toBe(true)
      expect(matcher.isDisabled("plugin", "other-plugin")).toBe(false)
    })

    test("matches exact instruction path with type prefix", () => {
      const matcher = createDisableMatcher(["instruction:path/to/instruction.md"])
      expect(matcher.isDisabled("instruction", "path/to/instruction.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "other/path.md")).toBe(false)
    })

    test("matches exact mcp name with type prefix", () => {
      const matcher = createDisableMatcher(["mcp:my-mcp"])
      expect(matcher.isDisabled("mcp", "my-mcp")).toBe(true)
      expect(matcher.isDisabled("mcp", "other-mcp")).toBe(false)
    })

    test("type-prefixed entry only matches that type", () => {
      const matcher = createDisableMatcher(["skill:shared-name"])
      expect(matcher.isDisabled("skill", "shared-name")).toBe(true)
      expect(matcher.isDisabled("agent", "shared-name")).toBe(false)
      expect(matcher.isDisabled("command", "shared-name")).toBe(false)
    })

    test("entry without type prefix matches any type", () => {
      const matcher = createDisableMatcher(["shared-name"])
      expect(matcher.isDisabled("skill", "shared-name")).toBe(true)
      expect(matcher.isDisabled("agent", "shared-name")).toBe(true)
      expect(matcher.isDisabled("command", "shared-name")).toBe(true)
    })
  })

  describe("glob patterns with *", () => {
    test("* matches any characters in name", () => {
      const matcher = createDisableMatcher(["skill:my-*"])
      expect(matcher.isDisabled("skill", "my-skill")).toBe(true)
      expect(matcher.isDisabled("skill", "my-plugin")).toBe(true)
      expect(matcher.isDisabled("skill", "my-")).toBe(true)
      expect(matcher.isDisabled("skill", "other-skill")).toBe(false)
    })

    test("* at start of pattern", () => {
      const matcher = createDisableMatcher(["agent:*-agent"])
      expect(matcher.isDisabled("agent", "my-agent")).toBe(true)
      expect(matcher.isDisabled("agent", "test-agent")).toBe(true)
      expect(matcher.isDisabled("agent", "agent-test")).toBe(false)
    })

    test("* in middle of pattern", () => {
      const matcher = createDisableMatcher(["command:do-*-thing"])
      expect(matcher.isDisabled("command", "do-the-thing")).toBe(true)
      expect(matcher.isDisabled("command", "do-any-thing")).toBe(true)
      expect(matcher.isDisabled("command", "do--thing")).toBe(true)
      expect(matcher.isDisabled("command", "do-thing")).toBe(false)
    })

    test("multiple * in pattern", () => {
      const matcher = createDisableMatcher(["skill:*-middle-*"])
      expect(matcher.isDisabled("skill", "start-middle-end")).toBe(true)
      expect(matcher.isDisabled("skill", "-middle-")).toBe(true)
      expect(matcher.isDisabled("skill", "nomatch")).toBe(false)
    })

    test("* does not match path separators", () => {
      const matcher = createDisableMatcher(["instruction:path/*.md"])
      expect(matcher.isDisabled("instruction", "path/test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "path/deep/test.md")).toBe(false)
    })
  })

  describe("glob patterns with **", () => {
    test("** matches across path separators", () => {
      const matcher = createDisableMatcher(["instruction:**/*.md"])
      // **/*.md requires a / before the filename (glob standard behavior)
      expect(matcher.isDisabled("instruction", "test.md")).toBe(false)
      expect(matcher.isDisabled("instruction", "path/test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "deep/path/test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "test.txt")).toBe(false)
    })

    test("** at end matches any depth", () => {
      const matcher = createDisableMatcher(["instruction:docs/**"])
      expect(matcher.isDisabled("instruction", "docs/")).toBe(true)
      expect(matcher.isDisabled("instruction", "docs/file.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "docs/deep/file.md")).toBe(true)
    })

    test("** at start matches any prefix", () => {
      const matcher = createDisableMatcher(["skill:**-test"])
      expect(matcher.isDisabled("skill", "test")).toBe(false) // needs at least something before -test
      expect(matcher.isDisabled("skill", "my-test")).toBe(true)
      expect(matcher.isDisabled("skill", "foo/bar-test")).toBe(true)
    })
  })

  describe("glob patterns with ?", () => {
    test("? matches single character", () => {
      const matcher = createDisableMatcher(["agent:agen?"])
      expect(matcher.isDisabled("agent", "agent")).toBe(true)
      expect(matcher.isDisabled("agent", "agenX")).toBe(true)
      expect(matcher.isDisabled("agent", "agen")).toBe(false)
      expect(matcher.isDisabled("agent", "agentXY")).toBe(false)
    })

    test("multiple ? characters", () => {
      const matcher = createDisableMatcher(["skill:??-skill"])
      expect(matcher.isDisabled("skill", "ab-skill")).toBe(true)
      expect(matcher.isDisabled("skill", "XY-skill")).toBe(true)
      expect(matcher.isDisabled("skill", "a-skill")).toBe(false)
      expect(matcher.isDisabled("skill", "abc-skill")).toBe(false)
    })
  })

  describe("negation with !", () => {
    test("! prefix negates a match", () => {
      const matcher = createDisableMatcher(["skill:*", "!skill:keep-this"])
      expect(matcher.isDisabled("skill", "any-skill")).toBe(true)
      expect(matcher.isDisabled("skill", "keep-this")).toBe(false)
    })

    test("negation with glob pattern", () => {
      const matcher = createDisableMatcher(["agent:*", "!agent:test-*"])
      expect(matcher.isDisabled("agent", "my-agent")).toBe(true)
      expect(matcher.isDisabled("agent", "test-agent")).toBe(false)
      expect(matcher.isDisabled("agent", "test-anything")).toBe(false)
    })

    test("negation order matters - later patterns override earlier", () => {
      // Disable all, then re-enable specific ones
      const matcher1 = createDisableMatcher(["command:*", "!command:allow"])
      expect(matcher1.isDisabled("command", "deny")).toBe(true)
      expect(matcher1.isDisabled("command", "allow")).toBe(false)

      // Re-enable, then disable again - this effectively keeps it disabled
      const matcher2 = createDisableMatcher(["!command:test", "command:test"])
      expect(matcher2.isDisabled("command", "test")).toBe(true)
    })

    test("negation without type prefix", () => {
      const matcher = createDisableMatcher(["*-deprecated", "!important-deprecated"])
      expect(matcher.isDisabled("skill", "old-deprecated")).toBe(true)
      expect(matcher.isDisabled("agent", "old-deprecated")).toBe(true)
      expect(matcher.isDisabled("skill", "important-deprecated")).toBe(false)
    })
  })

  describe("instruction basename matching", () => {
    test("matches instruction by basename when using any-type pattern", () => {
      const matcher = createDisableMatcher(["test.md"])
      expect(matcher.isDisabled("instruction", "path/to/test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "other.md")).toBe(false)
    })

    test("typed instruction pattern matches full path", () => {
      const matcher = createDisableMatcher(["instruction:test.md"])
      expect(matcher.isDisabled("instruction", "test.md")).toBe(true)
      expect(matcher.isDisabled("instruction", "path/to/test.md")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("empty disable list matches nothing", () => {
      const matcher = createDisableMatcher([])
      expect(matcher.isDisabled("skill", "any")).toBe(false)
      expect(matcher.isDisabled("agent", "any")).toBe(false)
    })

    test("empty string entries are ignored", () => {
      const matcher = createDisableMatcher(["", "skill:test", "  ", "agent:test"])
      expect(matcher.isDisabled("skill", "test")).toBe(true)
      expect(matcher.isDisabled("agent", "test")).toBe(true)
    })

    test("whitespace is trimmed", () => {
      const matcher = createDisableMatcher(["  skill:test  ", "agent: spaced "])
      expect(matcher.isDisabled("skill", "test")).toBe(true)
      expect(matcher.isDisabled("agent", "spaced")).toBe(true)
    })

    test("case sensitivity", () => {
      const matcher = createDisableMatcher(["skill:MySkill"])
      expect(matcher.isDisabled("skill", "MySkill")).toBe(true)
      expect(matcher.isDisabled("skill", "myskill")).toBe(false)
      expect(matcher.isDisabled("skill", "MYSKILL")).toBe(false)
    })

    test("special regex characters are escaped", () => {
      const matcher = createDisableMatcher(["skill:test.skill", "agent:test[1]"])
      expect(matcher.isDisabled("skill", "test.skill")).toBe(true)
      expect(matcher.isDisabled("skill", "testXskill")).toBe(false) // . is literal, not regex
      expect(matcher.isDisabled("agent", "test[1]")).toBe(true)
    })

    test("handles mixed patterns", () => {
      const matcher = createDisableMatcher([
        "skill:deprecated-*",
        "agent:test-agent",
        "!skill:deprecated-but-keep",
        "internal-*",
      ])
      expect(matcher.isDisabled("skill", "deprecated-old")).toBe(true)
      expect(matcher.isDisabled("skill", "deprecated-but-keep")).toBe(false)
      expect(matcher.isDisabled("agent", "test-agent")).toBe(true)
      expect(matcher.isDisabled("agent", "other-agent")).toBe(false)
      expect(matcher.isDisabled("skill", "internal-tool")).toBe(true)
      expect(matcher.isDisabled("command", "internal-cmd")).toBe(true)
    })
  })
})
