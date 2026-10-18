/**
 * Agent name theming system.
 *
 * Maps canonical (filename-derived) agent names to themed display names.
 * Two themes are supported:
 *   - "descriptive" — role-based names (orchestrator, explorer, ...) — the default
 *   - "lotr"        — Tolkien character names (gandalf, legolas, ...)
 *
 * Agent files on disk use descriptive names (orchestrator.md, explorer.md, etc.).
 * The mapping serves two purposes:
 *   1. Remap the agent *key* injected into OpenCode config at discovery time.
 *   2. Resolve `{{role}}` template variables inside agent/command markdown so
 *      cross-references between agents stay consistent regardless of theme.
 */

export type AgentNameTheme = "lotr" | "descriptive"

/**
 * Canonical role identifier used for template variables.
 * The role is the stable concept; the displayed name depends on the theme.
 */
export type AgentRole =
  | "orchestrator"
  | "explorer"
  | "researcher"
  | "planner"
  | "implementer"
  | "architect"
  | "analyst"
  | "tdd"

/**
 * Bidirectional mapping entry: canonical filename ↔ role ↔ themed names.
 */
interface AgentNameEntry {
  /** Filename stem (without .md) — the canonical key on disk */
  canonical: string
  /** Stable role used for template variables */
  role: AgentRole
  /** Display names per theme */
  themed: Record<AgentNameTheme, string>
}

export interface AgentAliasMatch<T> {
  key: string
  value: T
}

/**
 * The single source of truth for agent name mappings.
 *
 * Canonical names match the filenames on disk (descriptive role names).
 * To add a new agent: append an entry here, create the .md file using the
 * canonical (descriptive) name, pick a fitting LOTR character for the lotr
 * theme, and use `{{role}}` in cross-references (e.g. `{{explorer}}`).
 */
const AGENT_NAME_TABLE: readonly AgentNameEntry[] = [
  { canonical: "orchestrator", role: "orchestrator", themed: { lotr: "gandalf",     descriptive: "orchestrator" } },
  { canonical: "explorer",     role: "explorer",     themed: { lotr: "legolas",     descriptive: "explorer"     } },
  { canonical: "researcher",   role: "researcher",   themed: { lotr: "radagast",    descriptive: "researcher"   } },
  { canonical: "planner",      role: "planner",      themed: { lotr: "treebeard",   descriptive: "planner"      } },
  { canonical: "implementer",  role: "implementer",  themed: { lotr: "celebrimbor", descriptive: "implementer"  } },
  { canonical: "architect",    role: "architect",     themed: { lotr: "elrond",      descriptive: "architect"    } },
  { canonical: "analyst",      role: "analyst",       themed: { lotr: "galadriel",   descriptive: "analyst"      } },
  { canonical: "tdd",          role: "tdd",           themed: { lotr: "aragorn",     descriptive: "tdd"          } },
] as const

// Pre-built lookup: canonical name → entry
const BY_CANONICAL = new Map<string, AgentNameEntry>(
  AGENT_NAME_TABLE.map((e) => [e.canonical, e])
)

const BY_ANY_NAME = new Map<string, AgentNameEntry>()

for (const entry of AGENT_NAME_TABLE) {
  BY_ANY_NAME.set(entry.canonical, entry)
  BY_ANY_NAME.set(entry.themed.descriptive, entry)
  BY_ANY_NAME.set(entry.themed.lotr, entry)
}

/**
 * Resolve a canonical agent filename to its themed display name.
 * Returns the original name unchanged if it is not in the mapping table
 * (i.e. user-added agents pass through untouched).
 */
export function resolveAgentName(canonical: string, theme: AgentNameTheme): string {
  const entry = BY_CANONICAL.get(canonical)
  if (!entry) return canonical
  return entry.themed[theme]
}

/**
 * Build template variable map for the given theme.
 *
 * Returns a record like `{ explorer: "legolas", researcher: "radagast", ... }`
 * (when theme is "lotr") or `{ explorer: "explorer", ... }` (when "descriptive").
 *
 * Template variables are keyed by *role* so markdown authors write
 * `{{explorer}}` and it resolves to whichever name the current theme maps to.
 */
export function buildTemplateVars(theme: AgentNameTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const entry of AGENT_NAME_TABLE) {
    vars[entry.role] = entry.themed[theme]
  }
  return vars
}

/**
 * Replace `{{key}}` placeholders in text using the provided variable map.
 *
 * Unknown keys are left as-is (no silent swallowing of typos, which makes
 * them visible in the output and easy to catch).
 */
export function resolveTemplateVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) return vars[key]
    return match
  })
}

/**
 * Build a reverse map from themed name → canonical name for a given theme.
 * Useful for translating disable-list entries back to canonical filenames.
 */
export function buildReverseMap(theme: AgentNameTheme): Record<string, string> {
  const reverse: Record<string, string> = {}
  for (const entry of AGENT_NAME_TABLE) {
    reverse[entry.themed[theme]] = entry.canonical
  }
  return reverse
}

/**
 * Return all accepted names for a built-in agent.
 * For known agents this includes the descriptive and LOTR names.
 * Unknown names are returned unchanged so custom agents still pass through.
 */
export function getAgentNameAliases(name: string): string[] {
  const entry = BY_ANY_NAME.get(name)
  if (!entry) return [name]

  return [...new Set([
    entry.canonical,
    entry.themed.descriptive,
    entry.themed.lotr,
  ])]
}

/**
 * Look up a value by agent name, accepting either descriptive or LOTR aliases.
 *
 * Resolution order is deliberate:
 *  1. exact key match
 *  2. alternate built-in aliases for the same agent
 *
 * This lets users write either `orchestrator` or `gandalf`, while keeping exact
 * matches authoritative if both are present.
 */
export function lookupAgentAlias<T>(record: Record<string, T>, name: string): AgentAliasMatch<T> | null {
  if (Object.prototype.hasOwnProperty.call(record, name)) {
    return { key: name, value: record[name] as T }
  }

  for (const alias of getAgentNameAliases(name)) {
    if (alias === name) continue
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return { key: alias, value: record[alias] as T }
    }
  }

  return null
}

/**
 * Get the full agent name table (read-only).
 * Exposed for testing and introspection.
 */
export function getAgentNameTable(): readonly AgentNameEntry[] {
  return AGENT_NAME_TABLE
}
