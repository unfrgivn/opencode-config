import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, rmSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { log, logError, logDebug, logWarn, setLogDir, resetLogDir } from "./logging"

describe("logging", () => {
  let tempDir: string
  let logFile: string

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), "logging-test-"))
    logFile = join(tempDir, "plugin.log")
    setLogDir(tempDir)
  })

  afterEach(() => {
    // Reset to default and clean up temp directory
    resetLogDir()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true })
    }
  })

  describe("log", () => {
    test("writes INFO level message to log file", () => {
      log("test message")
      
      expect(existsSync(logFile)).toBe(true)
      const content = readFileSync(logFile, "utf-8")
      expect(content).toContain("[INFO]")
      expect(content).toContain("[fellowship]")
      expect(content).toContain("test message")
    })

    test("includes ISO timestamp in log entry", () => {
      log("timestamp test")
      
      const content = readFileSync(logFile, "utf-8")
      // ISO timestamp format: 2024-01-12T10:30:00.000Z
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    test("appends multiple log entries", () => {
      log("first message")
      log("second message")
      
      const content = readFileSync(logFile, "utf-8")
      const lines = content.trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain("first message")
      expect(lines[1]).toContain("second message")
    })
  })

  describe("logError", () => {
    test("writes ERROR level message to log file", () => {
      logError("error occurred")
      
      expect(existsSync(logFile)).toBe(true)
      const content = readFileSync(logFile, "utf-8")
      expect(content).toContain("[ERROR]")
      expect(content).toContain("[fellowship]")
      expect(content).toContain("error occurred")
    })
  })

  describe("logDebug", () => {
    test("writes DEBUG level message to log file", () => {
      logDebug("debug info")
      
      expect(existsSync(logFile)).toBe(true)
      const content = readFileSync(logFile, "utf-8")
      expect(content).toContain("[DEBUG]")
      expect(content).toContain("[fellowship]")
      expect(content).toContain("debug info")
    })
  })

  describe("logWarn", () => {
    test("writes WARN level message to log file", () => {
      logWarn("warning message")
      
      expect(existsSync(logFile)).toBe(true)
      const content = readFileSync(logFile, "utf-8")
      expect(content).toContain("[WARN]")
      expect(content).toContain("[fellowship]")
      expect(content).toContain("warning message")
    })
  })

  describe("log format", () => {
    test("follows expected format: timestamp [level] [prefix] message", () => {
      log("format test")
      
      const content = readFileSync(logFile, "utf-8").trim()
      // Expected format: 2024-01-12T10:30:00.000Z [INFO] [fellowship] format test
      const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] \[fellowship\] format test$/
      expect(content).toMatch(pattern)
    })

    test("each log entry ends with newline", () => {
      log("newline test")
      
      const content = readFileSync(logFile, "utf-8")
      expect(content.endsWith("\n")).toBe(true)
    })
  })

  describe("directory creation", () => {
    test("creates log directory if it does not exist", () => {
      // Remove temp directory to test creation
      rmSync(tempDir, { recursive: true })
      
      log("directory creation test")
      
      expect(existsSync(tempDir)).toBe(true)
      expect(existsSync(logFile)).toBe(true)
    })
  })

  describe("error handling", () => {
    test("does not throw when logging", () => {
      // This test verifies the function doesn't throw
      // The implementation silently ignores errors
      expect(() => log("safe message")).not.toThrow()
      expect(() => logError("safe error")).not.toThrow()
      expect(() => logDebug("safe debug")).not.toThrow()
    })

    test("silently ignores write errors to unwritable path", () => {
      // Set log dir to an impossible path
      setLogDir("/dev/null/impossible")

      // Should not throw
      expect(() => log("will fail")).not.toThrow()
      expect(() => logError("will fail")).not.toThrow()
      expect(() => logDebug("will fail")).not.toThrow()

      // No file created (path doesn't exist)
      expect(existsSync("/dev/null/impossible/plugin.log")).toBe(false)
    })
  })
})
