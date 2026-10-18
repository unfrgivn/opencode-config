/**
 * Vision Tool Plugin
 *
 * Analyze PNG, JPEG, and WebP files in a child session on the configured analyst agent.
 *
 * Usage: vision(file_path="/path/to/image.png", goal="Describe what you see")
 *
 */

import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { opencodeConfigDir } from "./paths";
import { Plugin } from "@opencode/plugin";

export function parseJsonOrJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    output += char;
  }

  const withoutTrailingCommas = output.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

// Resolve the analyst agent name based on the user's agentNames theme.
// When "lotr", the agent is registered as "galadriel"; otherwise "analyst".
function resolveVisionAgentName(): string {
  const configPaths = [
    join(process.cwd(), ".opencode", "fellowship.json"),
    join(process.cwd(), ".opencode", "fellowship.jsonc"),
    join(opencodeConfigDir(), "fellowship.json"),
    join(opencodeConfigDir(), "fellowship.jsonc"),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const raw = parseJsonOrJsonc(readFileSync(configPath, "utf-8"));
      if (
        raw &&
        typeof raw === "object" &&
        "agentNames" in raw &&
        raw.agentNames === "lotr"
      ) {
        return "galadriel";
      }
      // Found a valid config, use its theme (or default)
      return "analyst";
    } catch {
      continue;
    }
  }
  return "analyst";
}

// Live-tested on OpenCode 2.0.32 with github-copilot/gemini-3.8-flash: PNG, JPEG, and WebP reach
// the model. BMP, HEIC, WAV, and MP4 are dropped without an error, and PDF and GIF fail the request.
export const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const SUPPORTED_EXTENSIONS = Object.keys(MIME_TYPES).sort().join(", ");

export const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_TYPES));

// No period after the command, so a model cannot read it as part of the output filename.
const CONVERSION_HINT =
  "Convert images and PDF pages to PNG first (sips converts only the first page of a PDF), for example: sips -s format png input.heic --out input.png";

export function fileExtensionError(filePath: string): string | null {
  const extension = filePath.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!extension) {
    return `Unsupported file: missing extension. Supported types are: ${SUPPORTED_EXTENSIONS}. ${CONVERSION_HINT}`;
  }
  if (extension in MIME_TYPES) return null;
  return `Unsupported file type: ${extension.slice(1).toUpperCase()}. Supported types are: ${SUPPORTED_EXTENSIONS}. ${CONVERSION_HINT}`;
}

export function parseMimeFromDataUrl(data: string): string | null {
  const match = data.match(/^data:([^;]+);base64,/);
  return match ? match[1] : null;
}

export function inferMimeTypeFromBase64(data: string): string {
  const dataUrlMime = parseMimeFromDataUrl(data);
  if (dataUrlMime) return dataUrlMime;

  const prefix = data.slice(0, 20);
  if (prefix.startsWith("iVBORw0KGgo")) return "image/png";
  if (prefix.startsWith("/9j/")) return "image/jpeg";
  if (prefix.startsWith("R0lGOD")) return "image/gif";
  if (prefix.startsWith("UklGR")) return "image/webp";
  if (prefix.startsWith("JVBERi")) return "application/pdf";
  return "image/png";
}

export function extractBase64Data(data: string): string {
  const match = data.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : data;
}

type VisionInput = {
  file_path?: string;
  image_data?: string;
  goal: string;
};

function isVisionInput(input: unknown): input is VisionInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Record<string, unknown>;
  return (
    (record.file_path === undefined || typeof record.file_path === "string") &&
    (record.image_data === undefined || typeof record.image_data === "string") &&
    typeof record.goal === "string"
  );
}

function content(text: string): { content: string } {
  return { content: text };
}

const VISION_PLUGIN_ID = "@unfrgivn/opencode-config:vision-tool";
const VISION_TOOL_NAME = "vision";

type PluginContext = Parameters<typeof Plugin.define>[0]["setup"] extends (input: infer Context) => unknown
  ? Context
  : never;
type SessionCreateInput = Parameters<PluginContext["session"]["create"]>[0];
type VisionModel = NonNullable<NonNullable<SessionCreateInput>["model"]>;
export type VisionSessionMessage = Awaited<ReturnType<PluginContext["session"]["context"]>>[number];

type VisionSessionInput = {
  goal: string;
  agent: string;
  parentSessionID: string;
  directory: string;
  agentModel?: VisionModel;
  callerModel?: VisionModel;
};

// The child is created directly, not through the `subagent` tool, so OpenCode applies none of the
// subagent defaults:
// - parentID nests it under the caller instead of listing it as a top-level session.
// - The model is explicit because a directly created session ignores its agent's model. The rule
//   matches subagents: the agent's own model, else the caller's.
// - The child cannot call `vision` or launch subagents, so it never opens more sessions. The
//   analyst prompt says to call `vision`, which would otherwise recurse. Other tools stay
//   available because OpenCode's free tier rejects requests that carry no tools (403).
export function createVisionSessionInput(input: VisionSessionInput): SessionCreateInput {
  const model = input.agentModel ?? input.callerModel;
  return {
    title: `vision: ${input.goal.substring(0, 50)}`,
    parentID: input.parentSessionID,
    agent: input.agent,
    ...(model ? { model } : {}),
    location: { directory: input.directory },
    metadata: { source: VISION_PLUGIN_ID },
    permissions: [
      { action: VISION_TOOL_NAME, resource: "*", effect: "deny" },
      { action: "subagent", resource: "*", effect: "deny" },
    ],
  };
}

type VisionOutcome = { ok: true; text: string } | { ok: false; error: string };

function isAssistantMessage(message: VisionSessionMessage): message is Extract<VisionSessionMessage, { type: "assistant" }> {
  return message.type === "assistant";
}

export function readVisionOutcome(messages: ReadonlyArray<VisionSessionMessage>): VisionOutcome {
  const idle = [...messages].reverse().find((message): message is Extract<VisionSessionMessage, { type: "idle" }> => message.type === "idle");
  if (idle?.outcome === "failed") return { ok: false, error: idle.error?.message ?? "Vision analysis failed" };
  if (idle?.outcome === "interrupted") return { ok: false, error: "Vision analysis was interrupted" };

  const assistant = [...messages].reverse().find(isAssistantMessage);
  const text = assistant?.content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n") ?? "";
  return text ? { ok: true, text } : { ok: false, error: "Vision analysis returned no text" };
}

export const VisionToolPlugin = async (ctx: PluginContext) => {
  const visionAgent = resolveVisionAgentName();

  const registration = await ctx.tool.transform((tools) => {
    tools.add({
      name: VISION_TOOL_NAME,
        description: `Analyze PNG, JPEG, and WebP images in a child session on the analyst agent's model.
Use this instead of Read for images to keep image tokens out of the calling session.
Convert other formats to PNG first.`,
      input: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to analyze" },
          image_data: { type: "string", description: "Base64 encoded image data (for clipboard/pasted images)" },
          goal: { type: "string", description: "What specific information to extract or analyze" },
        },
        required: ["goal"],
        additionalProperties: false,
      },
        async execute(args: unknown, toolContext) {
          if (!isVisionInput(args)) return content("Error: Invalid vision tool input");
          const { file_path, image_data, goal } = args;

          // Validate args
          if (!file_path && !image_data) {
            return content("Error: Must provide either 'file_path' or 'image_data'");
          }
          if (file_path && image_data) {
            return content("Error: Provide only one of 'file_path' or 'image_data', not both");
          }
          if (!goal) {
            return content("Error: Must provide 'goal' describing what to analyze");
          }

          if (file_path) {
            const extensionError = fileExtensionError(file_path);
            if (extensionError) return content(`Error: ${extensionError}`);
            if (!existsSync(file_path)) return content("Error: File not found at the specified path");
          }

          // Build file part
          let filePart: { uri: string; name: string };
          let sourceDescription: string;
          let temporaryDir: string | null = null;

          if (image_data) {
            const mimeType = inferMimeTypeFromBase64(image_data);
            if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
              return content(`Error: Unsupported image format. Detected MIME type '${mimeType}'. Supported types are: ${[...SUPPORTED_MIME_TYPES].sort().join(", ")}. ${CONVERSION_HINT}`);
            }
            const base64Data = extractBase64Data(image_data);
            temporaryDir = mkdtempSync(join(tmpdir(), "fellowship-vision-"));
            const extension = Object.entries(MIME_TYPES).find(([, value]) => value === mimeType)?.[0] ?? ".png";
            const temporaryPath = join(temporaryDir, `clipboard-image${extension}`);
            writeFileSync(temporaryPath, base64Data, "base64");
            filePart = {
              uri: pathToFileURL(temporaryPath).href,
              name: basename(temporaryPath),
            };
            sourceDescription = "clipboard/pasted image";
          } else if (file_path) {
            filePart = {
              uri: pathToFileURL(file_path).href,
              name: basename(file_path),
            };
            sourceDescription = file_path;
          } else {
            return content("Error: Must provide either 'file_path' or 'image_data'");
          }

          // Build prompt
          const prompt = `Analyze this file and extract the requested information.

Goal: ${goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`;

          try {
            // Get parent session directory
            const parentSession = await ctx.session
              .get({ sessionID: toolContext.sessionID })
              .catch(() => null);
            const parentDirectory =
              parentSession?.location.directory ?? process.cwd();

            // An unknown agent falls back to the caller's model; session.create then reports the
            // missing agent itself.
            const agentModel = await ctx.agent
              .get({ agentID: visionAgent })
              .then((agent) => agent.data.model)
              .catch(() => undefined);
            const createResult = await ctx.session.create(createVisionSessionInput({
              goal,
              agent: visionAgent,
              parentSessionID: toolContext.sessionID,
              directory: parentDirectory,
              agentModel,
              callerModel: parentSession?.model,
            }));

            const sessionID = createResult.id;

            // Send prompt with file to analyst agent
            await ctx.session.prompt({
              sessionID,
              text: prompt,
              files: [filePart],
            });
            await ctx.session.wait({ sessionID });

            const outcome = readVisionOutcome(await ctx.session.context({ sessionID }));
            return outcome.ok
              ? content(outcome.text)
              : content(`Error analyzing ${sourceDescription}: ${outcome.error}`);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            return content(`Error analyzing ${sourceDescription}: ${errorMessage}`);
          } finally {
            if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true });
          }
        },
      });
  });

  return async () => {
    await registration.dispose();
  };
};

const plugin = Plugin.define({
  id: VISION_PLUGIN_ID,
  setup: VisionToolPlugin,
});

export default plugin;
