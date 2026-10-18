#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const OUTPUT_FILES = {
  normalizedSpec: "ticket-spec.normalized.json",
  adf: "description.adf.json",
  preview: "preview.md",
  mcp: "mcp-create-issue.json",
  acliJson: "acli-workitem.json",
  acli: "acli-create.sh",
  rest: "rest-create-issue.json",
}

function parseArgs(argv) {
  const args = { outDir: "jira-ticket-output" }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === "--input" || arg === "-i") {
      if (!next) throw new Error("Missing value for --input")
      args.input = next
      index += 1
      continue
    }

    if (arg === "--out-dir" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out-dir")
      args.outDir = next
      index += 1
      continue
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function usage() {
  return `Usage: npm run jira:ticket -- --input ticket-spec.json --out-dir /tmp/jira-ticket

Generates Jira creation artifacts from one canonical ticket spec:
  - ${OUTPUT_FILES.adf}: Atlassian Document Format description
  - ${OUTPUT_FILES.preview}: human-readable preview
  - ${OUTPUT_FILES.acliJson}: acli --from-json payload for full field creation
  - ${OUTPUT_FILES.acli}: acli create command wrapper
  - ${OUTPUT_FILES.mcp}: Atlassian MCP create-issue arguments
  - ${OUTPUT_FILES.rest}: Jira REST API v3 create issue payload
`
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(input, key) {
  const value = input[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`ticket spec must include a non-empty string: ${key}`)
  }
  return value.trim()
}

function optionalString(input, key) {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string when provided`)
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function optionalStringArray(input, key) {
  const value = input[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings when provided`)

  return value
    .map((item, index) => {
      if (typeof item !== "string") throw new Error(`${key}[${index}] must be a string`)
      return item.trim()
    })
    .filter((item) => item.length > 0)
}

function optionalStringOrArray(input, key) {
  const value = input[key]
  if (value === undefined || value === null) return []
  if (typeof value === "string") {
    return value.split(/\n{2,}/).map((item) => item.trim()).filter((item) => item.length > 0)
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (typeof item !== "string") throw new Error(`${key}[${index}] must be a string`)
        return item.trim()
      })
      .filter((item) => item.length > 0)
  }
  throw new Error(`${key} must be a string or array of strings when provided`)
}

function optionalRecord(input, key) {
  const value = input[key]
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new Error(`${key} must be an object when provided`)
  return value
}

function optionalNumber(input, key) {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number when provided`)
  return value
}

function normalizeSpec(input) {
  if (!isRecord(input)) throw new Error("ticket spec must be a JSON object")

  const acceptanceCriteria = optionalStringArray(input, "acceptanceCriteria")
  if (acceptanceCriteria.length === 0) {
    throw new Error("ticket spec must include at least one acceptanceCriteria item")
  }

  return {
    projectKey: requiredString(input, "projectKey"),
    issueType: requiredString(input, "issueType"),
    summary: requiredString(input, "summary"),
    businessValue: optionalStringOrArray(input, "businessValue"),
    acceptanceCriteria,
    implementationDetails: optionalStringOrArray(input, "implementationDetails"),
    labels: optionalStringArray(input, "labels"),
    components: optionalStringArray(input, "components"),
    priority: optionalString(input, "priority"),
    assignee: optionalString(input, "assignee"),
    parent: optionalString(input, "parent"),
    storyPoints: optionalNumber(input, "storyPoints"),
    sprint: input.sprint ?? undefined,
    cloudId: optionalString(input, "cloudId"),
    jiraBaseUrl: optionalString(input, "jiraBaseUrl"),
    additionalFields: optionalRecord(input, "additionalFields"),
    fieldMappings: optionalRecord(input, "fieldMappings"),
  }
}

function textNode(text, marks = []) {
  const node = { type: "text", text }
  if (marks.length > 0) node.marks = marks
  return node
}

function paragraph(text, marks = []) {
  return {
    type: "paragraph",
    content: text.length > 0 ? [textNode(text, marks)] : [],
  }
}

function heading(level, text) {
  return {
    type: "heading",
    attrs: { level },
    content: [textNode(text)],
  }
}

function bulletList(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  }
}

function tableCell(text) {
  return {
    type: "tableCell",
    attrs: {},
    content: [paragraph(text)],
  }
}

function tableHeader(text) {
  return {
    type: "tableHeader",
    attrs: {},
    content: [paragraph(text)],
  }
}

function acceptanceCriteriaTable(items) {
  return {
    type: "table",
    attrs: {
      isNumberColumnEnabled: false,
      layout: "default",
    },
    content: [
      {
        type: "tableRow",
        content: [tableHeader("Acceptance Criteria"), tableHeader("UI / Diagrams / Notes")],
      },
      ...items.map((item) => ({
        type: "tableRow",
        content: [tableCell(item), tableCell("")],
      })),
    ],
  }
}

function sectionFromParagraphs(title, paragraphs) {
  const content = [heading(3, title)]
  for (const item of paragraphs) {
    content.push(...item.split("\n").map((line) => paragraph(line.trim())))
  }
  return content
}

function buildAdf(spec) {
  const content = [
    ...sectionFromParagraphs(
      "Business Value and Impact",
      spec.businessValue.length > 0 ? spec.businessValue : ["Not specified."],
    ),
    heading(3, "Acceptance Criteria"),
    acceptanceCriteriaTable(spec.acceptanceCriteria),
  ]

  if (spec.implementationDetails.length > 0) {
    content.push(...sectionFromParagraphs("Implementation Details and Additional Resources", spec.implementationDetails))
  }

  return {
    type: "doc",
    version: 1,
    content,
  }
}

function markdownList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None"
}

function markdownAcceptanceCriteriaTable(items) {
  if (items.length === 0) return "| Acceptance Criteria | UI / Diagrams / Notes |\n| --- | --- |\n| None | |"
  const rows = items.map((item) => `| ${item.replace(/\|/g, "\\|")} | |`).join("\n")
  return `| Acceptance Criteria | UI / Diagrams / Notes |\n| --- | --- |\n${rows}`
}

function buildPreview(spec) {
  const metadata = [
    ["Project", spec.projectKey],
    ["Type", spec.issueType],
    ["Priority", spec.priority ?? "None"],
    ["Labels", spec.labels.length > 0 ? spec.labels.join(", ") : "None"],
    ["Components", spec.components.length > 0 ? spec.components.join(", ") : "None"],
    ["Assignee", spec.assignee ?? "Unassigned"],
    ["Story Points", spec.storyPoints === undefined ? "None" : String(spec.storyPoints)],
    ["Sprint", spec.sprint === undefined ? "None" : String(spec.sprint)],
    ["Parent", spec.parent ?? "None"],
  ]

  return `# ${spec.summary}

${metadata.map(([key, value]) => `- **${key}:** ${value}`).join("\n")}

## Business Value and Impact

${spec.businessValue.length > 0 ? spec.businessValue.join("\n\n") : "Not specified."}

## Acceptance Criteria

${markdownAcceptanceCriteriaTable(spec.acceptanceCriteria)}

## Implementation Details and Additional Resources

${spec.implementationDetails.length > 0 ? spec.implementationDetails.join("\n\n") : "None"}
`
}

function buildAdditionalFields(spec) {
  const fields = { ...spec.additionalFields }
  addMappedPlanningFields(fields, spec)

  if (spec.components.length > 0) {
    fields.components = spec.components.map((name) => ({ name }))
  }

  if (spec.priority) {
    fields.priority = { name: spec.priority }
  }

  if (spec.labels.length > 0) {
    fields.labels = spec.labels
  }

  if (spec.parent) {
    fields.parent = { key: spec.parent }
  }

  return fields
}

function buildAcliAdditionalAttributes(spec) {
  const fields = { ...spec.additionalFields }
  addMappedPlanningFields(fields, spec)

  if (spec.components.length > 0) {
    fields.components = spec.components.map((name) => ({ name }))
  }

  if (spec.priority) {
    fields.priority = { name: spec.priority }
  }

  return fields
}

function addMappedPlanningFields(fields, spec) {
  if (spec.storyPoints !== undefined) {
    const storyPointsField = spec.fieldMappings.storyPoints
    if (typeof storyPointsField !== "string" || storyPointsField.trim().length === 0) {
      throw new Error("storyPoints is set, but fieldMappings.storyPoints is missing. Resolve the story points field ID for the user's Jira site and add it to fieldMappings.")
    }
    if (fields[storyPointsField] === undefined) fields[storyPointsField] = spec.storyPoints
  }

  if (spec.sprint !== undefined) {
    const sprintField = spec.fieldMappings.sprint
    if (typeof sprintField !== "string" || sprintField.trim().length === 0) {
      throw new Error("sprint is set, but fieldMappings.sprint is missing. Resolve the sprint field ID for the user's Jira site and add it to fieldMappings.")
    }
    if (fields[sprintField] === undefined) fields[sprintField] = spec.sprint
  }
}

function buildMcpArgs(spec, adf) {
  const args = {
    projectKey: spec.projectKey,
    issueTypeName: spec.issueType,
    summary: spec.summary,
    description: adf,
    contentFormat: "adf",
    additional_fields: buildAdditionalFields(spec),
  }

  if (spec.cloudId) args.cloudId = spec.cloudId
  return args
}

function buildRestPayload(spec, adf) {
  return {
    fields: {
      project: { key: spec.projectKey },
      issuetype: { name: spec.issueType },
      summary: spec.summary,
      description: adf,
      ...buildAdditionalFields(spec),
    },
  }
}

function buildAcliPayload(spec, adf) {
  const payload = {
    projectKey: spec.projectKey,
    type: spec.issueType,
    summary: spec.summary,
    description: adf,
  }

  if (spec.assignee) payload.assignee = spec.assignee
  if (spec.labels.length > 0) payload.labels = spec.labels
  if (spec.parent) payload.parentIssueId = spec.parent

  const additionalAttributes = buildAcliAdditionalAttributes(spec)
  if (Object.keys(additionalAttributes).length > 0) {
    payload.additionalAttributes = additionalAttributes
  }

  return payload
}

function buildAcliScript() {
  return `#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

acli jira workitem create --from-json "$SCRIPT_DIR/${OUTPUT_FILES.acliJson}" --json
`
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  if (!args.input) throw new Error("Missing required --input path")

  const inputPath = path.resolve(args.input)
  const outDir = path.resolve(args.outDir)
  const raw = await readFile(inputPath, "utf8")
  const spec = normalizeSpec(JSON.parse(raw))
  const adf = buildAdf(spec)

  await mkdir(outDir, { recursive: true })
  await writeJson(path.join(outDir, OUTPUT_FILES.normalizedSpec), spec)
  await writeJson(path.join(outDir, OUTPUT_FILES.adf), adf)
  await writeFile(path.join(outDir, OUTPUT_FILES.preview), buildPreview(spec), "utf8")
  await writeJson(path.join(outDir, OUTPUT_FILES.mcp), buildMcpArgs(spec, adf))
  await writeJson(path.join(outDir, OUTPUT_FILES.acliJson), buildAcliPayload(spec, adf))
  await writeJson(path.join(outDir, OUTPUT_FILES.rest), buildRestPayload(spec, adf))
  await writeFile(path.join(outDir, OUTPUT_FILES.acli), buildAcliScript(spec), { encoding: "utf8", mode: 0o755 })

  process.stdout.write(`Generated Jira ticket artifacts in ${outDir}\n`)
  process.stdout.write(`Preview: ${path.join(outDir, OUTPUT_FILES.preview)}\n`)
  process.stdout.write(`acli command: ${path.join(outDir, OUTPUT_FILES.acli)}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
