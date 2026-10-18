import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"

const PACKAGE_NAME = "@unfrgivn/opencode-config"
const HOST_STARTUP_TIMEOUT_MS = 30_000
const HOST_PLUGIN_TIMEOUT_MS = 90_000
const HOST_STOP_TIMEOUT_MS = 10_000
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

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" })
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
 * Plain Bun resolves `effect` and `@opencode/plugin` from the plugin's own
 * node_modules. OpenCode does not: it substitutes the host's copies, so only
 * booting the real host proves the plugin loads.
 */
async function verifyInOpenCode(installDir: string, manifest: Record<string, unknown>): Promise<void> {
  const opencode = resolveOpenCode(manifest)
  const version = run([opencode, "--version"], tempDir).trim()
  const home = join(tempDir, "home")
  const project = join(tempDir, "project")
  const pluginDir = join(installDir, "opencode-plugin")
  mkdirSync(join(home, ".config", "opencode"), { recursive: true })
  mkdirSync(project)
  mkdirSync(pluginDir)
  // OpenCode loads a local plugin directory through its root index file. Re-exporting
  // the package makes the host resolve it through its exports map, like an npm plugin.
  writeFileSync(join(pluginDir, "index.js"), `export { default } from "${PACKAGE_NAME}"\n`)
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
  try {
    const url = await listeningUrl(server)
    state = await pluginState(opencode, url, project, env, pluginDir)
  } finally {
    await stopServer(server)
  }
  if (state.status !== "active") {
    // Read after shutdown: the server log is not flushed when the API already reports the failure.
    const log = join(home, ".local", "share", "opencode", "log", "opencode.log")
    throw new Error(
      `${PACKAGE_NAME} failed to load in ${version}: ${state.error ?? state.status}${state.ref ? ` (${state.ref})` : ""}\n${causeFromLog(log, state.ref)}`,
    )
  }
  console.log(`${PACKAGE_NAME} is active in ${version}`)
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
