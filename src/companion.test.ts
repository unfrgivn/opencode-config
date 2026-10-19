import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  CompanionActivityTracker,
  CompanionManager,
  formatCompanionAgent,
  getCompanionArtBasePath,
  getBundledCompanionBinaryPath,
  getCompanionStatePath,
  getCompanionPidPath,
  getCompanionSpawnRecordPath,
  getDefaultCompanionBinaryPath,
  normalizeCompanionConfig,
  readCompanionState,
  resolveCompanionBinaryPath,
} from "./companion"
import { getAgentNameTable } from "./agent-names"
import { DEFAULT_CONFIG } from "./config"
import { getPluginVersion } from "./status"

describe("companion", () => {
  let testDir: string
  let originalXdgDataHome: string | undefined
  const spawnedProcesses: ChildProcess[] = []

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "fellowship-companion-test-"))
    originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = testDir
  })

  afterEach(() => {
    stopTestCompanion()
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    for (const child of spawnedProcesses.splice(0)) child.kill()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("normalizes companion config defaults", () => {
    expect(normalizeCompanionConfig({ enabled: true })).toEqual({
      enabled: true,
      position: "bottom-right",
      size: "medium",
      gifPack: "default",
      loopStyle: "classic",
      speed: 1,
      debug: false,
      agentNameTheme: "descriptive",
      artBasePath: getCompanionArtBasePath(),
    })
  })

  it("uses Fellowship storage paths", () => {
    expect(getCompanionStatePath()).toBe(
      path.join(testDir, "opencode", "storage", "fellowship", "opencode-config.companion-state.json")
    )
    expect(getDefaultCompanionBinaryPath()).toBe(
      path.join(testDir, "opencode", "storage", "fellowship", "bin", "fellowship-companion")
    )
  })

  it("resolves configured companion binaries only when present", () => {
    const binaryPath = path.join(testDir, "custom-companion")
    const config = { ...DEFAULT_CONFIG.companion, enabled: true, binaryPath }
    expect(resolveCompanionBinaryPath(config)).toBeNull()
    fs.writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n")
    expect(resolveCompanionBinaryPath(config)).toBe(binaryPath)
  })

  it("falls back to the bundled companion binary when no managed binary exists", () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    expect(bundledPath?.endsWith(path.join("companion", "bin", "fellowship-companion"))).toBe(true)
    expect(resolveCompanionBinaryPath({ ...DEFAULT_CONFIG.companion, enabled: true })).toBe(bundledPath)
  })

  it("ships a macOS desktop overlay helper with the bundled companion", () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    expect(fs.existsSync(overlayPath)).toBe(true)
    const overlayScript = fs.readFileSync(overlayPath, "utf8")
    expect(overlayScript).toContain("NSWindowStyleMaskBorderless")
    expect(overlayScript).toContain("visibleAgents")
    expect(overlayScript).toContain("SPRITE_FRAME_COUNT")
    expect(overlayScript).toContain("setMasksToBounds")
    expect(overlayScript).toContain("STACK_GAP")
    expect(overlayScript).toContain("tileAt")
    expect(overlayScript).toContain("imageForPath")
    expect(overlayScript).toContain("currentArtPath")
    expect(overlayScript).toContain("opencode-companion-overlay")
    expect(overlayScript).toContain("setProcessName")
  })

  it("releases owned Cocoa objects used to read macOS overlay state", () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    const overlayScript = fs.readFileSync(overlayPath, "utf8")
    const readTextSource = overlayScript.slice(
      overlayScript.indexOf("function readText"),
      overlayScript.indexOf("function readJson")
    )

    expect(readTextSource).toMatch(
      /const data = \$\.NSData\.alloc\.initWithContentsOfFile[\s\S]*try \{[\s\S]*const text = \$\.NSString\.alloc\.initWithDataEncoding[\s\S]*try \{[\s\S]*return js\(text\)[\s\S]*\} finally \{[\s\S]*text\.release[\s\S]*\}[\s\S]*\} finally \{[\s\S]*data\.release[\s\S]*\}/
    )
  })

  it("releases each macOS overlay poll deadline without an autorelease pool", () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    const overlayScript = fs.readFileSync(overlayPath, "utf8")
    const pollingSource = overlayScript.slice(overlayScript.indexOf("function run"))

    expect(overlayScript).not.toContain("NSAutoreleasePool")
    expect(pollingSource).toMatch(
      /const runLoop = \$\.NSRunLoop\.currentRunLoop[\s\S]*while[\s\S]*const date = \$\.NSDate\.alloc\.initWithTimeIntervalSinceNow[\s\S]*try \{[\s\S]*runLoop\.runUntilDate\(date\)[\s\S]*\} finally \{[\s\S]*date\.release[\s\S]*\}/
    )
  })

  it("bounds macOS overlay polling before process recycling", () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    const overlayScript = fs.readFileSync(overlayPath, "utf8")

    expect(overlayScript).toContain("const DEFAULT_MAX_POLLS = 14400")
    expect(overlayScript).toContain("FELLOWSHIP_COMPANION_OVERLAY_MAX_POLLS")
    expect(overlayScript).toContain("$.NSProcessInfo.processInfo.environment")
    expect(overlayScript).toMatch(/Number\.isFinite[\s\S]*Number\.isInteger[\s\S]*> 0/)
    expect(overlayScript).toMatch(/while \([\s\S]*polls < maxPolls[\s\S]*polls \+= 1/)
    expect(overlayScript).toMatch(
      /for \(const tile of tiles\) \{\s*tile\.window\.orderOut\(null\)\s*\}\s*appendLog\(logPath, polls < maxPolls \? "idle, exiting" : `recycling polls=\$\{polls\}`\)/
    )
  })

  it.if(process.platform === "darwin")("runs and recycles the macOS overlay normally", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    const statePath = path.join(testDir, "overlay-state.json")
    const logPath = path.join(testDir, "overlay.log")
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [{ status: "busy", active_agents: ["gandalf"] }],
        config: { ...DEFAULT_CONFIG.companion, enabled: true },
      })
    )
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", overlayPath, "opencode-companion-overlay", statePath, logPath],
      {
        env: { ...process.env, FELLOWSHIP_COMPANION_OVERLAY_MAX_POLLS: "2" },
        stdio: "ignore",
      }
    )
    spawnedProcesses.push(child)

    const exitCode = await waitForExit(child, 5000)
    const log = fs.readFileSync(logPath, "utf8")
    expect(exitCode).toBe(0)
    expect(log).toContain(`tile overlay started state=${statePath}`)
    expect(log).toContain("overlay recycling polls=2")
  })

  it.if(process.platform === "darwin")("exits the macOS overlay when idle", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const overlayPath = path.join(path.dirname(bundledPath ?? ""), "fellowship-companion-overlay-macos.jxa")
    const statePath = path.join(testDir, "overlay-state.json")
    const logPath = path.join(testDir, "overlay.log")
    fs.writeFileSync(
      statePath,
      JSON.stringify({ version: 1, sessions: [], config: { ...DEFAULT_CONFIG.companion, enabled: true } })
    )
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", overlayPath, "opencode-companion-overlay", statePath, logPath],
      { stdio: "ignore" }
    )
    spawnedProcesses.push(child)

    expect(await waitForExit(child, 5000)).toBe(0)
    expect(fs.readFileSync(logPath, "utf8")).toContain("overlay idle, exiting")
  })

  it("formats companion agents for descriptive and LOTR themes", () => {
    expect(formatCompanionAgent("gandalf", "descriptive")).toMatchObject({
      canonical: "orchestrator",
      role: "orchestrator",
      display_name: "orchestrator",
      art_key: "descriptive/orchestrator",
      art_frame_count: 4,
      art_frame_width: 128,
      art_frame_height: 160,
    })
    expect(formatCompanionAgent("researcher", "lotr")).toMatchObject({
      canonical: "researcher",
      role: "researcher",
      display_name: "radagast",
      art_key: "lotr/radagast",
      art_frame_count: 4,
      art_frame_width: 128,
      art_frame_height: 160,
    })
    expect(formatCompanionAgent("input", "lotr")).toMatchObject({
      canonical: "input",
      display_name: "input",
      art_key: "common/input",
    })
  })

  it("ships themed art for every built-in agent name", () => {
    const artBasePath = getCompanionArtBasePath()
    expect(artBasePath).not.toBeNull()
    for (const entry of getAgentNameTable()) {
      const descriptiveArt = path.join(artBasePath ?? "", "descriptive", `${entry.themed.descriptive}.svg`)
      const lotrArt = path.join(artBasePath ?? "", "lotr", `${entry.themed.lotr}.svg`)
      expect(fs.existsSync(descriptiveArt)).toBe(true)
      expect(fs.existsSync(lotrArt)).toBe(true)
      expect(fs.readFileSync(descriptiveArt, "utf8")).toContain('viewBox="0 0 512 160"')
      expect(fs.readFileSync(lotrArt, "utf8")).toContain('viewBox="0 0 512 160"')
    }
    for (const name of ["intro", "input", "unknown"]) {
      const artPath = path.join(artBasePath ?? "", "common", `${name}.svg`)
      expect(fs.existsSync(artPath)).toBe(true)
      expect(fs.readFileSync(artPath, "utf8")).toContain('viewBox="0 0 512 160"')
    }
  })

  it("bakes agent names into SNES-style sprite sheets", () => {
    const artBasePath = getCompanionArtBasePath()
    expect(artBasePath).not.toBeNull()
    const gandalfArt = fs.readFileSync(path.join(artBasePath ?? "", "lotr", "gandalf.svg"), "utf8")
    expect(gandalfArt).toContain('viewBox="0 0 512 160"')
    expect(gandalfArt).toContain(">GANDALF<")
    expect(gandalfArt).toContain("YOU SHALL NOT FAIL")
    expect(gandalfArt.match(/transform="translate\(/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it("writes session activity state without requiring a binary", () => {
    const manager = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
      position: "top-left",
      speed: 2,
    }, { agentNameTheme: "lotr" })

    manager.onLoad()
    manager.onSessionStatus({ sessionID: "child-1", agent: "legolas", status: "busy" })
    manager.onWaitingInput()

    const state = readCompanionState()
    expect(state.config.position).toBe("top-left")
    expect(state.config.speed).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]).toMatchObject({
      session_id: "session-1",
      cwd: "/repo",
      active_agents: ["legolas"],
      status: "waiting-input",
      pid: process.pid,
    })
    expect(state.sessions[0].active_agent_details[0]).toMatchObject({
      canonical: "explorer",
      role: "explorer",
      display_name: "legolas",
      art_key: "lotr/legolas",
    })
    expect(state.config.agentNameTheme).toBe("lotr")
    expect(state.config.artBasePath?.endsWith(path.join("companion", "art"))).toBe(true)

    manager.onSessionStatus({ sessionID: "child-1", agent: "legolas", status: "idle" })
    manager.onInputResolved()
    expect(readCompanionState().sessions[0].active_agents).toEqual(["intro"])

    manager.onExit()
    expect(readCompanionState().sessions).toEqual([])
  })

  it("does not let a superseded manager remove the replacement session", () => {
    const config = {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    }
    const first = new CompanionManager("session-reload", "/repo", config)
    const second = new CompanionManager("session-reload", "/repo", config)

    first.onLoad()
    second.onLoad()
    first.onExit()

    expect(readCompanionState().sessions.map((session) => session.session_id)).toEqual(["session-reload"])
    second.onExit()
  })

  it("tracks V2 context activity until the session becomes idle", () => {
    const manager = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    })
    const tracker = new CompanionActivityTracker(manager)
    manager.onLoad()

    tracker.onContext({ sessionID: "child-1", agent: "explorer" })
    expect(readCompanionState().sessions[0]).toMatchObject({
      active_agents: ["explorer"],
      status: "idle",
    })

    tracker.onEvent({ type: "question.asked", data: { sessionID: "child-1" } })
    expect(readCompanionState().sessions[0]).toMatchObject({
      active_agents: ["explorer"],
      status: "waiting-input",
    })

    tracker.onEvent({
      type: "session.status",
      data: { sessionID: "child-1", status: { type: "idle" } },
    })
    expect(readCompanionState().sessions[0]).toMatchObject({
      active_agents: ["input"],
      status: "waiting-input",
    })

    tracker.onEvent({ type: "question.replied", data: { sessionID: "child-1" } })
    expect(readCompanionState().sessions[0]).toMatchObject({
      active_agents: ["intro"],
      status: "idle",
    })

    manager.onExit()
  })

  it("tracks a complete V2 execution until it succeeds without treating step end as idle", () => {
    const manager = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    })
    const tracker = new CompanionActivityTracker(manager)
    manager.onLoad()

    tracker.onEvent({ type: "session.execution.started", data: { sessionID: "child-1" } })
    tracker.onEvent({
      type: "session.step.started",
      properties: null,
      data: { sessionID: "child-1", agent: "researcher" },
    })
    expect(readCompanionState().sessions[0].active_agents).toEqual(["researcher"])

    tracker.onEvent({
      type: "session.step.ended",
      data: { sessionID: "child-1", finish: "tool-calls" },
    })
    expect(readCompanionState().sessions[0].active_agents).toEqual(["researcher"])

    tracker.onEvent({
      type: "session.step.started",
      data: { sessionID: "child-1", agent: "researcher" },
    })
    tracker.onEvent({
      type: "session.step.ended",
      data: { sessionID: "child-1", finish: "stop" },
    })
    expect(readCompanionState().sessions[0].active_agents).toEqual(["researcher"])

    tracker.onEvent({ type: "session.execution.succeeded", data: { sessionID: "child-1" } })
    expect(readCompanionState().sessions[0]).toMatchObject({
      active_agents: ["intro"],
      status: "idle",
    })

    tracker.onEvent({ type: "session.step.started", data: { sessionID: "child-2", agent: "explorer" } })
    tracker.onEvent({ type: "session.deleted", data: { info: { id: "child-2" } } })
    expect(readCompanionState().sessions[0].active_agents).toEqual(["intro"])

    manager.onExit()
  })

  it("clears activity for failed and interrupted V2 executions", () => {
    const manager = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    })
    const tracker = new CompanionActivityTracker(manager)
    manager.onLoad()

    for (const terminalType of ["session.execution.failed", "session.execution.interrupted"]) {
      tracker.onEvent({ type: "session.step.started", data: { sessionID: "child-1", agent: "researcher" } })
      expect(readCompanionState().sessions[0].active_agents).toEqual(["researcher"])
      tracker.onEvent({ type: terminalType, data: { sessionID: "child-1" } })
      expect(readCompanionState().sessions[0]).toMatchObject({
        active_agents: ["intro"],
        status: "idle",
      })
    }

    manager.onExit()
  })

  it("removes stale session state when disabled", () => {
    const enabled = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    })
    enabled.onLoad()
    expect(readCompanionState().sessions).toHaveLength(1)

    const disabled = new CompanionManager("session-1", "/repo", DEFAULT_CONFIG.companion)
    disabled.onLoad()
    expect(readCompanionState().sessions).toEqual([])
  })

  it("prunes state owned by dead processes", () => {
    const statePath = getCompanionStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [{ session_id: "stale", pid: 2147483647 }],
        config: normalizeCompanionConfig({ enabled: true }),
      })
    )

    const manager = new CompanionManager("session-1", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: path.join(testDir, "missing-companion"),
    })
    manager.onLoad()

    expect(readCompanionState().sessions.map((session) => session.session_id)).toEqual(["session-1"])
    manager.onExit()
  })

  it("bundled companion binary watches state and writes runtime summary", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    const statePath = getCompanionStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [
          {
            session_id: "session-1",
            cwd: "/repo",
            active_agents: ["radagast"],
            active_agent_details: [formatCompanionAgent("radagast", "lotr")],
            status: "busy",
            pid: process.pid,
            updated_at: new Date().toISOString(),
            config: { ...DEFAULT_CONFIG.companion, enabled: true, debug: false, speed: 4, agentNameTheme: "lotr", artBasePath: getCompanionArtBasePath() },
          },
        ],
        config: { ...DEFAULT_CONFIG.companion, enabled: true, debug: false, speed: 4, agentNameTheme: "lotr", artBasePath: getCompanionArtBasePath() },
      })
    )

    const child = spawn(bundledPath ?? "", [], {
      env: {
        ...process.env,
        FELLOWSHIP_COMPANION_SESSION_ID: "session-1",
        FELLOWSHIP_COMPANION_STATE_PATH: statePath,
        FELLOWSHIP_COMPANION_DISABLE_OVERLAY: "1",
      },
      stdio: "ignore",
    })
    spawnedProcesses.push(child)

    const runtimePath = path.join(path.dirname(statePath), "opencode-config.companion-runtime.json")
    await waitForFile(runtimePath)
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as Record<string, unknown>
    expect(runtime).toMatchObject({
      version: 1,
      launcher_session_id: "session-1",
      status: "busy",
      active_agents: ["radagast"],
      session_count: 1,
      state_path: statePath,
    })
    expect(runtime.active_agent_details).toEqual([
      expect.objectContaining({ canonical: "researcher", display_name: "radagast", art_key: "lotr/radagast" }),
    ])
    expect((runtime.config as Record<string, unknown>).agentNameTheme).toBe("lotr")
  })

  it("bundled companion ignores dead sessions while live sessions are idle", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    const statePath = getCompanionStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [
          { session_id: "session-1", status: "idle", pid: process.pid, active_agents: ["intro"] },
          { session_id: "stale", status: "busy", pid: 2147483647, active_agents: ["gandalf"] },
        ],
        config: { ...DEFAULT_CONFIG.companion, enabled: true, speed: 4 },
      })
    )

    const child = spawn(bundledPath ?? "", [], {
      env: { ...process.env, FELLOWSHIP_COMPANION_STATE_PATH: statePath, FELLOWSHIP_COMPANION_DISABLE_OVERLAY: "1" },
      stdio: "ignore",
    })
    spawnedProcesses.push(child)

    const runtimePath = path.join(path.dirname(statePath), "opencode-config.companion-runtime.json")
    await waitForFile(runtimePath)
    expect(JSON.parse(fs.readFileSync(runtimePath, "utf8"))).toMatchObject({ status: "idle", session_count: 1 })
    expect(child.exitCode).toBeNull()
  })

  it("bundled companion runtime preserves multiple active agents for stacked tiles", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    const statePath = getCompanionStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [
          {
            session_id: "session-1",
            cwd: "/repo",
            active_agents: ["legolas", "legolas"],
            status: "busy",
            pid: process.pid,
            updated_at: new Date().toISOString(),
          },
          {
            session_id: "session-2",
            cwd: "/repo",
            active_agents: ["radagast"],
            status: "busy",
            pid: process.pid,
            updated_at: new Date().toISOString(),
          },
        ],
        config: { ...DEFAULT_CONFIG.companion, enabled: true, debug: false, speed: 4, agentNameTheme: "lotr", artBasePath: getCompanionArtBasePath() },
      })
    )

    const child = spawn(bundledPath ?? "", [], {
      env: {
        ...process.env,
        FELLOWSHIP_COMPANION_SESSION_ID: "session-1",
        FELLOWSHIP_COMPANION_STATE_PATH: statePath,
        FELLOWSHIP_COMPANION_DISABLE_OVERLAY: "1",
      },
      stdio: "ignore",
    })
    spawnedProcesses.push(child)

    const runtimePath = path.join(path.dirname(statePath), "opencode-config.companion-runtime.json")
    await waitForFile(runtimePath)
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as Record<string, unknown>
    expect(runtime).toMatchObject({
      status: "busy",
      active_agents: ["legolas", "radagast"],
      session_count: 2,
    })
    expect(runtime.active_agent_details).toEqual([
      expect.objectContaining({ canonical: "explorer", display_name: "legolas", art_key: "lotr/legolas" }),
      expect.objectContaining({ canonical: "researcher", display_name: "radagast", art_key: "lotr/radagast" }),
    ])
  })

  it("bundled companion runtime keeps active agents visible while waiting for input", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    const statePath = getCompanionStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        sessions: [
          {
            session_id: "session-1",
            cwd: "/repo",
            active_agents: ["legolas", "radagast"],
            status: "waiting-input",
            pid: process.pid,
            updated_at: new Date().toISOString(),
          },
          {
            session_id: "session-2",
            cwd: "/other-repo",
            active_agents: ["intro"],
            status: "idle",
            pid: process.pid,
            updated_at: new Date().toISOString(),
          },
        ],
        config: { ...DEFAULT_CONFIG.companion, enabled: true, debug: false, speed: 4, agentNameTheme: "lotr", artBasePath: getCompanionArtBasePath() },
      })
    )

    const child = spawn(bundledPath ?? "", [], {
      env: {
        ...process.env,
        FELLOWSHIP_COMPANION_SESSION_ID: "session-1",
        FELLOWSHIP_COMPANION_STATE_PATH: statePath,
        FELLOWSHIP_COMPANION_DISABLE_OVERLAY: "1",
      },
      stdio: "ignore",
    })
    spawnedProcesses.push(child)

    const runtimePath = path.join(path.dirname(statePath), "opencode-config.companion-runtime.json")
    await waitForFile(runtimePath)
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as Record<string, unknown>
    expect(runtime).toMatchObject({
      status: "waiting-input",
      active_agents: ["input", "legolas", "radagast"],
      session_count: 2,
    })
    expect(runtime.active_agent_details).toEqual([
      expect.objectContaining({ canonical: "input", display_name: "input", art_key: "common/input" }),
      expect.objectContaining({ canonical: "explorer", display_name: "legolas", art_key: "lotr/legolas" }),
      expect.objectContaining({ canonical: "researcher", display_name: "radagast", art_key: "lotr/radagast" }),
    ])
  })

  it("replaces a companion started from an older binary and records the new spawn", async () => {
    const bundledPath = getBundledCompanionBinaryPath()
    expect(bundledPath).not.toBeNull()
    const oldDir = path.join(testDir, "old-companion")
    fs.cpSync(path.dirname(bundledPath ?? ""), oldDir, { recursive: true })
    const oldBinaryPath = path.join(oldDir, "fellowship-companion")
    const oldProcess = spawn(oldBinaryPath, [], {
      detached: true,
      env: { ...process.env, FELLOWSHIP_COMPANION_STATE_PATH: getCompanionStatePath(), FELLOWSHIP_COMPANION_DISABLE_OVERLAY: "1" },
      stdio: "ignore",
    })
    spawnedProcesses.push(oldProcess)
    await waitForFile(path.join(path.dirname(getCompanionStatePath()), "opencode-config.companion-runtime.json"))
    fs.mkdirSync(path.dirname(getCompanionPidPath()), { recursive: true })
    fs.writeFileSync(getCompanionPidPath(), String(oldProcess.pid))

    const manager = new CompanionManager("replacement", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: bundledPath ?? "",
    })
    manager.onLoad()

    expect(await waitForExit(oldProcess, 5000)).toBe(0)
    const newPid = Number(fs.readFileSync(getCompanionPidPath(), "utf8").trim())
    expect(newPid).not.toBe(oldProcess.pid)
    expect(JSON.parse(fs.readFileSync(getCompanionSpawnRecordPath(), "utf8"))).toMatchObject({
      pid: newPid,
      binaryPath: bundledPath,
      pluginVersion: getPluginVersion(),
    })
    manager.onExit()
    expect(fs.existsSync(getCompanionPidPath())).toBe(false)
    expect(fs.existsSync(getCompanionSpawnRecordPath())).toBe(false)
  })

  it("does not signal a reused PID belonging to an unrelated process", async () => {
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" })
    spawnedProcesses.push(unrelated)
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.mkdirSync(path.dirname(getCompanionPidPath()), { recursive: true })
    fs.writeFileSync(getCompanionPidPath(), String(unrelated.pid))

    const manager = new CompanionManager("reused-pid", "/repo", {
      ...DEFAULT_CONFIG.companion,
      enabled: true,
      binaryPath: getBundledCompanionBinaryPath() ?? "",
    })
    manager.onLoad()
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(unrelated.exitCode).toBeNull()
    expect(unrelated.signalCode).toBeNull()
    expect(Number(fs.readFileSync(getCompanionPidPath(), "utf8").trim())).not.toBe(unrelated.pid)
    manager.onExit()
  })

  it("reuses a companion across manager loads", () => {
    const config = { ...DEFAULT_CONFIG.companion, enabled: true, binaryPath: getBundledCompanionBinaryPath() ?? "" }
    const first = new CompanionManager("first-manager", "/repo", config)
    first.onLoad()
    const firstPid = fs.readFileSync(getCompanionPidPath(), "utf8").trim()

    const second = new CompanionManager("second-manager", "/repo", config)
    second.onLoad()

    expect(fs.readFileSync(getCompanionPidPath(), "utf8").trim()).toBe(firstPid)
    second.onExit()
    first.onExit()
    expect(fs.existsSync(getCompanionPidPath())).toBe(false)
  })
})

async function waitForFile(filePath: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    if (fs.existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

/** Each test has its own storage dir, so a PID in its PID file belongs to a companion that test started. */
function stopTestCompanion(): void {
  const pidPath = getCompanionPidPath()
  if (!fs.existsSync(pidPath)) return
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim())
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return
  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out waiting ${timeoutMs}ms for child process to exit`))
    }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}
