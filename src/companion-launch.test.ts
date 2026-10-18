import { describe, expect, it } from "bun:test"
import {
  comparePluginVersions,
  decideCompanionLaunch,
  parseCompanionSpawnRecord,
  type CompanionSpawnRecord,
} from "./companion-launch"

const desiredBinaryPath = "/new/fellowship-companion"
const oldBinaryPath = "/old/fellowship-companion"
const record: CompanionSpawnRecord = { pid: 42, binaryPath: oldBinaryPath, pluginVersion: "3.0.3" }

function decide(overrides: Partial<Parameters<typeof decideCompanionLaunch>[0]> = {}) {
  return decideCompanionLaunch({
    livePid: 42,
    liveCommand: oldBinaryPath,
    spawnRecord: record,
    desiredBinaryPath,
    pluginVersion: "3.0.5",
    recordedBinaryExists: true,
    ...overrides,
  })
}

describe("companion launch decisions", () => {
  it("spawns when no live companion PID exists", () => {
    expect(
      decideCompanionLaunch({
        livePid: null,
        liveCommand: null,
        spawnRecord: null,
        desiredBinaryPath: "/new/fellowship-companion",
        pluginVersion: "3.0.5",
        recordedBinaryExists: false,
      }),
    ).toEqual({ action: "spawn", reason: "no-live-pid" })
  })

  it("spawns when the live PID belongs to an unrelated process", () => {
    expect(decide({ liveCommand: "/usr/bin/sleep 30", spawnRecord: null })).toEqual({ action: "spawn", reason: "pid-reused" })
  })

  it("reuses a process whose command contains the desired binary", () => {
    expect(decide({ liveCommand: `/usr/bin/node ${desiredBinaryPath}` })).toEqual({ action: "reuse", pid: 42, reason: "desired-binary" })
  })

  it("reuses an unverified process when its record identifies the desired binary", () => {
    expect(decide({ liveCommand: null, spawnRecord: { ...record, binaryPath: desiredBinaryPath } })).toEqual({ action: "reuse", pid: 42, reason: "recorded-desired-binary" })
  })

  it("reuses a live process when its command cannot be inspected", () => {
    expect(decide({ liveCommand: null })).toEqual({ action: "reuse", pid: 42, reason: "command-unverified" })
  })

  it("replaces a verified older companion without a spawn record", () => {
    expect(decide({ spawnRecord: null })).toEqual({ action: "replace", pid: 42, reason: "missing-spawn-record" })
  })

  it("replaces a companion whose recorded binary was removed", () => {
    expect(decide({ recordedBinaryExists: false })).toEqual({ action: "replace", pid: 42, reason: "recorded-binary-missing" })
  })

  it("replaces a companion started by an older plugin version", () => {
    expect(decide()).toEqual({ action: "replace", pid: 42, reason: "newer-plugin-version" })
  })

  it("reuses a companion from the same plugin version", () => {
    expect(decide({ pluginVersion: "3.0.3" })).toEqual({ action: "reuse", pid: 42, reason: "same-companion-version" })
  })

  it("does not replace when either version is unparseable", () => {
    expect(decide({ pluginVersion: "dev" })).toEqual({ action: "reuse", pid: 42, reason: "same-companion-version" })
    expect(decide({ spawnRecord: { ...record, pluginVersion: "dev" } })).toEqual({ action: "reuse", pid: 42, reason: "same-companion-version" })
  })

  it("compares numeric semantic versions", () => {
    expect(comparePluginVersions("3.0.10", "3.0.9")).toBe(1)
    expect(comparePluginVersions("3.1.0", "3.1.0")).toBe(0)
    expect(comparePluginVersions("dev", "3.1.0")).toBeNull()
  })

  it("validates spawn records parsed from unknown JSON", () => {
    expect(parseCompanionSpawnRecord({ pid: 42, binaryPath: oldBinaryPath, pluginVersion: "3.0.3" })).toEqual(record)
    expect(parseCompanionSpawnRecord({ pid: "42", binaryPath: oldBinaryPath, pluginVersion: "3.0.3" })).toBeNull()
  })
})
