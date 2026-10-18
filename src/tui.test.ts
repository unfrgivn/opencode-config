import { describe, expect, test } from "bun:test"
import { portableTheme, toPortableColor } from "./tui"

function color(r: number, g: number, b: number, a = 255) {
  return {
    toInts: (): [number, number, number, number] => [r, g, b, a],
  }
}

describe("TUI color boundary", () => {
  test("converts host RGBA values to strings before rendering", () => {
    const hostColor = color(202, 211, 245, 128)

    const portable = toPortableColor(hostColor)

    expect(portable).toBe("#cad3f580")
  })

  test("maps the current nested theme tokens to portable sidebar colors", () => {
    const theme = portableTheme({
      text: {
        default: color(1, 2, 3),
        subdued: color(4, 5, 6),
        action: { primary: { default: color(7, 8, 9) } },
      },
      background: {
        action: { primary: { default: color(10, 11, 12) } },
      },
      border: { default: color(13, 14, 15) },
    })

    expect(theme).toEqual({
      accent: "#0a0b0cff",
      background: "#070809ff",
      borderActive: "#0d0e0fff",
      text: "#010203ff",
      textMuted: "#040506ff",
    })
  })
})
