import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown
}

describe("write-ticket generator", () => {
  test("generates ADF and full acli JSON artifacts from canonical spec", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "write-ticket-generator-"))

    try {
      const inputPath = path.join(tempDir, "ticket-spec.json")
      const outputDir = path.join(tempDir, "out")
      await writeFile(
        inputPath,
        JSON.stringify({
          projectKey: "ENG",
          issueType: "Story",
          summary: "Create tickets with ADF",
          businessValue: "Jira descriptions should render in the WYSIWYG editor.",
          acceptanceCriteria: [
            "Given a generated ticket, when it is created in Jira, then the description is ADF.",
            "Given labels in the spec, when the acli script is generated, then the labels are included explicitly.",
          ],
          implementationDetails: ["Use the generated acli-workitem.json file with acli --from-json."],
          labels: ["jira", "adf"],
          components: ["Developer Experience"],
          priority: "Medium",
          parent: "ENG-123",
          cloudId: "cloud-123",
          storyPoints: 3,
          sprint: 729,
           fieldMappings: { storyPoints: "customfield_20045", sprint: "customfield_20046" },
        }),
        "utf8",
      )

      const process = Bun.spawn(
        ["npm", "run", "jira:ticket", "--", "--input", inputPath, "--out-dir", outputDir],
        { cwd: path.resolve("."), stderr: "pipe", stdout: "pipe" },
      )
      const exitCode = await process.exited
      const stderr = await new Response(process.stderr).text()
      expect(stderr).toBe("")
      expect(exitCode).toBe(0)

      const adf = await readJson(path.join(outputDir, "description.adf.json"))
      expect(isRecord(adf)).toBe(true)
      if (!isRecord(adf)) throw new Error("ADF output was not an object")
      expect(adf.type).toBe("doc")
      expect(adf.version).toBe(1)

      const content = adf.content
      expect(Array.isArray(content)).toBe(true)
      if (!Array.isArray(content)) throw new Error("ADF content was not an array")
      expect(content.some((node) => isRecord(node) && node.type === "panel")).toBe(false)
      expect(content.some((node) => isRecord(node) && node.type === "table")).toBe(true)
      expect(content.some((node) => isRecord(node) && node.type === "bulletList")).toBe(false)
      const table = content.find((node) => isRecord(node) && node.type === "table")
      expect(isRecord(table)).toBe(true)
      if (!isRecord(table)) throw new Error("ADF table was not an object")
      const tableRows = table.content
      expect(Array.isArray(tableRows)).toBe(true)
      if (!Array.isArray(tableRows)) throw new Error("ADF table content was not an array")
      const headerRow = tableRows[0]
      expect(isRecord(headerRow)).toBe(true)
      if (!isRecord(headerRow)) throw new Error("ADF table header row was not an object")
      expect(headerRow.content).toEqual([
        {
          type: "tableHeader",
          attrs: {},
          content: [{ type: "paragraph", content: [{ type: "text", text: "Acceptance Criteria" }] }],
        },
        {
          type: "tableHeader",
          attrs: {},
          content: [{ type: "paragraph", content: [{ type: "text", text: "UI / Diagrams / Notes" }] }],
        },
      ])

      const mcp = await readJson(path.join(outputDir, "mcp-create-issue.json"))
      expect(isRecord(mcp)).toBe(true)
      if (!isRecord(mcp)) throw new Error("MCP output was not an object")
      expect(mcp.contentFormat).toBe("adf")
      expect(mcp.description).toEqual(adf)
      expect(mcp.cloudId).toBe("cloud-123")

      const acliScript = await readFile(path.join(outputDir, "acli-create.sh"), "utf8")
      expect(acliScript).toContain("acli jira workitem create")
      expect(acliScript).toContain("--from-json \"$SCRIPT_DIR/acli-workitem.json\"")

      const acliPayload = await readJson(path.join(outputDir, "acli-workitem.json"))
      expect(isRecord(acliPayload)).toBe(true)
      if (!isRecord(acliPayload)) throw new Error("acli output was not an object")
      expect(acliPayload.description).toEqual(adf)
      expect(acliPayload.labels).toEqual(["jira", "adf"])
      expect(acliPayload.parentIssueId).toBe("ENG-123")
      expect(acliPayload.additionalAttributes).toEqual({
        components: [{ name: "Developer Experience" }],
        priority: { name: "Medium" },
        customfield_20045: 3,
        customfield_20046: 729,
      })

      const preview = await readFile(path.join(outputDir, "preview.md"), "utf8")
      expect(preview).toContain("# Create tickets with ADF")
      expect(preview).toContain("Jira descriptions should render in the WYSIWYG editor.")
      expect(preview).toContain("| Acceptance Criteria | UI / Diagrams / Notes |")
      expect(preview).toContain("| Given a generated ticket, when it is created in Jira, then the description is ADF. | |")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("uses acli from-json for simple tickets to preserve ADF", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "write-ticket-generator-simple-"))

    try {
      const inputPath = path.join(tempDir, "ticket-spec.json")
      const outputDir = path.join(tempDir, "out")
      await writeFile(
        inputPath,
        JSON.stringify({
          projectKey: "ENG",
          issueType: "Story",
          summary: "Simple ticket",
          acceptanceCriteria: ["Given a simple ticket, when it is created, then it uses generated ADF."],
          labels: ["simple"],
        }),
        "utf8",
      )

      const process = Bun.spawn(
        ["npm", "run", "jira:ticket", "--", "--input", inputPath, "--out-dir", outputDir],
        { cwd: path.resolve("."), stderr: "pipe", stdout: "pipe" },
      )
      const exitCode = await process.exited
      const stderr = await new Response(process.stderr).text()
      expect(stderr).toBe("")
      expect(exitCode).toBe(0)

      const acliScript = await readFile(path.join(outputDir, "acli-create.sh"), "utf8")
      expect(acliScript).toContain("--from-json \"$SCRIPT_DIR/acli-workitem.json\"")
      expect(acliScript).not.toContain("--description-file")

      const adf = await readJson(path.join(outputDir, "description.adf.json"))
      expect(isRecord(adf)).toBe(true)
      if (!isRecord(adf)) throw new Error("ADF output was not an object")
      const content = adf.content
      expect(Array.isArray(content)).toBe(true)
      if (!Array.isArray(content)) throw new Error("ADF content was not an array")
      expect(content.some((node) => isRecord(node) && node.type === "panel")).toBe(false)
      expect(content.some((node) => isRecord(node) && node.type === "table")).toBe(true)
      expect(content.some((node) => isRecord(node) && node.type === "bulletList")).toBe(false)

      const acliPayload = await readJson(path.join(outputDir, "acli-workitem.json"))
      expect(isRecord(acliPayload)).toBe(true)
      if (!isRecord(acliPayload)) throw new Error("acli output was not an object")
      expect(acliPayload.description).toEqual(adf)
      expect(acliPayload.labels).toEqual(["simple"])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("fails when storyPoints has no field mapping", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "write-ticket-generator-missing-story-points-"))
    try {
      const inputPath = path.join(tempDir, "ticket-spec.json")
      const outputDir = path.join(tempDir, "out")
      await writeFile(inputPath, JSON.stringify({
        projectKey: "ENG",
        issueType: "Story",
        summary: "Missing field mapping",
        acceptanceCriteria: ["The generator reports the missing mapping."],
        storyPoints: 3,
      }), "utf8")
      const process = Bun.spawn(
        ["npm", "run", "jira:ticket", "--", "--input", inputPath, "--out-dir", outputDir],
        { cwd: path.resolve("."), stderr: "pipe", stdout: "pipe" },
      )
      const exitCode = await process.exited
      const stderr = await new Response(process.stderr).text()
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain("fieldMappings.storyPoints is missing")
      expect(stderr).toContain("user's Jira site")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("fails when sprint has no field mapping", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "write-ticket-generator-missing-sprint-"))
    try {
      const inputPath = path.join(tempDir, "ticket-spec.json")
      const outputDir = path.join(tempDir, "out")
      await writeFile(inputPath, JSON.stringify({
        projectKey: "ENG",
        issueType: "Story",
        summary: "Missing field mapping",
        acceptanceCriteria: ["The generator reports the missing mapping."],
        sprint: 42,
      }), "utf8")
      const process = Bun.spawn(
        ["npm", "run", "jira:ticket", "--", "--input", inputPath, "--out-dir", outputDir],
        { cwd: path.resolve("."), stderr: "pipe", stdout: "pipe" },
      )
      const exitCode = await process.exited
      const stderr = await new Response(process.stderr).text()
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain("fieldMappings.sprint is missing")
      expect(stderr).toContain("user's Jira site")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

})
