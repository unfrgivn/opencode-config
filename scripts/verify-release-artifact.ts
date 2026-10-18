import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"

const PACKAGE_NAME = "@unfrgivn/opencode-config"
const TUI_PLUGIN_ID = `${PACKAGE_NAME}:tui`
const HOST_STARTUP_TIMEOUT_MS = 30_000
const HOST_PLUGIN_TIMEOUT_MS = 90_000
const HOST_STOP_TIMEOUT_MS = 10_000
const SIDEBAR_TIMEOUT_MS = 60_000
const SIDEBAR_SETTLE_MS = 3_000
const POLL_INTERVAL_MS = 500

const PluginList = z.object({
  data: z.array(
    z.object({
      source: z.object({ type: z.string(), path: z.string().optional() }),
      state: z.object({ status: z.string(), error: z.string().optional(), ref: z.string().optional() }),
    }),
  ),
})
type PluginState = z.infer<typeof PluginList>["data"][number]["state"]

const SessionCreated = z.object({ data: z.object({ id: z.string() }) })

function run(command: string[], cwd: string, env?: Record<string, string>): string {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${filePath} is not a JSON object`)
  return parsed
}

const projectRoot = join(import.meta.dir, "..")
// Real path, because OpenCode reports plugin sources by real path (macOS /var is a symlink).
const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "fellowship-release-")))

function pack(): string {
  const packResult: unknown = JSON.parse(run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", tempDir], projectRoot))
  if (!Array.isArray(packResult) || packResult.length !== 1) throw new Error("npm pack returned an unexpected result")
  if (!isRecord(packResult[0])) throw new Error("npm pack returned invalid artifact metadata")
  const filename = packResult[0].filename
  if (typeof filename !== "string") throw new Error("npm pack did not return an artifact filename")
  return join(tempDir, filename)
}

// npm, not bun, because OpenCode installs package plugins with npm.
function install(tarball: string): string {
  const installDir = join(tempDir, "install")
  mkdirSync(installDir)
  writeFileSync(join(installDir, "package.json"), '{"private":true,"type":"module"}\n')
  run(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error", tarball], installDir)
  return installDir
}

function verifyExports(installDir: string): void {
  run(
    [
      "bun",
      "-e",
      `const server = (await import('${PACKAGE_NAME}')).default; const tui = (await import('${PACKAGE_NAME}/tui')).default; if (typeof server?.setup !== 'function' || typeof tui?.setup !== 'function') throw new Error('invalid plugin exports')`,
    ],
    installDir,
  )
}

function verifyManifest(manifest: Record<string, unknown>): void {
  if (manifest.types !== "dist/index.d.ts" || typeof manifest.exports !== "object") {
    throw new Error("installed package metadata is incomplete")
  }
}

/**
 * Plain Bun resolves `effect`, `@opencode/plugin`, and OpenTUI from the plugin's
 * own node_modules. OpenCode does not: it substitutes the host's copies, so only
 * the real host proves the server plugin loads and the TUI sidebar renders.
 */
async function verifyInOpenCode(installDir: string, manifest: Record<string, unknown>): Promise<void> {
  const opencode = resolveOpenCode(manifest)
  const hostVersion = run([opencode, "--version"], tempDir).trim()
  if (typeof manifest.version !== "string") throw new Error("installed package.json has no version")
  const home = join(tempDir, "home")
  const project = join(tempDir, "project")
  // A plugin directory loads its index and tui files. dist has both, so OpenCode imports
  // them from node_modules exactly like an npm install. A shim outside node_modules would
  // not: OpenTUI only swaps in the host's @opentui/solid for node_modules files it imports directly.
  const pluginDir = join(installDir, "node_modules", "@unfrgivn", "opencode-config", "dist")
  mkdirSync(join(home, ".config", "opencode"), { recursive: true })
  mkdirSync(project)
  writeFileSync(
    join(home, ".config", "opencode", "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [pluginDir] }, null, 2)}\n`,
  )

  // Nothing inherited but PATH: an OPENCODE_* variable from a parent OpenCode
  // session would attach to that session instead of this sandbox.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home, OPENCODE_PASSWORD: randomUUID() }
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR

  const server = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let state: PluginState
  let sidebar: Sidebar | undefined
  try {
    const url = await listeningUrl(server)
    state = await pluginState(opencode, url, project, env, pluginDir)
    if (state.status === "active") sidebar = await sidebarState(opencode, url, project, env, `v${manifest.version}`)
  } finally {
    await stopServer(server)
  }
  if (state.status !== "active") {
    // Read after shutdown: the server log is not flushed when the API already reports the failure.
    const log = join(home, ".local", "share", "opencode", "log", "opencode.log")
    throw new Error(
      `${PACKAGE_NAME} failed to load in ${hostVersion}: ${state.error ?? state.status}${state.ref ? ` (${state.ref})` : ""}\n${causeFromLog(log, state.ref)}`,
    )
  }
  console.log(`${PACKAGE_NAME} is active in ${hostVersion}`)
  if (sidebar?.status !== "rendered") {
    throw new Error(`The ${PACKAGE_NAME} sidebar did not render in ${hostVersion} (${sidebar?.status ?? "not checked"}). Screen:\n${sidebar?.screen ?? ""}`)
  }
  console.log(`${PACKAGE_NAME} sidebar renders in ${hostVersion}`)
}

type Sidebar = { status: "rendered" | "crashed" | "missing"; screen: string }

/**
 * The sidebar slot only renders in a session view, so this opens an empty session
 * (no model call) in the real TUI on a private tmux server and reads the screen.
 * OpenCode reports slot crashes in a toast that names the plugin.
 */
async function sidebarState(
  opencode: string,
  url: string,
  project: string,
  env: Record<string, string>,
  versionLabel: string,
): Promise<Sidebar> {
  const tmuxPath = Bun.which("tmux")
  if (!tmuxPath) throw new Error("tmux is required to check the TUI sidebar: brew install tmux, or apt-get install tmux")
  const created = run(
    [opencode, "api", "--server", url, "post", "/api/session", "-d", JSON.stringify({ title: "verify:release", location: { directory: project } })],
    project,
    env,
  )
  const sessionID = SessionCreated.parse(JSON.parse(created)).data.id

  // -f /dev/null keeps the developer's tmux.conf out of the sandbox.
  const tmux = (...args: string[]) => Bun.spawnSync([tmuxPath, "-L", `fellowship-verify-${process.pid}`, "-f", "/dev/null", ...args], { stdout: "pipe", stderr: "pipe" })
  const tuiEnv = { ...env, TERM: "tmux-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" }
  const started = tmux(
    "new-session", "-d", "-s", "verify", "-x", "200", "-y", "50", "-c", project, "--",
    "env", "-i", ...Object.entries(tuiEnv).map(([key, value]) => `${key}=${value}`),
    opencode, "--server", url, "--session", sessionID,
  )
  if (started.exitCode !== 0) throw new Error(`tmux could not start the OpenCode TUI:\n${started.stderr.toString()}`)
  // tmux leaves its socket file behind after kill-server.
  const socketPath = tmux("display-message", "-p", "-t", "verify", "#{socket_path}").stdout.toString().trim()

  let screen = ""
  let renderedAt: number | undefined
  try {
    const deadline = Date.now() + SIDEBAR_TIMEOUT_MS
    while (Date.now() < deadline) {
      await Bun.sleep(POLL_INTERVAL_MS)
      const capture = tmux("capture-pane", "-p", "-t", "verify")
      if (capture.exitCode !== 0) return { status: "missing", screen: `${screen}\n(the TUI exited: ${capture.stderr.toString().trim()})` }
      screen = capture.stdout.toString().split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0).join("\n")
      if (screen.includes(TUI_PLUGIN_ID)) return { status: "crashed", screen }
      // Keep watching a few refreshes after the first render: the sidebar re-renders as its snapshot changes.
      if (renderedAt === undefined && screen.includes("Fellowship") && screen.includes(versionLabel)) renderedAt = Date.now()
      if (renderedAt !== undefined && Date.now() - renderedAt >= SIDEBAR_SETTLE_MS) return { status: "rendered", screen }
    }
    return { status: "missing", screen }
  } finally {
    tmux("kill-server")
    if (socketPath) rmSync(socketPath, { force: true })
  }
}

function resolveOpenCode(manifest: Record<string, unknown>): string {
  const override = process.env.OPENCODE_BIN
  if (override) return override

  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
  const sdkVersion = dependencies["@opencode/plugin"]
  const version = process.env.OPENCODE_VERSION ?? sdkVersion
  if (typeof version !== "string") throw new Error("package.json does not depend on @opencode/plugin")

  // @opencode/cli is versioned in lockstep with @opencode/plugin.
  const cliDir = join(tempDir, "opencode-cli")
  mkdirSync(cliDir)
  writeFileSync(join(cliDir, "package.json"), '{"private":true}\n')
  run(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error", `@opencode/cli@${version}`], cliDir)
  return join(cliDir, "node_modules", ".bin", "opencode")
}

function listeningUrl(server: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    const fail = (reason: string) => {
      clearTimeout(timer)
      reject(new Error(`${reason}\n${output}`))
    }
    const timer = setTimeout(() => fail("OpenCode did not start listening in time"), HOST_STARTUP_TIMEOUT_MS)
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/server listening on (http:\/\/\S+)/)
      if (!match) return
      clearTimeout(timer)
      resolve(match[1])
    }
    server.stdout?.on("data", collect)
    server.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    server.once("error", (error) => fail(`OpenCode failed to start: ${error.message}`))
    server.once("exit", (code, signal) => fail(`OpenCode exited (${signal ?? code}) before listening`))
  })
}

// Plugins activate in the background after a location boots, so poll until ours settles.
async function pluginState(
  opencode: string,
  url: string,
  project: string,
  env: Record<string, string>,
  pluginDir: string,
): Promise<PluginState> {
  const deadline = Date.now() + HOST_PLUGIN_TIMEOUT_MS
  let last = ""
  while (Date.now() < deadline) {
    const result = Bun.spawnSync([opencode, "api", "--server", url, "get", "/api/plugin"], {
      cwd: project,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    last = result.exitCode === 0 ? result.stdout.toString() : result.stderr.toString()
    if (result.exitCode === 0) {
      const entry = parsePluginList(last).data.find(
        (plugin) => plugin.source.type === "local" && isWithin(plugin.source.path, pluginDir),
      )
      if (entry?.state.status === "active" || entry?.state.status === "failed") return entry.state
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`OpenCode never reported ${PACKAGE_NAME} within ${HOST_PLUGIN_TIMEOUT_MS / 1000}s. Last response:\n${last}`)
}

function parsePluginList(text: string): z.infer<typeof PluginList> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`OpenCode returned invalid JSON for /api/plugin:\n${text}`, { cause: error })
  }
  const parsed = PluginList.safeParse(json)
  if (!parsed.success) throw new Error(`Unexpected plugin list from OpenCode: ${parsed.error.message}\n${text}`)
  return parsed.data
}

// Failed plugins report their directory; active ones report the resolved index file.
function isWithin(path: string | undefined, dir: string): boolean {
  return path === dir || (path?.startsWith(`${dir}${sep}`) ?? false)
}

// The API only carries a generic error; the server log has the original cause.
function causeFromLog(logPath: string, ref: string | undefined): string {
  if (!ref || !existsSync(logPath)) return "(no server log entry available)"
  const lines = readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.includes(`ref=${ref}`))
  return lines.length > 0 ? lines.join("\n") : `(no log line for ${ref})`
}

// The server runs in its own process group, so MCP servers it started stop with it.
async function stopServer(server: ChildProcess): Promise<void> {
  const pid = server.pid
  if (pid === undefined || server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise<boolean>((resolve) => server.once("exit", () => resolve(true)))
  signalGroup(pid, "SIGTERM")
  const stopped = await Promise.race([exited, Bun.sleep(HOST_STOP_TIMEOUT_MS).then(() => false)])
  if (!stopped) signalGroup(pid, "SIGKILL")
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    const alreadyGone = isRecord(error) && error.code === "ESRCH"
    if (!alreadyGone) throw error
  }
}

try {
  const installDir = install(pack())
  const manifest = readJsonRecord(join(installDir, "node_modules", "@unfrgivn", "opencode-config", "package.json"))
  verifyExports(installDir)
  verifyManifest(manifest)
  await verifyInOpenCode(installDir, manifest)
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
