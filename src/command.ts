import { z } from "zod"

/**
 * Command configuration schema matching OpenCode's Config.command
 * See: packages/opencode/src/config/config.ts
 * 
 * Commands are slash commands that users can invoke like /review or /deploy/staging.
 * The template field supports {{$arguments}} placeholder for user input.
 */
export const CommandConfigSchema = z.object({
  /** Template string with optional {{$arguments}} placeholder */
  template: z.string().min(1, "Template is required"),
  /** Description of what the command does */
  description: z.string().optional(),
  /** Agent to use for executing the command */
  agent: z.string().optional(),
  /** Model to use for the command */
  model: z.string().optional(),
  /** Whether to run as a subtask */
  subtask: z.boolean().optional(),
}).passthrough()  // Allow unknown keys for forward compatibility

export type CommandConfig = z.infer<typeof CommandConfigSchema>

/**
 * Information about a command discovered in a repository
 */
export interface CommandInfo {
  /** Command name (derived from file path, e.g., "review" or "deploy/staging") */
  name: string
  /** Full path to the command markdown file */
  path: string
  /** Parsed and validated command configuration */
  config: CommandConfig
}
