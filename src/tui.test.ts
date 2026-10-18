import { describe, expect, test } from "bun:test"
import { resolveTheme, type ThemeDefinition } from "@opencode/theme/tui"
import { RGBA } from "@opentui/core"
import { portableTheme, toPortableColor } from "./tui"

// Every token OpenCode's schema requires, all pointing at one gray step except the five
// the sidebar reads, so the assertions below can tell which token feeds which color.
const gray = "$hue.gray.500"
const action = { primary: { base: gray }, secondary: { base: gray }, destructive: { base: gray } }
const definition: ThemeDefinition = {
  hue: {
    gray: { 100: "#f4f4f5", 200: "#e4e4e7", 300: "#d4d4d8", 400: "#a1a1aa", 500: "#71717a", 600: "#52525b", 700: "#3f3f46", 800: "#27272a", 900: "#18181b" },
    accent: "$hue.gray",
    interactive: "$hue.gray",
    neutral: "$hue.gray",
  },
  categorical: ["gray"],
  text: {
    base: "#101112",
    muted: "#202122",
    action: { ...action, primary: { base: "#303132" } },
    formfield: { base: gray },
    feedback: { error: { base: gray }, warning: { base: gray }, success: { base: gray }, info: { base: gray } },
  },
  background: {
    base: gray,
    raised: { base: gray, high: gray, max: gray },
    action: { ...action, primary: { base: "#404142" } },
    formfield: { base: gray },
    feedback: { error: { base: gray }, warning: { base: gray }, success: { base: gray }, info: { base: gray } },
  },
  border: { base: "#505152" },
  scrollbar: { base: gray },
  diff: {
    text: { added: gray, removed: gray, context: gray, hunkHeader: gray },
    background: { added: gray, removed: gray, context: gray },
    highlight: { added: gray, removed: gray },
    lineNumber: { text: gray, background: { added: gray, removed: gray } },
  },
  syntax: { comment: gray, keyword: gray, function: gray, variable: gray, string: gray, number: gray, type: gray, operator: gray, punctuation: gray },
  markdown: {
    text: gray, heading: gray, link: gray, linkText: gray, code: gray, blockQuote: gray, emphasis: gray,
    strong: gray, horizontalRule: gray, listItem: gray, listEnumeration: gray, image: gray, imageText: gray, codeBlock: gray,
  },
}

describe("TUI color boundary", () => {
  test("converts host RGBA values to strings before rendering", () => {
    expect(toPortableColor(RGBA.fromInts(202, 211, 245, 128))).toBe("#cad3f580")
  })

  test("maps a theme resolved by OpenCode to the sidebar colors", () => {
    expect(portableTheme(resolveTheme(definition))).toEqual({
      accent: "#404142ff",
      background: "#303132ff",
      borderActive: "#505152ff",
      text: "#101112ff",
      textMuted: "#202122ff",
    })
  })
})
