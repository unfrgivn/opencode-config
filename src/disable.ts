export type AssetType = "skill" | "agent" | "command" | "plugin" | "instruction" | "mcp"

type ParsedDisable = { type: AssetType | "any"; pattern: string; negated: boolean }

/**
 * Convert a glob pattern to a regex.
 * Supports:
 *   - * matches any characters except /
 *   - ** matches any characters including /
 *   - ? matches any single character
 *   - Negation with ! prefix
 */
function patternToRegex(pattern: string): RegExp {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars (except * and ?)
    .replace(/\*\*/g, "__DOUBLE_STAR__") // Temp marker for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/__DOUBLE_STAR__/g, ".*") // ** matches anything
    .replace(/\?/g, ".") // ? matches any single char

  return new RegExp(`^${escaped}$`)
}

function parseDisableEntry(raw: string): ParsedDisable | null {
  let trimmed = raw.trim()
  if (!trimmed) return null

  // Check for negation prefix
  const negated = trimmed.startsWith("!")
  if (negated) {
    trimmed = trimmed.slice(1).trim()
    if (!trimmed) return null
  }

  const m = trimmed.match(/^([a-zA-Z]+):(.*)$/)
  if (m) {
    const type = m[1].toLowerCase()
    const pattern = m[2].trim()
    if (!pattern) return null
    if (
      type === "skill" ||
      type === "agent" ||
      type === "command" ||
      type === "plugin" ||
      type === "instruction" ||
      type === "mcp"
    ) {
      return { type, pattern, negated }
    }
  }

  return { type: "any", pattern: trimmed, negated }
}

function getBasename(posixPath: string): string {
  const parts = posixPath.split("/").filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : posixPath
}

export interface DisableMatcher {
  isDisabled(type: AssetType, nameOrPath: string): boolean
}

type MatcherEntry = { regex: RegExp; negated: boolean }

export function createDisableMatcher(disable: string[]): DisableMatcher {
  const anyMatchers: MatcherEntry[] = []
  const typedMatchers: Record<AssetType, MatcherEntry[]> = {
    skill: [],
    agent: [],
    command: [],
    plugin: [],
    instruction: [],
    mcp: [],
  }

  for (const entry of disable) {
    const parsed = parseDisableEntry(entry)
    if (!parsed) continue
    const matcherEntry: MatcherEntry = {
      regex: patternToRegex(parsed.pattern),
      negated: parsed.negated,
    }
    if (parsed.type === "any") {
      anyMatchers.push(matcherEntry)
    } else {
      typedMatchers[parsed.type].push(matcherEntry)
    }
  }

  function matchesAny(name: string, matchers: MatcherEntry[]): boolean {
    let matched = false
    for (const matcher of matchers) {
      if (matcher.regex.test(name)) {
        if (matcher.negated) {
          // Negation: explicitly re-enable
          matched = false
        } else {
          // Match: disable
          matched = true
        }
      }
    }
    return matched
  }

  return {
    isDisabled(type: AssetType, nameOrPath: string): boolean {
      // Check type-specific matchers first
      const typeMatchers = typedMatchers[type]
      if (matchesAny(nameOrPath, typeMatchers)) return true

      // Check any-type matchers
      if (matchesAny(nameOrPath, anyMatchers)) return true

      // For instructions, also try matching just the basename
      if (type === "instruction") {
        const base = getBasename(nameOrPath)
        if (matchesAny(base, anyMatchers)) return true
      }

      return false
    },
  }
}
