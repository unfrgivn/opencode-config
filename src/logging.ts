import { appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { STORAGE_DIR_NAME } from "./constants"

/** Default directory for log files */
export const DEFAULT_LOG_DIR = join(homedir(), ".cache", "opencode", STORAGE_DIR_NAME)

/** Current log directory (can be overridden for testing) */
let currentLogDir = DEFAULT_LOG_DIR

/** Track if log directory has been ensured (avoid repeated mkdirSync calls) */
let dirEnsured = false

/** Prefix for all log messages */
const LOG_PREFIX = "[fellowship]"

/**
 * Set the log directory (for testing purposes)
 * @param dir Directory path for log files
 */
export function setLogDir(dir: string): void {
  currentLogDir = dir
  dirEnsured = false
}

/**
 * Reset the log directory to the default
 */
export function resetLogDir(): void {
  currentLogDir = DEFAULT_LOG_DIR
  dirEnsured = false
}

/**
 * Get the current log file path
 */
function getLogFile(): string {
  return join(currentLogDir, "plugin.log")
}

/**
 * Get current timestamp in ISO format
 */
function timestamp(): string {
  return new Date().toISOString()
}

/**
 * Write a log message to the log file.
 * Creates the log directory if it doesn't exist.
 * Silently ignores errors (e.g., permission issues).
 * 
 * @param level Log level (INFO, ERROR, DEBUG)
 * @param message Message to log
 */
function writeLog(level: string, message: string): void {
  try {
    if (!dirEnsured) {
      mkdirSync(currentLogDir, { recursive: true })
      dirEnsured = true
    }
    appendFileSync(getLogFile(), `${timestamp()} [${level}] ${LOG_PREFIX} ${message}\n`)
  } catch {
    // Reset flag on error so we try again next time
    dirEnsured = false
  }
}

/**
 * Log an INFO level message to the log file
 * 
 * @param message Message to log
 */
export function log(message: string): void {
  writeLog("INFO", message)
}

/**
 * Log an ERROR level message to the log file
 * 
 * @param message Message to log
 */
export function logError(message: string): void {
  writeLog("ERROR", message)
}

/**
 * Log a DEBUG level message to the log file
 * 
 * @param message Message to log
 */
export function logDebug(message: string): void {
  writeLog("DEBUG", message)
}

/**
 * Log a WARN level message to the log file
 * 
 * @param message Message to log
 */
export function logWarn(message: string): void {
  writeLog("WARN", message)
}
