/**
 * Moves the OpenCode plugin SDK and the TUI packages pinned beside it to one
 * release, then refreshes bun.lock.
 *
 *   bun run update:opencode            # latest
 *   bun run update:opencode 2.0.40     # any version or dist-tag
 *
 * At runtime OpenCode hands plugins its own copies of `effect`,
 * `@opencode/plugin`, OpenTUI, and Solid, so these pins never run inside
 * OpenCode. They decide which API we typecheck and test against and which
 * OpenCode release `verify:release` boots, which is why they move together:
 *
 *   @opencode/plugin@X ──devDependencies──▶ @opentui/core, @opentui/solid
 *                      ──peerDependencies─▶ @opencode/theme (types for the TUI theme)
 *   @opentui/solid ──peerDependencies──▶ solid-js
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Manifest = {
  version: string
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

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

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error("expected an object of package versions")
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return Object.fromEntries(entries)
}

function fetchManifest(name: string, spec: string, cwd: string): Manifest {
  const raw: unknown = JSON.parse(run(["npm", "view", `${name}@${spec}`, "version", "devDependencies", "peerDependencies", "--json"], cwd))
  if (!isRecord(raw) || typeof raw.version !== "string") {
    throw new Error(`${name}@${spec} must resolve to exactly one published version`)
  }
  return {
    version: raw.version,
    devDependencies: stringRecord(raw.devDependencies),
    peerDependencies: stringRecord(raw.peerDependencies),
  }
}

function exactVersion(version: string | undefined, source: string): string {
  if (version === undefined || !EXACT_VERSION.test(version)) {
    throw new Error(`${source} is ${version ?? "missing"}; expected an exact version to pin`)
  }
  return version
}

const projectRoot = join(import.meta.dir, "..")
const packageJsonPath = join(projectRoot, "package.json")
const spec = process.argv[2] ?? "latest"

const sdk = fetchManifest("@opencode/plugin", spec, projectRoot)
const opentuiSolidVersion = exactVersion(sdk.devDependencies["@opentui/solid"], `@opencode/plugin@${sdk.version} devDependencies["@opentui/solid"]`)
const opentuiSolid = fetchManifest("@opentui/solid", opentuiSolidVersion, projectRoot)

const pins: Record<string, Record<string, string>> = {
  dependencies: {
    "@opencode/plugin": sdk.version,
    "@opentui/core": exactVersion(sdk.devDependencies["@opentui/core"], `@opencode/plugin@${sdk.version} devDependencies["@opentui/core"]`),
    "@opentui/solid": opentuiSolidVersion,
    "solid-js": exactVersion(opentuiSolid.peerDependencies["solid-js"], `@opentui/solid@${opentuiSolidVersion} peerDependencies["solid-js"]`),
  },
  // Types only. Without it the TUI context's theme silently types as `any`.
  devDependencies: {
    "@opencode/theme": exactVersion(sdk.peerDependencies["@opencode/theme"], `@opencode/plugin@${sdk.version} peerDependencies["@opencode/theme"]`),
  },
}

const packageJson: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"))
if (!isRecord(packageJson)) throw new Error("package.json is not a JSON object")

let changed = false
for (const [section, sectionPins] of Object.entries(pins)) {
  const current = packageJson[section]
  if (!isRecord(current)) throw new Error(`package.json has no ${section} object`)
  for (const [name, version] of Object.entries(sectionPins)) {
    if (current[name] === version) continue
    console.log(`${name}: ${String(current[name] ?? "(none)")} -> ${version}`)
    current[name] = version
    changed = true
  }
}
if (!changed) {
  console.log(`Already on @opencode/plugin@${sdk.version}`)
  process.exit(0)
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
run(["bun", "install"], projectRoot)
console.log("Updated package.json and bun.lock. Run `bun run verify:release` to boot the matching OpenCode release.")
