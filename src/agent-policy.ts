import type { AgentConfig } from "./agent"
import { deepMerge } from "./deep-merge"

type PermissionAction = "ask" | "allow" | "deny"
type PermissionRule = PermissionAction | Record<string, PermissionAction>
type PermissionObject = Record<string, PermissionRule>

export interface AgentPolicyApplyOptions {
  availableMcps?: readonly string[]
}

interface PolicyEntry {
  name: string
  action: Extract<PermissionAction, "allow" | "deny">
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right))
}

function parsePolicyEntries(values: readonly string[] | undefined): PolicyEntry[] | null {
  if (values === undefined) return null

  return values.map((rawValue) => {
    const trimmed = rawValue.trim()
    if (trimmed.startsWith("!")) {
      return { name: trimmed.slice(1), action: "deny" }
    }
    return { name: trimmed, action: "allow" }
  })
}

function toPermissionObject(permission: AgentConfig["permission"]): PermissionObject {
  if (!permission || typeof permission === "string") return {}
  return structuredClone(permission) as PermissionObject
}

function mergePermissionObjects(
  base: AgentConfig["permission"],
  override: PermissionObject,
): AgentConfig["permission"] {
  return deepMerge(toPermissionObject(base), override) as AgentConfig["permission"]
}

function buildMcpPermission(
  entries: PolicyEntry[] | null,
  availableMcps: readonly string[] = [],
): PermissionObject {
  if (entries === null) return {}

  const permission: PermissionObject = {}
  const available = uniqueSorted(availableMcps)
  const explicitNames = uniqueSorted(entries.filter((entry) => entry.name !== "*").map((entry) => entry.name))
  const names = available.length > 0 ? available : explicitNames
  const wildcard = entries.find((entry) => entry.name === "*")
  const hasPositiveEntry = entries.some((entry) => entry.name !== "*" && entry.action === "allow")
  const defaultAction = wildcard?.action ?? (hasPositiveEntry ? "deny" : "allow")

  for (const name of names) {
    permission[`${name}_*`] = defaultAction
  }

  for (const entry of entries) {
    if (entry.name === "*") continue
    permission[`${entry.name}_*`] = entry.action
  }

  return permission
}

function buildSkillPermission(entries: PolicyEntry[] | null): PermissionObject {
  if (entries === null) return {}

  const rule: Record<string, PermissionAction> = {}
  const wildcard = entries.find((entry) => entry.name === "*")
  const hasPositiveEntry = entries.some((entry) => entry.name !== "*" && entry.action === "allow")
  rule["*"] = wildcard?.action ?? (hasPositiveEntry ? "deny" : "allow")

  for (const entry of entries) {
    if (entry.name === "*") continue
    rule[entry.name] = entry.action
  }

  return { skill: rule }
}

export function applyAgentPolicy(
  agentConfig: AgentConfig,
  options: AgentPolicyApplyOptions = {},
): AgentConfig {
  const policy = agentConfig.policy
  if (policy === undefined) return agentConfig

  let next = structuredClone(agentConfig) as AgentConfig
  delete next.policy

  if (policy.tools !== undefined) {
    next.tools = {
      ...(next.tools ?? {}),
      ...policy.tools,
    }
  }

  if (policy.permission !== undefined) {
    next = deepMerge(next, { permission: policy.permission }) as AgentConfig
  }

  const mcpPermission = buildMcpPermission(parsePolicyEntries(policy.mcps), options.availableMcps)
  const skillPermission = buildSkillPermission(parsePolicyEntries(policy.skills))
  const synthesizedPermission = deepMerge(mcpPermission, skillPermission) as PermissionObject

  if (Object.keys(synthesizedPermission).length > 0) {
    next.permission = mergePermissionObjects(next.permission, synthesizedPermission)
  }

  return next
}
