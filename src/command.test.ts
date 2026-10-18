import { describe, expect, test } from "bun:test"
import { CommandConfigSchema } from "./command"

describe("command", () => {
  describe("CommandConfigSchema", () => {
    test("validates minimal command with template only", () => {
      const result = CommandConfigSchema.safeParse({
        template: "Review the current PR",
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.template).toBe("Review the current PR")
      }
    })

    test("validates full command config", () => {
      const config = {
        template: "Deploy to {{$arguments}}",
        description: "Deploy to specified environment",
        agent: "deploy-agent",
        model: "anthropic/claude-3-5-sonnet",
        subtask: true,
      }
      const result = CommandConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.template).toBe("Deploy to {{$arguments}}")
        expect(result.data.description).toBe("Deploy to specified environment")
        expect(result.data.agent).toBe("deploy-agent")
        expect(result.data.model).toBe("anthropic/claude-3-5-sonnet")
        expect(result.data.subtask).toBe(true)
      }
    })

    test("rejects command without template", () => {
      const result = CommandConfigSchema.safeParse({
        description: "A command without template",
      })
      expect(result.success).toBe(false)
    })

    test("rejects empty template", () => {
      const result = CommandConfigSchema.safeParse({
        template: "",
      })
      expect(result.success).toBe(false)
    })

    test("allows unknown keys for forward compatibility", () => {
      const config = {
        template: "Do something",
        futureField: "some value",
        anotherUnknown: 123,
      }
      const result = CommandConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.template).toBe("Do something")
        // Unknown fields should pass through
        expect((result.data as Record<string, unknown>).futureField).toBe("some value")
      }
    })

    test("validates subtask as boolean only", () => {
      // Valid boolean
      const validResult = CommandConfigSchema.safeParse({
        template: "Test",
        subtask: false,
      })
      expect(validResult.success).toBe(true)

      // Invalid string
      const invalidResult = CommandConfigSchema.safeParse({
        template: "Test",
        subtask: "true",
      })
      expect(invalidResult.success).toBe(false)
    })
  })
})
