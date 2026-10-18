import * as os from "node:os"
import * as path from "node:path"
import { STORAGE_DIR_NAME } from "./constants"

export function homeDir(): string {
  const home = process.env.HOME?.trim()
  return home || os.homedir()
}

export function opencodeConfigDir(): string {
  return path.join(homeDir(), ".config", "opencode")
}

export function opencodeCacheDir(): string {
  return path.join(homeDir(), ".cache", "opencode")
}

export function fellowshipCacheDir(): string {
  return path.join(opencodeCacheDir(), STORAGE_DIR_NAME)
}

export function dataHomeDir(): string {
  const dataHome = process.env.XDG_DATA_HOME?.trim()
  return dataHome && path.isAbsolute(dataHome)
    ? dataHome
    : path.join(homeDir(), ".local", "share")
}
