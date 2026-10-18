export interface CompanionSpawnRecord {
  pid: number
  binaryPath: string
  pluginVersion: string | null
}

export type CompanionLaunchDecision =
  | { action: "spawn"; reason: string }
  | { action: "reuse"; pid: number; reason: string }
  | { action: "replace"; pid: number; reason: string }

export interface CompanionLaunchInput {
  livePid: number | null
  liveCommand: string | null
  spawnRecord: CompanionSpawnRecord | null
  desiredBinaryPath: string
  pluginVersion: string | null
  recordedBinaryExists: boolean
}

export function parseCompanionSpawnRecord(value: unknown): CompanionSpawnRecord | null {
  if (!isRecord(value)) return null
  const pid = value.pid
  const binaryPath = value.binaryPath
  const pluginVersion = value.pluginVersion
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null
  if (typeof binaryPath !== "string" || binaryPath.length === 0) return null
  if (pluginVersion !== null && typeof pluginVersion !== "string") return null
  return { pid, binaryPath, pluginVersion }
}

export function comparePluginVersions(left: string, right: string): number | null {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) return null
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1
  }
  return 0
}

export function decideCompanionLaunch(input: CompanionLaunchInput): CompanionLaunchDecision {
  const { livePid, liveCommand, spawnRecord } = input
  if (livePid === null) return { action: "spawn", reason: "no-live-pid" }

  const recordMatchesPid = spawnRecord?.pid === livePid
  const commandIdentifiesOtherProcess =
    liveCommand !== null
    && !liveCommand.includes(input.desiredBinaryPath)
    && !(recordMatchesPid && liveCommand.includes(spawnRecord.binaryPath))
    && !liveCommand.includes("fellowship-companion")
  if (commandIdentifiesOtherProcess) return { action: "spawn", reason: "pid-reused" }

  if (liveCommand?.includes(input.desiredBinaryPath)) return { action: "reuse", pid: livePid, reason: "desired-binary" }
  if (liveCommand === null && recordMatchesPid && spawnRecord.binaryPath === input.desiredBinaryPath) {
    return { action: "reuse", pid: livePid, reason: "recorded-desired-binary" }
  }
  if (liveCommand === null) return { action: "reuse", pid: livePid, reason: "command-unverified" }

  const newerVersion =
    spawnRecord?.pluginVersion !== null
    && spawnRecord?.pluginVersion !== undefined
    && input.pluginVersion !== null
    && comparePluginVersions(input.pluginVersion, spawnRecord.pluginVersion) === 1
  if (!recordMatchesPid || !input.recordedBinaryExists || newerVersion) {
    return { action: "replace", pid: livePid, reason: !recordMatchesPid ? "missing-spawn-record" : !input.recordedBinaryExists ? "recorded-binary-missing" : "newer-plugin-version" }
  }
  return { action: "reuse", pid: livePid, reason: "same-companion-version" }
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
