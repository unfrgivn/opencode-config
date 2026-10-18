import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

type SpawnResult = { status: number; stdout?: string; stderr?: string }

// Tracks which tmux sessions and windows exist in the mock.
// Sessions are created by new-session, windows by new-window.
// kill-window removes a window, kill-session removes a session.
// has-session checks if a session exists.
function createTmuxSpawnMock(options?: {
  missingWindowIDs?: Set<string>
  commandLog?: string[][]
}): (cmd: string, args: string[]) => SpawnResult {
  let windowCounter = 0
  let paneCounter = 0
  const sessions = new Set<string>()
  const missingWindowIDs = options?.missingWindowIDs ?? new Set<string>()

  return (cmd: string, args: string[]): SpawnResult => {
    options?.commandLog?.push([cmd, ...args])
    if (cmd !== "tmux") {
      return { status: 1, stderr: "unsupported command" }
    }

    if (args[0] === "-V") {
      return { status: 0, stdout: "tmux 3.6\n", stderr: "" }
    }

    if (args[0] === "new-session") {
      const sIdx = args.indexOf("-s")
      const sessionName = sIdx >= 0 ? args[sIdx + 1] : undefined
      if (sessionName) sessions.add(sessionName)
      return { status: 0, stdout: "", stderr: "" }
    }

    if (args[0] === "has-session") {
      const tIdx = args.indexOf("-t")
      const sessionName = tIdx >= 0 ? args[tIdx + 1] : undefined
      if (sessionName && sessions.has(sessionName)) {
        return { status: 0, stdout: "", stderr: "" }
      }
      return { status: 1, stdout: "", stderr: "session not found" }
    }

    if (args[0] === "new-window") {
      windowCounter += 1
      const windowID = `@${windowCounter}`
      return { status: 0, stdout: `${windowID}\n`, stderr: "" }
    }

    if (args[0] === "split-window") {
      paneCounter += 1
      const paneID = `%${paneCounter}`
      return { status: 0, stdout: `${paneID}\n`, stderr: "" }
    }

    if (args[0] === "kill-window") {
      return { status: 0, stdout: "", stderr: "" }
    }

    if (args[0] === "kill-pane") {
      return { status: 0, stdout: "", stderr: "" }
    }

    if (args[0] === "kill-session") {
      const tIdx = args.indexOf("-t")
      const sessionName = tIdx >= 0 ? args[tIdx + 1] : undefined
      if (sessionName) sessions.delete(sessionName)
      return { status: 0, stdout: "", stderr: "" }
    }

    // display-message for window verification
    if (args[0] === "display-message" && args[1] === "-p" && args[2] === "#{session_name}") {
      return { status: 0, stdout: "mock-session\n", stderr: "" }
    }

    if (args[0] === "display-message" && args[1] === "-p" && args[2] === "-t") {
      const windowID = args[3] ?? ""
      if (missingWindowIDs.has(windowID)) {
        return { status: 1, stdout: "", stderr: "can't find window" }
      }
      return { status: 0, stdout: `${windowID}\n`, stderr: "" }
    }

    return { status: 0, stdout: "", stderr: "" }
  }
}

function createNoTmuxBinarySpawnMock(): (cmd: string, args: string[]) => SpawnResult {
  return (cmd: string, args: string[]): SpawnResult => {
    if (cmd !== "tmux") return { status: 1, stderr: "unsupported command" }
    if (args[0] === "-V") return { status: 1, stdout: "", stderr: "tmux not found" }
    return { status: 0, stdout: "", stderr: "" }
  }
}

async function loadPluginWithMock(spawnSyncImpl: (cmd: string, args: string[]) => SpawnResult) {
  mock.module("node:child_process", () => ({
    spawnSync: spawnSyncImpl,
  }))
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const mod = await import(`./orchestration-plugin.ts?test=${unique}`)
  return mod.FellowshipOrchestrationPluginHooks
}

describe("fellowship-orchestration tmux runtime", () => {
  let tempDir: string
  let originalCwd: string
  let originalHome: string | undefined
  let originalTmux: string | undefined
  let originalFellowshipPreset: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestration-plugin-test-"))
    originalCwd = process.cwd()
    originalHome = process.env.HOME
    originalTmux = process.env.TMUX
    originalFellowshipPreset = process.env.FELLOWSHIP_PRESET
    process.chdir(tempDir)
    process.env.HOME = tempDir
    process.env.TMUX = "mock-session"

    fs.mkdirSync(path.join(tempDir, ".opencode"), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          tmux: {
            enabled: true,
            sessionPrefix: "fellowship",
          },
        },
      }),
    )
  })

  afterEach(() => {
    mock.restore()
    process.chdir(originalCwd)
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalTmux === undefined) {
      delete process.env.TMUX
    } else {
      process.env.TMUX = originalTmux
    }
    if (originalFellowshipPreset === undefined) {
      delete process.env.FELLOWSHIP_PRESET
    } else {
      process.env.FELLOWSHIP_PRESET = originalFellowshipPreset
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("creates dedicated tmux session and window for first task", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-first", callID: "call-1" },
      { args: { description: "first task", category: "quick" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-first" },
    )

    expect(tasksOutput).toContain("# Background Job Board")
    expect(tasksOutput).toContain("total=1 active=1/3")
    expect(tasksOutput).toContain("running=1")
    expect(tasksOutput).toContain("next=qck-1 [running] first task")
    expect(tasksOutput).toContain("# Task Lanes")
    expect(tasksOutput).toContain("- qck-1 ")
    expect(tasksOutput).toContain("tmux=attached")
    expect(tasksOutput).toContain("agentSession=fellowship-")
    expect(tasksOutput).toContain("windows=1")
  })

  test("creates multiple windows in same session for concurrent tasks", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-multi", callID: "call-1" },
      { args: { description: "first task", category: "quick" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-multi", callID: "call-2" },
      { args: { description: "second task", category: "quick" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-multi" },
    )

    // Both tasks should be attached (no capacity limit on windows)
    const attachedMatches = tasksOutput.match(/tmux=attached/g) ?? []
    expect(attachedMatches.length).toBe(2)
    expect(tasksOutput).toContain("windows=2")
  })

  test("supports slim-style tmux pane layout settings", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          tmux: {
            enabled: true,
            mode: "pane",
            layout: "main-vertical",
            mainPaneSize: 60,
          },
        },
      }),
    )
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-pane", callID: "call-1" },
      { args: { description: "pane task", category: "quick" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-pane" },
    )

    expect(tasksOutput).toContain("tmux=attached")
    expect(tasksOutput).toContain("mode=pane")
    expect(tasksOutput).toContain("layout=main-vertical")
    expect(tasksOutput).toContain("mainPaneSize=60")
    expect(commandLog.some((command) => command[1] === "split-window")).toBe(true)
    expect(commandLog.some((command) => command.includes("select-layout") && command.includes("main-vertical"))).toBe(true)
    expect(commandLog.some((command) => command.includes("set-window-option") && command.includes("main-pane-width") && command.includes("60%"))).toBe(true)
  })

  test("attaches tmux task panes to the authoritative child session", async () => {
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-parent", callID: "call-child" },
      { args: { description: "child work", category: "quick" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-parent", callID: "call-child" },
      { output: "Task ID: ses_child" },
    )

    expect(commandLog.some((command) => (
      command.includes("send-keys") &&
      command.some((argument) => argument.includes("opencode2") && argument.includes("ses_child"))
    ))).toBe(true)
  })

  test("marks attached window as failed when reconciliation detects missing window", async () => {
    const missingWindowIDs = new Set<string>(["@1"])
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ missingWindowIDs }))
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-missing", callID: "call-a" },
      { args: { description: "missing window task", category: "quick" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-missing" },
    )

    expect(tasksOutput).toContain("missingDetected=1")
    expect(tasksOutput).toContain("tmux=failed")
  })

  test("tmux reconciliation closes windows for interrupted tasks", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { recovery: { autoResumeOnStart: false }, tmux: { enabled: true } } }),
    )
    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    const stamp = new Date().toISOString()
    fs.writeFileSync(path.join(persistedDir, "sess-interrupted-window.json"), JSON.stringify([{
      id: "tsk_interrupted_window",
      sessionID: "sess-interrupted-window",
      title: "interrupted window",
      agent: "agent:explorer",
      category: null,
      status: "interrupted",
      provider: "copilot",
      ownerPid: null,
      ownerInstanceID: null,
      createdAt: stamp,
      startedAt: stamp,
      terminalAt: stamp,
      updatedAt: stamp,
      backgroundTaskID: null,
      details: "interrupted",
      failureReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: "@9",
      tmuxSessionName: "fellowship-old",
      tmuxState: "attached",
    }]))
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))
    const plugin = await pluginFactory()

    await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-interrupted-window" },
    )

    expect(commandLog).toContainEqual(["tmux", "kill-window", "-t", "@9"])
  })

  test("stop cleans up windows and destroys agent session", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-stop", callID: "call-1" },
      { args: { description: "first task", category: "quick" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-stop", callID: "call-2" },
      { args: { description: "second task", category: "quick" } },
    )

    const stopOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "stop" },
      { sessionID: "sess-stop" },
    )
    expect(stopOutput).toContain("halted")

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-stop" },
    )

    expect(tasksOutput).not.toContain("tmux=attached")
    expect(tasksOutput).toContain("[stopped]")
    // Agent session should be destroyed
    expect(tasksOutput).toContain("agentSession=none")
  })

  test("disables tmux task state and warns once when tmux binary is missing", async () => {
    const pluginFactory = await loadPluginWithMock(createNoTmuxBinarySpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-no-tmux", callID: "call-1" },
      { args: { description: "first no tmux", category: "quick" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-no-tmux", callID: "call-2" },
      { args: { description: "second no tmux", category: "quick" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-no-tmux" },
    )

    expect(tasksOutput).toContain("tmux=disabled")
    expect(tasksOutput).toContain("Tmux integration disabled for this session")
    expect(tasksOutput.match(/Tmux integration disabled for this session/g)?.length ?? 0).toBe(1)
  })

  test("rejects category cap overflow before creating a fake queued record", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrent: 5 },
          categories: { maxConcurrent: { quick: 1 } },
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-category-limit", callID: "call-1" },
      { args: { description: "quick one", category: "quick" } },
    )
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-category-limit", callID: "call-2" },
      { args: { description: "quick two", category: "quick" } },
    )).rejects.toThrow("quick category active cap reached (1/1)")

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-category-limit" },
    )

    expect(tasksOutput).toContain("category=quick")
    expect(tasksOutput).toContain("queued=0")
    expect(tasksOutput).toContain("running=1")
    expect(tasksOutput).not.toContain("quick two")
    expect(tasksOutput).not.toContain("[queued]")
    expect(tasksOutput).toContain("[running]")
  })

  test("completed historical tasks do not block future delegation", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrent: 1, maxConcurrentGlobal: 1 },
          tmux: { enabled: false },
        },
      }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    for (let index = 1; index <= 9; index += 1) {
      const callID = `call-${index}`
      await plugin["tool.execute.before"](
        { tool: "task", sessionID: "sess-history", callID },
        { args: { description: `historical task ${index}` } },
      )
      await plugin["tool.execute.after"](
        { tool: "task", sessionID: "sess-history", callID },
        { output: "finished successfully" },
      )
    }

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-history", callID: "call-10" },
      { args: { description: "new task after completed history" } },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-history" },
    )
    expect(tasksOutput).toContain("completed=9")
    expect(tasksOutput).toContain("running=1")
    expect(tasksOutput).toContain("new task after completed history")
  })

  test("enforces the shared global cap across plugin instances and sessions", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrent: 3, maxConcurrentGlobal: 1 },
          tmux: { enabled: false },
        },
      }),
    )
    const firstFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const first = await firstFactory()
    const secondFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const second = await secondFactory()

    await first["tool.execute.before"](
      { tool: "task", sessionID: "sess-global-a", callID: "call-a" },
      { args: { description: "occupies shared capacity" } },
    )

    await expect(second["tool.execute.before"](
      { tool: "task", sessionID: "sess-global-b", callID: "call-b" },
      { args: { description: "must not launch" } },
    )).rejects.toThrow("shared global active cap reached (1/1)")
    expect(fs.existsSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-tasks",
      "sess-global-b.json",
    ))).toBe(false)
  })

  test("serializes simultaneous cross-instance admission through the filesystem lock", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const firstFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const first = await firstFactory()
    const secondFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const second = await secondFactory()

    const results = await Promise.allSettled([
      first["tool.execute.before"](
        { tool: "task", sessionID: "sess-race-a", callID: "call-race-a" },
        { args: { description: "racer a" } },
      ),
      second["tool.execute.before"](
        { tool: "task", sessionID: "sess-race-b", callID: "call-race-b" },
        { args: { description: "racer b" } },
      ),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const taskDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    expect(fs.readdirSync(taskDir).filter((file) => file.endsWith(".json"))).toHaveLength(1)
  })

  test("recovers a stale admission lock with missing owner metadata", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { tmux: { enabled: false } } }),
    )
    const lockDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-admission.lock")
    fs.mkdirSync(lockDir, { recursive: true })
    const stale = new Date(Date.now() - 60_000)
    fs.utimesSync(lockDir, stale, stale)
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-stale-missing-lock-owner" },
    )

    expect(output).toContain("sharedActive=0/5")
    expect(fs.existsSync(lockDir)).toBe(false)
  })

  test("recovers a stale admission lock with corrupt owner metadata", async () => {
    const lockDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-admission.lock")
    fs.mkdirSync(lockDir, { recursive: true })
    fs.writeFileSync(path.join(lockDir, "owner.json"), "not-json")
    const stale = new Date(Date.now() - 60_000)
    fs.utimesSync(lockDir, stale, stale)
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-stale-corrupt-lock-owner" },
    )

    expect(output).toContain("sharedActive=0/5")
  })

  test("recovers an admission lock owned by a dead process", async () => {
    const lockDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-admission.lock")
    fs.mkdirSync(lockDir, { recursive: true })
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 2_147_483_647 }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-dead-lock-owner" },
    )

    expect(output).toContain("sharedActive=0/5")
  })

  test("recovers a stale admission lock even when its PID is live", async () => {
    const lockDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-admission.lock")
    fs.mkdirSync(lockDir, { recursive: true })
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
      pid: process.pid,
      instanceID: "abandoned",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-stale-live-lock-owner" },
    )

    expect(output).toContain("sharedActive=0/5")
  })

  test("does not steal a fresh admission lock", async () => {
    const lockDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-admission.lock")
    fs.mkdirSync(lockDir, { recursive: true })
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, instanceID: "active" }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await expect(plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-fresh-lock-owner" },
    )).rejects.toThrow("Delegation admission is busy")
    expect(fs.existsSync(lockDir)).toBe(true)
  })

  test("rethrows a protected-operation EEXIST unchanged after releasing its admission lock", async () => {
    const cacheDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    const ownerLeasePath = path.join(cacheDir, "orchestration-owner-leases")
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(ownerLeasePath, "blocks owner lease directory creation")
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    let protectedOperationError: unknown
    try {
      await plugin["tool.execute.before"](
        { tool: "task", sessionID: "sess-operation-eexist", callID: "call-operation-eexist" },
        { args: { description: "fails while creating its owner lease" } },
      )
    } catch (error) {
      protectedOperationError = error
    }

    expect(protectedOperationError).toBeInstanceOf(Error)
    expect(protectedOperationError).toMatchObject({ code: "EEXIST" })
    expect(fs.existsSync(path.join(
      cacheDir,
      "orchestration-admission.lock",
    ))).toBe(false)
  })

  test("completion releases shared admission capacity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const firstFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const first = await firstFactory()
    const secondFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const second = await secondFactory()
    await first["tool.execute.before"](
      { tool: "task", sessionID: "sess-release-a", callID: "call-a" },
      { args: { description: "finishes" } },
    )

    await first["tool.execute.after"](
      { tool: "task", sessionID: "sess-release-a", callID: "call-a" },
      { output: "finished successfully" },
    )
    await second["tool.execute.before"](
      { tool: "task", sessionID: "sess-release-b", callID: "call-b" },
      { args: { description: "uses released capacity" } },
    )

    const output = await second.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-release-b" },
    )
    expect(output).toContain("uses released capacity")
  })

  test("enforces an optional provider-specific cap", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrentGlobal: 3, providerMaxConcurrent: { native: 1 } },
          categories: { routing: { quick: "native" } },
          tmux: { enabled: false },
        },
      }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-provider-a", callID: "call-a" },
      { args: { description: "native one", category: "quick" } },
    )

    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-provider-b", callID: "call-b" },
      { args: { description: "native two", category: "quick" } },
    )).rejects.toThrow("native provider active cap reached (1/1)")
  })

  test("429 failures establish provider cooldown and reduce effective capacity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrentGlobal: 3 },
          runtimeFallback: { cooldownSeconds: 60, retryOnErrors: [429, 503] },
          tmux: { enabled: false },
        },
      }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-cooldown-a", callID: "call-a" },
      { args: { description: "congested" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-cooldown-a", callID: "call-a" },
      { output: "Task failed with 429 too many requests" },
    )

    const state = JSON.parse(fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-provider-state.json",
    ), "utf-8")) as { providers: { copilot: { effectiveMaxConcurrent: number; cooldownUntil: string | null } } }
    expect(state.providers.copilot.effectiveMaxConcurrent).toBe(2)
    expect(Date.parse(state.providers.copilot.cooldownUntil ?? "")).toBeGreaterThan(Date.now())
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-cooldown-b", callID: "call-b" },
      { args: { description: "blocked during cooldown" } },
    )).rejects.toThrow("copilot provider cooldown is active")
  })

  test("503 failures also trigger shared provider backpressure", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrentGlobal: 3 },
          runtimeFallback: { cooldownSeconds: 30, retryOnErrors: [503] },
          tmux: { enabled: false },
        },
      }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-503", callID: "call-503" },
      { args: { description: "service unavailable" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-503", callID: "call-503" },
      { output: "503 error: service unavailable" },
    )

    const state = fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-provider-state.json",
    ), "utf-8")
    expect(state).toContain('"effectiveMaxConcurrent":2')
  })

  test("successful completion recovers provider capacity additively", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 3 }, tmux: { enabled: false } } }),
    )
    const stateDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, "orchestration-provider-state.json"), JSON.stringify({
      version: 1,
      providers: {
        copilot: { effectiveMaxConcurrent: 1, cooldownUntil: "2020-01-01T00:00:00.000Z", congestionFailures: 1, successfulCompletions: 0 },
        native: { effectiveMaxConcurrent: 3, cooldownUntil: null, congestionFailures: 0, successfulCompletions: 0 },
      },
    }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-recovery", callID: "call-recovery" },
      { args: { description: "successful probe" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-recovery", callID: "call-recovery" },
      { output: "completed successfully" },
    )

    const state = JSON.parse(fs.readFileSync(path.join(stateDir, "orchestration-provider-state.json"), "utf-8")) as {
      providers: { copilot: { effectiveMaxConcurrent: number; successfulCompletions: number } }
    }
    expect(state.providers.copilot.effectiveMaxConcurrent).toBe(2)
    expect(state.providers.copilot.successfulCompletions).toBe(1)
  })

  test("disabled runtime fallback ignores persisted adaptive provider backpressure", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrent: 3, maxConcurrentGlobal: 3, providerMaxConcurrent: { copilot: 2 } },
          runtimeFallback: { enabled: false },
          tmux: { enabled: false },
        },
      }),
    )
    const stateDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, "orchestration-provider-state.json"), JSON.stringify({
      version: 1,
      providers: {
        copilot: {
          effectiveMaxConcurrent: 1,
          cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
          congestionFailures: 2,
          successfulCompletions: 0,
        },
        native: { effectiveMaxConcurrent: 3, cooldownUntil: null, congestionFailures: 0, successfulCompletions: 0 },
      },
    }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-static-provider", callID: "call-static-1" },
      { args: { description: "first static task" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-static-provider", callID: "call-static-2" },
      { args: { description: "second static task" } },
    )
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-static-provider", callID: "call-static-3" },
      { args: { description: "over static cap" } },
    )).rejects.toThrow("copilot provider active cap reached (2/2)")
  })

  test("tasks reports truthful shared provider capacity and cooldown", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { maxConcurrentGlobal: 3, providerMaxConcurrent: { copilot: 2 } },
          tmux: { enabled: false },
        },
      }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-capacity", callID: "call-capacity" },
      { args: { description: "capacity task" } },
    )

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-capacity" },
    )

    expect(output).toContain("sharedActive=1/3")
    expect(output).toContain("copilot active=1 effective=2 configured=2 cooldown=none")
  })

  test("diagnostics reports shared admission limits", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 4 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-diagnostic-capacity" },
    )

    expect(output).toContain("Active delegated tasks: 0/3")
    expect(output).toContain("sharedActive=0/4")
  })

  test("tasks reports shared capacity before the session delegates", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 3 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-empty-capacity" },
    )

    expect(output).toContain("No tracked subagent tasks for this session yet.")
    expect(output).toContain("sharedActive=0/3")
  })

  test("applies category routing override to tracked provider details", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          providerMode: "copilot",
          categories: { routing: { quick: "native" } },
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-routing", callID: "call-routing" },
      { args: { description: "route me", category: "quick" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-routing", callID: "call-routing" },
      { output: "Task ID: bg-quick-1" },
    )

    const taskOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "bg-quick-1" },
      { sessionID: "sess-routing" },
    )

    expect(taskOutput).toContain("- Alias: qck-1")
    expect(taskOutput).toContain("- Category: quick")
    expect(taskOutput).toContain("provider=native")

    const aliasOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "qck-1" },
      { sessionID: "sess-routing" },
    )

    expect(aliasOutput).toContain("- Background ID: bg-quick-1")
  })

  test("persists structured background child metadata before output text fallback", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-structured-bg", callID: "call-structured-bg" },
      { args: { description: "structured background" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-structured-bg", callID: "call-structured-bg" },
      {
        output: "<task id=\"text-child\" state=\"running\">launched</task>",
        metadata: {
          sessionId: "structured-child",
          jobId: "job-1",
          parentSessionId: "sess-structured-bg",
          background: true,
        },
      },
    )

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "structured-child" },
      { sessionID: "sess-structured-bg" },
    )
    expect(detail).toContain("- Background ID: structured-child")
    expect(detail).toContain("- Status: running")
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-blocked-by-bg", callID: "call-blocked-by-bg" },
      { args: { description: "must wait for child" } },
    )).rejects.toThrow("shared global active cap reached (1/1)")
  })

  test("parses current XML background launch output when metadata is unavailable", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-xml-bg", callID: "call-xml-bg" },
      { args: { description: "XML background" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-xml-bg", callID: "call-xml-bg" },
      { output: "<task id='child-from-xml' state='running'>Background task launched</task>" },
    )

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-from-xml" },
      { sessionID: "sess-xml-bg" },
    )
    expect(detail).toContain("- Background ID: child-from-xml")
    expect(detail).toContain("- Status: running")
  })

  test("synthetic background completion terminalizes child work and releases capacity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-synthetic-complete", callID: "call-synthetic-complete" },
      { args: { description: "background completes" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-synthetic-complete", callID: "call-synthetic-complete" },
      { output: "<task id=\"child-synthetic-complete\" state=\"running\">launched</task>" },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "synthetic-text-complete",
        sessionID: "sess-synthetic-complete",
        type: "text",
        text: "<task id='child-synthetic-complete' state='completed'>finished result</task>",
      } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-synthetic-complete" },
      { sessionID: "sess-synthetic-complete" },
    )
    expect(detail).toContain("- Status: completed")
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-after-synthetic", callID: "call-after-synthetic" },
      { args: { description: "capacity released" } },
    )
  })

  test("synthetic background error records provider outcome and closes tmux lifecycle", async () => {
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-synthetic-error", callID: "call-synthetic-error" },
      { args: { description: "background errors" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-synthetic-error", callID: "call-synthetic-error" },
      { output: "<task id=\"child-synthetic-error\" state=\"running\">launched</task>" },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "synthetic-text-error",
        sessionID: "sess-synthetic-error",
        type: "text",
        text: "<task id=\"child-synthetic-error\" state=\"error\">503 service unavailable</task>",
      } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-synthetic-error" },
      { sessionID: "sess-synthetic-error" },
    )
    expect(detail).toContain("- Status: failed")
    expect(detail).toContain("- Failure Reason: http-503")
    expect(commandLog).toContainEqual(["tmux", "kill-window", "-t", "@1"])
    const providerState = fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-provider-state.json",
    ), "utf-8")
    expect(providerState).toContain('"congestionFailures":1')
  })

  test("child session.error fails matching background work and releases capacity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: {
        limits: { maxConcurrentGlobal: 1 },
        runtimeFallback: { enabled: false },
        tmux: { enabled: false },
      } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-child-error-parent", callID: "call-child-error" },
      { args: { description: "child session errors" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-child-error-parent", callID: "call-child-error" },
      { output: "Task ID: child-session-error" },
    )

    await plugin.event({ event: {
      type: "session.error",
      properties: { sessionID: "child-session-error", error: { message: "child crashed" } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-session-error" },
      { sessionID: "sess-child-error-parent" },
    )
    expect(detail).toContain("- Status: failed")
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-after-child-error", callID: "call-after-child-error" },
      { args: { description: "capacity released" } },
    )
  })

  test("child session.idle remains observational and keeps background capacity occupied", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-child-idle-parent", callID: "call-child-idle" },
      { args: { description: "cancelled child becomes idle" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-child-idle-parent", callID: "call-child-idle" },
      { output: "Task ID: child-session-idle" },
    )

    await plugin.event({ event: {
      type: "session.idle",
      properties: { sessionID: "child-session-idle" },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-session-idle" },
      { sessionID: "sess-child-idle-parent" },
    )
    expect(detail).toContain("- Status: running")
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-after-child-idle", callID: "call-after-child-idle" },
      { args: { description: "capacity remains occupied" } },
    )).rejects.toThrow("shared global active cap reached (1/1)")
  })

  test("child session.error after idle fails background work and applies provider backpressure", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: {
        limits: { maxConcurrentGlobal: 3 },
        runtimeFallback: { retryOnErrors: [503], cooldownSeconds: 30 },
        tmux: { enabled: false },
      } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-idle-error-parent", callID: "call-idle-error" },
      { args: { description: "idles before failing" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-idle-error-parent", callID: "call-idle-error" },
      { output: "Task ID: child-idle-error" },
    )

    await plugin.event({ event: {
      type: "session.idle",
      properties: { sessionID: "child-idle-error" },
    } })
    await plugin.event({ event: {
      type: "session.error",
      properties: { sessionID: "child-idle-error", error: { message: "503 service unavailable" } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-idle-error" },
      { sessionID: "sess-idle-error-parent" },
    )
    const providerState = JSON.parse(fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-provider-state.json",
    ), "utf-8")) as { providers: { copilot: { effectiveMaxConcurrent: number; congestionFailures: number } } }
    expect(detail).toContain("- Status: failed")
    expect(detail).toContain("- Failure Reason: http-503")
    expect(providerState.providers.copilot.effectiveMaxConcurrent).toBe(2)
    expect(providerState.providers.copilot.congestionFailures).toBe(1)
  })

  test("duplicate after and terminal events do not double provider recovery or telemetry", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-duplicate-terminal", callID: "call-duplicate-terminal" },
      { args: { description: "terminal once" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-duplicate-terminal", callID: "call-duplicate-terminal" },
      { output: "completed normally" },
    )

    const sendDuplicateEvent = async (): Promise<void> => {
      await plugin.event({ event: {
        type: "message.part.updated",
        properties: { part: {
          id: "part-duplicate-terminal",
          sessionID: "sess-duplicate-terminal",
          type: "tool",
          callID: "call-duplicate-terminal",
          tool: "task",
          state: { status: "completed", output: "completed normally" },
        } },
      } })
    }
    await sendDuplicateEvent()
    await sendDuplicateEvent()

    const providerState = fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-provider-state.json",
    ), "utf-8")
    expect(providerState).toContain('"successfulCompletions":1')
    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-duplicate-terminal" },
    )
    expect(diagnostics).toContain("completed=1")
  })

  test("unrelated child session and message events do not alter tracked work", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-unrelated-parent", callID: "call-unrelated" },
      { args: { description: "must remain active" } },
    )
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-unrelated-parent", callID: "call-unrelated" },
      { output: "Task ID: actual-child" },
    )

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "different-child" } } })
    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "unrelated-text",
        sessionID: "unrelated-parent",
        type: "text",
        text: "<task id=\"different-child\" state=\"completed\">done</task>",
      } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "actual-child" },
      { sessionID: "sess-unrelated-parent" },
    )
    expect(detail).toContain("- Status: running")
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-unrelated-other", callID: "call-unrelated-other" },
      { args: { description: "capacity remains occupied" } },
    )).rejects.toThrow("shared global active cap reached (1/1)")
  })

  test("recovers a running task when its live PID has no matching owner lease", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          recovery: { autoResumeOnStart: true },
          tmux: { enabled: false },
        },
      }),
    )

    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    fs.writeFileSync(
      path.join(persistedDir, "sess-resume.json"),
      JSON.stringify([
        {
          id: "tsk_resume_1",
          sessionID: "sess-resume",
          title: "recover me",
          agent: "category:quick",
          category: "quick",
          status: "running",
          provider: "copilot",
          ownerPid: process.pid,
          ownerInstanceID: "another-live-instance",
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          terminalAt: null,
          updatedAt: new Date().toISOString(),
          backgroundTaskID: "bg-old-1",
          retries: 0,
          fallbackAttempts: 0,
          details: "old run",
          fallbackReason: null,
          blockedBy: [],
          blocks: [],
          tmuxWindowID: "@1",
          tmuxSessionName: "fellowship-old",
          tmuxState: "attached",
        },
      ]),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-resume" },
    )

    expect(tasksOutput).toContain("[interrupted]")
    expect(tasksOutput).not.toContain("[running]")
  })

  test("recovers a running task when its live PID has a mismatched owner lease", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { recovery: { autoResumeOnStart: true }, tmux: { enabled: false } } }),
    )
    const cacheDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    const persistedDir = path.join(cacheDir, "orchestration-tasks")
    const leaseDir = path.join(cacheDir, "orchestration-owner-leases")
    fs.mkdirSync(persistedDir, { recursive: true })
    fs.mkdirSync(leaseDir, { recursive: true })
    const stamp = new Date().toISOString()
    fs.writeFileSync(path.join(leaseDir, "abandoned-instance.json"), JSON.stringify({
      pid: process.pid,
      ownerInstanceID: "different-instance",
      heartbeatAt: stamp,
    }))
    fs.writeFileSync(path.join(persistedDir, "sess-mismatched-lease.json"), JSON.stringify([{
      id: "tsk_mismatched_lease",
      sessionID: "sess-mismatched-lease",
      title: "abandoned with reused pid",
      agent: "agent:explorer",
      category: null,
      status: "running",
      provider: "copilot",
      ownerPid: process.pid,
      ownerInstanceID: "abandoned-instance",
      createdAt: stamp,
      startedAt: stamp,
      terminalAt: null,
      updatedAt: stamp,
      backgroundTaskID: null,
      details: "old run",
      failureReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: null,
      tmuxSessionName: null,
      tmuxState: "disabled",
    }]))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-mismatched-lease" },
    )

    expect(output).toContain("[interrupted]")
  })

  test("recovers a running task when its live PID has a stale owner lease", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { recovery: { autoResumeOnStart: true }, tmux: { enabled: false } } }),
    )
    const cacheDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    const persistedDir = path.join(cacheDir, "orchestration-tasks")
    const leaseDir = path.join(cacheDir, "orchestration-owner-leases")
    fs.mkdirSync(persistedDir, { recursive: true })
    fs.mkdirSync(leaseDir, { recursive: true })
    const stamp = new Date().toISOString()
    fs.writeFileSync(path.join(leaseDir, "stale-instance.json"), JSON.stringify({
      pid: process.pid,
      ownerInstanceID: "stale-instance",
      heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
    }))
    fs.writeFileSync(path.join(persistedDir, "sess-stale-lease.json"), JSON.stringify([{
      id: "tsk_stale_lease",
      sessionID: "sess-stale-lease",
      title: "abandoned with stale identity",
      agent: "agent:explorer",
      category: null,
      status: "running",
      provider: "copilot",
      ownerPid: process.pid,
      ownerInstanceID: "stale-instance",
      createdAt: stamp,
      startedAt: stamp,
      terminalAt: null,
      updatedAt: stamp,
      backgroundTaskID: null,
      details: "old run",
      failureReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: null,
      tmuxSessionName: null,
      tmuxState: "disabled",
    }]))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-stale-lease" },
    )

    expect(output).toContain("[interrupted]")
  })

  test("does not time out work owned by another live plugin instance", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { taskTimeoutMs: 1000 }, tmux: { enabled: false } } }),
    )
    const firstFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const first = await firstFactory()
    await first["tool.execute.before"](
      { tool: "task", sessionID: "sess-live-timeout", callID: "call-live" },
      { args: { description: "still live" } },
    )
    const taskFile = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks", "sess-live-timeout.json")
    const records = JSON.parse(fs.readFileSync(taskFile, "utf-8")) as Array<Record<string, unknown>>
    records[0] = { ...records[0], startedAt: "2020-01-01T00:00:00.000Z" }
    fs.writeFileSync(taskFile, JSON.stringify(records))
    const secondFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const second = await secondFactory()

    const output = await second.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-live-timeout" },
    )

    expect(output).toContain("[running]")
    expect(output).not.toContain("[failed]")
  })

  test("marks backward-compatible task records without a live owner interrupted", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          recovery: { autoResumeOnStart: true },
          tmux: { enabled: false },
        },
      }),
    )

    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    // Old format with tmuxPaneID instead of tmuxWindowID
    fs.writeFileSync(
      path.join(persistedDir, "sess-migrate.json"),
      JSON.stringify([
        {
          id: "tsk_migrate_1",
          sessionID: "sess-migrate",
          title: "old format task",
          agent: "agent:explorer",
          category: null,
          status: "running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          backgroundTaskID: null,
          retries: 0,
          fallbackAttempts: 0,
          details: "old format",
          fallbackReason: null,
          blockedBy: [],
          blocks: [],
          tmuxPaneID: "%5",
          tmuxSessionName: "fellowship-old",
          tmuxState: "attached",
        },
      ]),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-migrate" },
    )

    expect(tasksOutput).toContain("[interrupted]")
    const persisted = fs.readFileSync(path.join(persistedDir, "sess-migrate.json"), "utf-8")
    expect(persisted).toContain('"terminalAt":')
    expect(persisted).not.toContain('"tmuxPaneID"')
  })

  test("recovers a running task owned by a dead process as interrupted", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { recovery: { autoResumeOnStart: true }, tmux: { enabled: false } } }),
    )
    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    const stamp = new Date().toISOString()
    fs.writeFileSync(path.join(persistedDir, "sess-dead-owner.json"), JSON.stringify([{
      id: "tsk_dead_owner",
      sessionID: "sess-dead-owner",
      title: "abandoned",
      agent: "agent:explorer",
      category: null,
      status: "running",
      provider: "copilot",
      ownerPid: 2147483647,
      ownerInstanceID: "dead-instance",
      createdAt: stamp,
      startedAt: stamp,
      terminalAt: null,
      updatedAt: stamp,
      backgroundTaskID: null,
      retries: 0,
      fallbackAttempts: 0,
      details: "was running",
      fallbackReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: null,
      tmuxSessionName: null,
      tmuxState: "disabled",
    }]))

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-dead-owner" },
    )

    expect(output).toContain("[interrupted]")
    expect(output).not.toContain("[queued]")
  })

  test("recovery closes an abandoned task window before clearing its tmux identity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { recovery: { autoResumeOnStart: true }, tmux: { enabled: false } } }),
    )
    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    const stamp = new Date().toISOString()
    const taskFile = path.join(persistedDir, "sess-recover-window.json")
    fs.writeFileSync(taskFile, JSON.stringify([{
      id: "tsk_recover_window",
      sessionID: "sess-recover-window",
      title: "abandoned window",
      agent: "agent:explorer",
      category: null,
      status: "running",
      provider: "copilot",
      ownerPid: 2_147_483_647,
      ownerInstanceID: "dead-instance",
      createdAt: stamp,
      startedAt: stamp,
      terminalAt: null,
      updatedAt: stamp,
      backgroundTaskID: null,
      details: "was running",
      failureReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: "@12",
      tmuxSessionName: "fellowship-old",
      tmuxState: "attached",
    }]))
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))

    await pluginFactory()

    expect(commandLog).toContainEqual(["tmux", "kill-window", "-t", "@12"])
    const persisted = JSON.parse(fs.readFileSync(taskFile, "utf-8")) as Array<{ tmuxWindowID: string | null }>
    expect(persisted[0]?.tmuxWindowID).toBeNull()
  })

  test("terminal state cannot be overwritten by tool.execute.after", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-terminal", callID: "call-terminal" },
      { args: { description: "will be stopped", category: "quick" } },
    )

    await plugin.tool.fellowship_orchestration.execute(
      { action: "stop" },
      { sessionID: "sess-terminal" },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-terminal", callID: "call-terminal" },
      { output: "Task completed successfully" },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-terminal" },
    )

    expect(tasksOutput).toContain("[stopped]")
    expect(tasksOutput).not.toContain("[completed]")
  })

  test("terminal task ToolPart error closes lifecycle when after hook is skipped", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: {
        limits: { maxConcurrentGlobal: 1 },
        runtimeFallback: { enabled: false },
        tmux: { enabled: true },
      } }),
    )
    const commandLog: string[][] = []
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock({ commandLog }))
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-tool-error", callID: "call-error" },
      { args: { description: "throws before after hook" } },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-error",
          sessionID: "sess-tool-error",
          type: "tool",
          callID: "call-error",
          tool: "task",
          state: { status: "error", error: "429 too many requests" },
        },
      },
    } })

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-tool-error" },
    )
    expect(output).toContain("[failed]")
    const persisted = fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-tasks",
      "sess-tool-error.json",
    ), "utf-8")
    expect(persisted).toContain('"failureReason": "http-429"')
    expect(commandLog).toContainEqual(["tmux", "kill-window", "-t", "@1"])
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-after-error", callID: "call-after-error" },
      { args: { description: "uses released capacity" } },
    )
  })

  test("terminal completed ToolPart closes foreground lifecycle when after hook is skipped", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-tool-complete", callID: "call-complete" },
      { args: { description: "completes without after hook" } },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "part-complete",
        sessionID: "sess-tool-complete",
        type: "tool",
        callID: "call-complete",
        tool: "task",
        state: { status: "completed", output: "done" },
      } },
    } })

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-tool-complete" },
    )
    expect(output).toContain("[completed]")
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-after-complete", callID: "call-after-complete" },
      { args: { description: "uses released capacity" } },
    )
  })

  test("completed background-launch ToolPart persists child identity without releasing capacity", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { limits: { maxConcurrentGlobal: 1 }, tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-bg-part", callID: "call-bg-part" },
      { args: { description: "background ToolPart" } },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "part-bg",
        sessionID: "sess-bg-part",
        type: "tool",
        callID: "call-bg-part",
        tool: "task",
        state: {
          status: "completed",
          output: "background launch confirmed",
          metadata: { background: true, sessionId: "child-bg-part", jobId: "job-bg-part" },
        },
      } },
    } })

    const detail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "child-bg-part" },
      { sessionID: "sess-bg-part" },
    )
    expect(detail).toContain("- Status: running")
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-other-bg-part", callID: "call-other-bg-part" },
      { args: { description: "still blocked" } },
    )).rejects.toThrow("shared global active cap reached (1/1)")
  })

  test("terminal ToolPart correlates internal subtask hook identity by part id", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-internal-part", callID: "part-internal" },
      { args: { description: "internal subtask" } },
    )

    await plugin.event({ event: {
      type: "message.part.updated",
      properties: { part: {
        id: "part-internal",
        sessionID: "sess-internal-part",
        type: "tool",
        callID: "different-normal-call-id",
        tool: "task",
        state: { status: "error", error: "internal task failed" },
      } },
    } })

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-internal-part" },
    )
    expect(output).toContain("[failed]")
  })

  test("persists explicit execution ownership and lifecycle timestamps", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({ orchestration: { tmux: { enabled: false } } }),
    )
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-lifecycle", callID: "call-lifecycle" },
      { args: { description: "timestamped task" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-lifecycle", callID: "call-lifecycle" },
      { output: "done" },
    )

    const records = JSON.parse(fs.readFileSync(path.join(
      tempDir,
      ".cache",
      "opencode",
      "fellowship",
      "orchestration-tasks",
      "sess-lifecycle.json",
    ), "utf-8")) as Array<{ ownerPid?: number; ownerInstanceID?: string; startedAt?: string; terminalAt?: string }>
    expect(records[0]?.ownerPid).toBe(process.pid)
    expect(records[0]?.ownerInstanceID).toBeString()
    expect(Date.parse(records[0]?.startedAt ?? "")).not.toBeNaN()
    expect(Date.parse(records[0]?.terminalAt ?? "")).not.toBeNaN()
  })

  test("long agent output discussing failures is not misclassified as a task failure", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-false-positive", callID: "call-fp" },
      { args: { description: "architecture review", subagent_type: "architect" } },
    )

    const longAnalysis = [
      "## Architecture Assessment",
      "",
      "The orchestration plugin follows a pragmatic in-process coordinator pattern.",
      "",
      "### Top 3 Risks",
      "1. Failure detection uses substring heuristics and the fallback engine failed",
      "   to re-dispatch tasks in several observed cases.",
      "2. The task lifecycle has failed to enforce terminal state transitions.",
      "3. Tmux session management has failed to handle name collisions.",
      "",
      "### Recommendation",
      "Fix the failure classification to avoid false positives on agent analysis.",
      "",
      "This is a comprehensive analysis of the codebase architecture covering",
      "config loading, task tracking, tmux session management, and provider routing.",
      "The overall design is sound but several implementation details need hardening.",
    ].join("\n")

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-false-positive", callID: "call-fp" },
      { output: longAnalysis },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-false-positive" },
    )

    expect(tasksOutput).toContain("[completed]")
    expect(tasksOutput).not.toContain("[failed]")
    expect(tasksOutput).not.toContain("[retrying]")
  })

  test("short error output is correctly classified as a task failure", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          features: { selfHealing: false },
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-real-fail", callID: "call-rf" },
      { args: { description: "doomed task", subagent_type: "explorer" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-real-fail", callID: "call-rf" },
      { output: "Task failed: connection refused" },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-real-fail" },
    )

    expect(tasksOutput).toContain("[failed]")
  })

  test("completed task window is cleaned up and agent session destroyed when all done", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-cleanup", callID: "call-c1" },
      { args: { description: "task one", category: "quick" } },
    )

    // Verify window is attached and session exists
    const beforeTasks = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-cleanup" },
    )
    expect(beforeTasks).toContain("tmux=attached")
    expect(beforeTasks).toContain("windows=1")
    expect(beforeTasks).toContain("agentSession=fellowship-")

    // Complete the task
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-cleanup", callID: "call-c1" },
      { output: "All done, task finished successfully." },
    )

    const afterTasks = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-cleanup" },
    )

    expect(afterTasks).toContain("[completed]")
    expect(afterTasks).toContain("windows=0")
    // Agent session should be destroyed since no windows remain
    expect(afterTasks).toContain("agentSession=none")
  })

  test("agent session persists while some tasks still have windows", async () => {
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-partial", callID: "call-p1" },
      { args: { description: "task one", category: "quick" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-partial", callID: "call-p2" },
      { args: { description: "task two", category: "quick" } },
    )

    // Complete only the first task
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-partial", callID: "call-p1" },
      { output: "First done." },
    )

    const midTasks = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-partial" },
    )

    // One window still attached, session should persist
    expect(midTasks).toContain("windows=1")
    expect(midTasks).toContain("agentSession=fellowship-")
    expect(midTasks).not.toContain("agentSession=none")

    // Complete the second task
    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-partial", callID: "call-p2" },
      { output: "Second done." },
    )

    const finalTasks = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-partial" },
    )

    // Now all done, session should be destroyed
    expect(finalTasks).toContain("windows=0")
    expect(finalTasks).toContain("agentSession=none")
  })

  test("matching fallback errors remain terminal because no retry scheduler exists", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          features: { selfHealing: true },
          runtimeFallback: {
            enabled: true,
            retryOnErrors: [429, 500, 503],
            maxFallbackAttempts: 2,
            providerOrder: ["copilot", "native"],
          },
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-fallback", callID: "call-fb1" },
      { args: { description: "flaky task", subagent_type: "explorer" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-fallback", callID: "call-fb1" },
      { output: "failed with 429 too many requests" },
    )

    const afterFirst = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-fallback" },
    )
    expect(afterFirst).toContain("[failed]")
    expect(afterFirst).not.toContain("[retrying]")

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-fallback", callID: "call-fb1" },
      { output: "failed again with 429 rate limit" },
    )

    const afterSecond = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-fallback" },
    )
    expect(afterSecond).toContain("[failed]")
    expect(afterSecond).not.toContain("[retrying]")

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-fallback", callID: "call-fb1" },
      { output: "failed yet again with 429" },
    )

    const afterExhausted = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-fallback" },
    )
    expect(afterExhausted).toContain("[failed]")
    expect(afterExhausted).toContain("Task failed: flaky task")
  })

  test("fallback engine does not retry when error code is not in retryOnErrors", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          features: { selfHealing: true },
          runtimeFallback: {
            enabled: true,
            retryOnErrors: [429, 503],
            maxFallbackAttempts: 2,
            providerOrder: ["copilot", "native"],
          },
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-no-retry", callID: "call-nr" },
      { args: { description: "auth failure", subagent_type: "explorer" } },
    )

    await plugin["tool.execute.after"](
      { tool: "task", sessionID: "sess-no-retry", callID: "call-nr" },
      { output: "failed with 401 unauthorized" },
    )

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-no-retry" },
    )
    expect(tasksOutput).toContain("[failed]")
    expect(tasksOutput).not.toContain("[retrying]")
  })

  test("session.deleted event stops active tasks, cleans up windows, and destroys session", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          tmux: {
            enabled: true,
            sessionPrefix: "fellowship",
          },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-delete-me", callID: "call-d1" },
      { args: { description: "task one", category: "quick" } },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-delete-me", callID: "call-d2" },
      { args: { description: "task two", category: "quick" } },
    )

    const beforeDelete = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-delete-me" },
    )
    expect(beforeDelete).toContain("[running]")

    await plugin.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: "sess-delete-me" } },
      },
    })

    const afterDelete = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-delete-me" },
    )
    expect(afterDelete).toContain("[stopped]")
    expect(afterDelete).not.toContain("[running]")
    expect(afterDelete).not.toContain("[retrying]")
    expect(afterDelete).not.toContain("tmux=attached")
  })

  test("session.deleted event ignores malformed event payloads", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: { tmux: { enabled: false } },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    await plugin.event({ event: { type: "session.deleted", properties: {} } })
    await plugin.event({ event: { type: "session.deleted", properties: { info: {} } } })
    await plugin.event({ event: { type: "session.deleted", properties: { info: { id: "" } } } })
    await plugin.event({ event: { type: "session.deleted", properties: null } })
    await plugin.event({ event: { type: "message.updated" } })

    expect(true).toBe(true)
  })

  test("enforceTaskTimeouts marks stale active tasks as failed", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { taskTimeoutMs: 5000 },
          recovery: { autoResumeOnStart: false },
          tmux: { enabled: false },
        },
      }),
    )

    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })

    const staleTimestamp = new Date(Date.now() - 10000).toISOString()
    fs.writeFileSync(
      path.join(persistedDir, "sess-timeout.json"),
      JSON.stringify([
        {
          id: "tsk_timeout_1",
          sessionID: "sess-timeout",
          title: "stale task",
          agent: "agent:explorer",
          category: null,
          status: "running",
          createdAt: staleTimestamp,
          updatedAt: staleTimestamp,
          backgroundTaskID: null,
          retries: 0,
          fallbackAttempts: 0,
          details: "been running too long",
          fallbackReason: null,
          blockedBy: [],
          blocks: [],
          tmuxWindowID: null,
          tmuxSessionName: null,
          tmuxState: "disabled",
        },
      ]),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const tasksOutput = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-timeout" },
    )

    expect(tasksOutput).toContain("[failed]")
    expect(tasksOutput).toContain("Task failed: stale task")

    const taskDetail = await plugin.tool.fellowship_orchestration.execute(
      { action: "task", task_id: "tsk_timeout_1" },
      { sessionID: "sess-timeout" },
    )
    expect(taskDetail).toContain("Timed out after 5000ms")
  })

  test("task timeout uses explicit execution start rather than cache update age", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      JSON.stringify({
        orchestration: {
          limits: { taskTimeoutMs: 1000 },
          recovery: { autoResumeOnStart: false },
          tmux: { enabled: false },
        },
      }),
    )
    const persistedDir = path.join(tempDir, ".cache", "opencode", "fellowship", "orchestration-tasks")
    fs.mkdirSync(persistedDir, { recursive: true })
    const old = new Date(Date.now() - 5000).toISOString()
    fs.writeFileSync(path.join(persistedDir, "sess-start-age.json"), JSON.stringify([{
      id: "tsk_start_age",
      sessionID: "sess-start-age",
      title: "old execution",
      agent: "agent:explorer",
      category: null,
      status: "running",
      provider: "copilot",
      ownerPid: null,
      ownerInstanceID: null,
      createdAt: old,
      startedAt: old,
      terminalAt: null,
      updatedAt: new Date().toISOString(),
      backgroundTaskID: null,
      retries: 0,
      fallbackAttempts: 0,
      details: "recently cached",
      fallbackReason: null,
      blockedBy: [],
      blocks: [],
      tmuxWindowID: null,
      tmuxSessionName: null,
      tmuxState: "disabled",
    }]))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const output = await plugin.tool.fellowship_orchestration.execute(
      { action: "tasks" },
      { sessionID: "sess-start-age" },
    )

    expect(output).toContain("[failed]")
  })

  test("parseConfigFromFile falls back to defaults on malformed JSONC", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".opencode", "fellowship.json"),
      "{ this is not valid json at all !!!",
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-bad-config" },
    )

    expect(diagnostics).toContain("Config source: defaults")
    expect(diagnostics).toContain("FAIL config:jsoncReadable (1 config file(s) present)")
    expect(diagnostics).toContain("PASS providerMode")
  })

  test("parseConfigFromFile falls back to home directory config", async () => {
    fs.unlinkSync(path.join(tempDir, ".opencode", "fellowship.json"))

    const homeConfigDir = path.join(tempDir, ".config", "opencode")
    fs.mkdirSync(homeConfigDir, { recursive: true })
    fs.writeFileSync(
      path.join(homeConfigDir, "fellowship.json"),
      JSON.stringify({
        orchestration: {
          providerMode: "native",
          tmux: { enabled: false },
        },
      }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-home-config" },
    )

    expect(diagnostics).toContain("fellowship.json")
    expect(diagnostics).toContain("Current mode: native")
  })

  test("plugin config merges home then project while preferring jsonc within each scope", async () => {
    const homeConfigDir = path.join(tempDir, ".config", "opencode")
    fs.mkdirSync(homeConfigDir, { recursive: true })
    fs.writeFileSync(path.join(homeConfigDir, "fellowship.json"), JSON.stringify({
      orchestration: { providerMode: "native", limits: { maxConcurrentGlobal: 1 } },
    }))
    fs.writeFileSync(path.join(homeConfigDir, "fellowship.jsonc"), `{
      // The preferred home file supplies the global cap.
      "orchestration": { "providerMode": "copilot", "limits": { "maxConcurrentGlobal": 2 } }
    }`)
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.json"), JSON.stringify({
      orchestration: { providerMode: "copilot", limits: { maxConcurrent: 3 } },
    }))
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.jsonc"), `{
      // The preferred project file overrides only these nested values.
      "orchestration": { "providerMode": "native", "limits": { "maxConcurrent": 1 }, "tmux": { "enabled": false } }
    }`)
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-config-precedence" },
    )
    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-config-precedence", callID: "call-config-1" },
      { args: { description: "first merged task" } },
    )

    expect(diagnostics).toContain("Current mode: native")
    expect(diagnostics).toContain("sharedActive=0/2")
    expect(diagnostics).toContain(".opencode/fellowship.jsonc")
    await expect(plugin["tool.execute.before"](
      { tool: "task", sessionID: "sess-config-precedence", callID: "call-config-2" },
      { args: { description: "over merged session cap" } },
    )).rejects.toThrow("per-session active cap reached (1/1)")
  })

  test("plugin config applies the config-selected preset orchestration overlay", async () => {
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.json"), JSON.stringify({
      preset: "focused",
      orchestration: { providerMode: "copilot", limits: { maxConcurrentGlobal: 3 }, tmux: { enabled: false } },
      presets: {
        focused: { orchestration: { providerMode: "native", limits: { maxConcurrentGlobal: 1 } } },
      },
    }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-config-preset" },
    )

    expect(diagnostics).toContain("Current mode: native")
    expect(diagnostics).toContain("sharedActive=0/1")
  })

  test("runtime preset selection takes priority over the config-selected preset", async () => {
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.json"), JSON.stringify({
      preset: "configured",
      presets: {
        configured: { orchestration: { providerMode: "copilot", limits: { maxConcurrentGlobal: 3 } } },
        runtime: { orchestration: { providerMode: "native", limits: { maxConcurrentGlobal: 1 } } },
      },
    }))
    const stateDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, "opencode-config.preset-state.json"), JSON.stringify({ version: 1, activePreset: "runtime" }))
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-runtime-preset" },
    )

    expect(diagnostics).toContain("Current mode: native")
    expect(diagnostics).toContain("sharedActive=0/1")
  })

  test("FELLOWSHIP_PRESET takes priority over runtime and config preset selections", async () => {
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.json"), JSON.stringify({
      preset: "configured",
      presets: {
        configured: { orchestration: { providerMode: "copilot", limits: { maxConcurrentGlobal: 3 } } },
        runtime: { orchestration: { providerMode: "copilot", limits: { maxConcurrentGlobal: 2 } } },
        environment: { orchestration: { providerMode: "native", limits: { maxConcurrentGlobal: 1 } } },
      },
    }))
    const stateDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, "opencode-config.preset-state.json"), JSON.stringify({ version: 1, activePreset: "runtime" }))
    process.env.FELLOWSHIP_PRESET = "environment"
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-env-preset" },
    )

    expect(diagnostics).toContain("Current mode: native")
    expect(diagnostics).toContain("sharedActive=0/1")
  })

  test("unknown higher-priority preset falls through to the next existing candidate", async () => {
    fs.writeFileSync(path.join(tempDir, ".opencode", "fellowship.json"), JSON.stringify({
      preset: "configured",
      presets: {
        configured: { orchestration: { providerMode: "copilot", limits: { maxConcurrentGlobal: 3 } } },
        runtime: { orchestration: { providerMode: "native", limits: { maxConcurrentGlobal: 1 } } },
      },
    }))
    const stateDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(path.join(stateDir, "opencode-config.preset-state.json"), JSON.stringify({ version: 1, activePreset: "runtime" }))
    process.env.FELLOWSHIP_PRESET = "missing"
    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-unknown-env-preset" },
    )

    expect(diagnostics).toContain("Current mode: native")
    expect(diagnostics).toContain("sharedActive=0/1")
  })

  test("diagnostics reports structured package, status, asset, and command health", async () => {
    fs.mkdirSync(path.join(tempDir, "command"), { recursive: true })
    for (const commandName of ["continue", "stop", "tasks", "task", "diagnostics", "doctor", "preset"]) {
      fs.writeFileSync(path.join(tempDir, "command", `${commandName}.md`), "---\ndescription: test\n---\n")
    }

    fs.mkdirSync(path.join(tempDir, "plugin"), { recursive: true })
    fs.writeFileSync(path.join(tempDir, "plugin", "fellowship-orchestration.ts"), "export default {}\n")
    fs.writeFileSync(path.join(tempDir, "plugin", "vision-tool.ts"), "export default {}\n")

    fs.mkdirSync(path.join(tempDir, "agent"), { recursive: true })
    fs.writeFileSync(path.join(tempDir, "agent", "gandalf.md"), "---\ndescription: test\n---\n")

    fs.mkdirSync(path.join(tempDir, "skill", "example"), { recursive: true })
    fs.writeFileSync(path.join(tempDir, "skill", "example", "SKILL.md"), "---\nname: example\ndescription: test\n---\n")

    fs.mkdirSync(path.join(tempDir, "mcp"), { recursive: true })
    fs.writeFileSync(path.join(tempDir, "mcp", "context7.json"), "{}\n")

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "@unfrgivn/opencode-config", version: "1.20.1" }),
    )
    fs.writeFileSync(
      path.join(tempDir, "fellowship.schema.json"),
      JSON.stringify({ properties: { presets: { type: "object" } } }),
    )
    fs.writeFileSync(
      path.join(tempDir, "manifest.json"),
      JSON.stringify({ instructions: ["instruction/getting-started.md"] }),
    )

    const statusDir = path.join(tempDir, ".cache", "opencode", "fellowship")
    fs.mkdirSync(statusDir, { recursive: true })
    fs.writeFileSync(
      path.join(statusDir, "opencode-config.plugin-status.json"),
      JSON.stringify({ lastLoadTime: "2026-07-08T00:00:00.000Z" }),
    )

    const pluginFactory = await loadPluginWithMock(createTmuxSpawnMock())
    const plugin = await pluginFactory()

    const diagnostics = await plugin.tool.fellowship_orchestration.execute(
      { action: "diagnostics" },
      { sessionID: "sess-structured-doctor" },
    )

    expect(diagnostics).toContain("## Config Files")
    expect(diagnostics).toContain("## Package & Schema")
    expect(diagnostics).toContain("PASS package:name (@unfrgivn/opencode-config)")
    expect(diagnostics).toContain("PASS schema:presets")
    expect(diagnostics).toContain("## Status Files")
    expect(diagnostics).toContain("PASS status:lastLoadTime (2026-07-08T00:00:00.000Z)")
    expect(diagnostics).toContain("PASS runtime:orchestration")
    expect(diagnostics).toContain("PASS runtime:vision")
    expect(diagnostics).toContain("PASS assets:skills")
    expect(diagnostics).toContain("PASS assets:mcps")
    expect(diagnostics).toContain("PASS /doctor")
    expect(diagnostics).toContain("PASS /preset")
  })
})
