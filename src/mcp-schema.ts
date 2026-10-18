/**
 * MCP (Model Context Protocol) configuration schema validation.
 *
 * OpenCode supports two types of MCP servers:
 * - Local: Spawns a process with command/args
 * - Remote: Connects to a remote MCP server via URL
 */

import * as fs from "fs"
import * as path from "path"
import type { McpInfo } from "./assets"
import { logWarn } from "./logging"

/**
 * Local MCP server configuration - spawns a local process
 */
export interface LocalMcpConfig {
  type: "local"
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

/**
 * Remote MCP server configuration - connects to a URL
 */
export interface RemoteMcpConfig {
  type: "remote"
  url: string
  headers?: Record<string, string>
  enabled?: boolean
}

/**
 * Valid MCP configuration - either local or remote
 */
export type McpConfig = LocalMcpConfig | RemoteMcpConfig

/**
 * Result of validating an MCP config
 */
export interface McpValidationResult {
  valid: boolean
  config?: McpConfig
  errors: string[]
  warnings: string[]
}

/**
 * Validate that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Validate that a value is a string array
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

/**
 * Validate that a value is a string-to-string record
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Object.entries(value).every(
    ([k, v]) => typeof k === "string" && typeof v === "string"
  )
}

/**
 * Validate a local MCP config
 */
function validateLocalMcp(
  obj: Record<string, unknown>
): McpValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  let command: string[] | undefined

  if (!("command" in obj)) {
    errors.push("Local MCP requires 'command' field")
  } else if (isStringArray(obj.command)) {
    if (obj.command.length === 0 || obj.command.some((part) => part.trim().length === 0)) {
      errors.push("'command' must be a non-empty array of non-empty strings")
    } else {
      command = obj.command
    }
  } else if (isNonEmptyString(obj.command)) {
    if ("args" in obj && obj.args !== undefined) {
      if (!isStringArray(obj.args)) {
        errors.push("'args' must be an array of strings")
      } else {
        warnings.push("'command' string + 'args' is deprecated, normalize to command array")
        command = [obj.command, ...obj.args]
      }
    } else {
      warnings.push("'command' string is deprecated, normalize to command array")
      command = [obj.command]
    }
  } else {
    errors.push("'command' must be an array of strings")
  }

  let environment: Record<string, string> | undefined

  if ("environment" in obj && obj.environment !== undefined) {
    if (!isStringRecord(obj.environment)) {
      errors.push("'environment' must be an object with string values")
    } else {
      environment = obj.environment
    }
  }

  if ("env" in obj && obj.env !== undefined) {
    if (!isStringRecord(obj.env)) {
      errors.push("'env' must be an object with string values")
    } else if (environment !== undefined) {
      warnings.push("Both 'environment' and deprecated 'env' provided, using 'environment'")
    } else {
      warnings.push("'env' is deprecated, use 'environment'")
      environment = obj.env
    }
  }

  if ("enabled" in obj && obj.enabled !== undefined) {
    if (typeof obj.enabled !== "boolean") {
      warnings.push("'enabled' should be a boolean, will be ignored")
    }
  }

  if ("timeout" in obj && obj.timeout !== undefined) {
    if (!Number.isInteger(obj.timeout) || (obj.timeout as number) <= 0) {
      errors.push("'timeout' must be a positive integer")
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  if (command === undefined) {
    return { valid: false, errors: ["'command' must be an array of strings"], warnings }
  }

  const config: LocalMcpConfig = {
    type: "local",
    command,
    ...(environment !== undefined && { environment }),
    ...(typeof obj.enabled === "boolean" && { enabled: obj.enabled }),
    ...(typeof obj.timeout === "number" && { timeout: obj.timeout }),
  }

  return { valid: true, config, errors: [], warnings }
}

/**
 * Validate a remote MCP config
 */
function validateRemoteMcp(
  obj: Record<string, unknown>
): McpValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // url is required
  if (!("url" in obj)) {
    errors.push("Remote MCP requires 'url' field")
  } else if (!isNonEmptyString(obj.url)) {
    errors.push("'url' must be a non-empty string")
  }

  // headers is optional but must be string record
  if ("headers" in obj && obj.headers !== undefined) {
    if (!isStringRecord(obj.headers)) {
      errors.push("'headers' must be an object with string values")
    }
  }

  // enabled is optional but must be boolean
  if ("enabled" in obj && obj.enabled !== undefined) {
    if (typeof obj.enabled !== "boolean") {
      warnings.push("'enabled' should be a boolean, will be ignored")
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  const config: RemoteMcpConfig = {
    type: "remote",
    url: obj.url as string,
    ...(obj.headers !== undefined && { headers: obj.headers as Record<string, string> }),
    ...(typeof obj.enabled === "boolean" && { enabled: obj.enabled }),
  }

  return { valid: true, config, errors: [], warnings }
}

/**
 * Validate an MCP config object (parsed JSON)
 */
export function validateMcpConfig(obj: unknown): McpValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Must be an object
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return {
      valid: false,
      errors: ["MCP config must be a JSON object"],
      warnings: [],
    }
  }

  const record = obj as Record<string, unknown>

  // Check type field
  if (!("type" in record)) {
    // Try to infer type from fields
    if ("command" in record) {
      const result = validateLocalMcp({ ...record, type: "local" })
      result.warnings.unshift("Missing 'type' field, inferring type='local' from 'command'")
      return result
    }
    if ("url" in record) {
      const result = validateRemoteMcp({ ...record, type: "remote" })
      result.warnings.unshift("Missing 'type' field, inferring type='remote' from 'url'")
      return result
    }
    errors.push("MCP config requires 'type' field ('local' or 'remote')")
    return { valid: false, errors, warnings }
  }

  if (record.type === "local") {
    return validateLocalMcp(record)
  }

  if (record.type === "remote") {
    return validateRemoteMcp(record)
  }

  errors.push(`Invalid type '${record.type}', must be 'local' or 'remote'`)
  return { valid: false, errors, warnings }
}

/**
 * Read and validate an MCP config file
 */
export function validateMcpFile(mcpJsonPath: string): McpValidationResult {
  try {
    const content = fs.readFileSync(mcpJsonPath, "utf-8")
    const parsed = JSON.parse(content)
    return validateMcpConfig(parsed)
  } catch (err) {
    if (err instanceof SyntaxError) {
      return {
        valid: false,
        errors: [`Invalid JSON: ${err.message}`],
        warnings: [],
      }
    }
    return {
      valid: false,
      errors: [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    }
  }
}

/**
 * Validate an MCP from McpInfo and log warnings
 * Returns true if valid (can be installed), false otherwise
 */
export function validateMcpInfo(mcp: McpInfo): boolean {
  const mcpJsonPath = mcp.path.endsWith(".json") ? mcp.path : path.join(mcp.path, "mcp.json")
  const result = validateMcpFile(mcpJsonPath)

  // Log warnings
  for (const warning of result.warnings) {
    logWarn(`MCP '${mcp.name}': ${warning}`)
  }

  // Log errors but don't throw - we just skip invalid MCPs
  if (!result.valid) {
    for (const error of result.errors) {
      logWarn(`MCP '${mcp.name}' invalid: ${error}`)
    }
    return false
  }

  return true
}

/**
 * Filter MCPs to only include valid ones, logging warnings for invalid
 */
export function filterValidMcps(mcps: McpInfo[]): McpInfo[] {
  return mcps.filter((mcp) => validateMcpInfo(mcp))
}
