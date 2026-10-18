/**
 * Vision Tool Plugin
 *
 * Bypasses Claude's 8000px image limit by sending files directly to a Gemini agent.
 *
 * Usage: vision(file_path="/path/to/large-image.png", goal="Describe what you see")
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

// MIME type mapping
export const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export const SUPPORTED_EXTENSIONS = Object.keys(MIME_TYPES).sort().join(", ");

export const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_TYPES));

function inferMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

export function parseMimeFromDataUrl(data: string): string | null {
  const match = data.match(/^data:([^;]+);base64,/);
  return match ? match[1] : null;
}

export function inferMimeTypeFromBase64(data: string): string {
  const dataUrlMime = parseMimeFromDataUrl(data);
  if (dataUrlMime) return dataUrlMime;

  // Check magic bytes in base64
  const prefix = data.slice(0, 20);
  if (prefix.startsWith("iVBORw0KGgo")) return "image/png";
  if (prefix.startsWith("/9j/")) return "image/jpeg";
  if (prefix.startsWith("R0lGOD")) return "image/gif";
  if (prefix.startsWith("UklGR")) return "image/webp";
  if (prefix.startsWith("JVBERi")) return "application/pdf";
  return "image/png"; // Default fallback
}

export function extractBase64Data(data: string): string {
  // Strip data: URL prefix if present
  const match = data.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : data;
}

// Extract assistant text from session messages
function extractLatestAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const assistantMessages = messages
    .filter(
      (msg): msg is Record<string, unknown> =>
        typeof msg === "object" && msg !== null,
    )
    .filter((msg) => {
      const info = msg.info as Record<string, unknown> | undefined;
      return info?.role === "assistant";
    })
    .sort((a, b) => {
      const aTime = (a.info as Record<string, unknown>)?.time as
        | Record<string, number>
        | undefined;
      const bTime = (b.info as Record<string, unknown>)?.time as
        | Record<string, number>
        | undefined;
      return (bTime?.created ?? 0) - (aTime?.created ?? 0);
    });

  const lastMessage = assistantMessages[0];
  if (!lastMessage) return null;

  const parts = lastMessage.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) return null;

  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
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

export function createVisionSessionInput(
  goal: string,
  visionAgent: string,
  parentSessionID: string,
  parentDirectory: string,
) {
  return {
    title: `vision: ${goal.substring(0, 50)}`,
    parentID: parentSessionID,
    agent: visionAgent,
    model: {
      providerID: "github-copilot",
      id: "gemini-3-flash-preview",
    },
    location: { directory: parentDirectory },
  };
}

export const VisionToolPlugin = async (ctx: Parameters<typeof Plugin.define>[0]["setup"] extends (input: infer C) => unknown ? C : never) => {
  const visionAgent = resolveVisionAgentName();

  const registration = await ctx.tool.transform((tools) => {
    tools.add({
      name: "vision",
        description: `Analyze media files (PDFs, images, diagrams) that require visual interpretation.
Use when you need to:
- Extract specific information from documents or images
- Describe visual content (charts, diagrams, screenshots)
- Analyze PDFs that are image-based or have complex layouts

This tool handles large images (>8000px) that would otherwise fail with Claude's API.

IMPORTANT: Use this tool INSTEAD of Read for image/PDF files. Do NOT attempt Read first - go directly to vision for any .png, .jpg, .jpeg, .gif, .webp, .pdf, .heic, .heif, .bmp, or video/audio files.`,
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

          // Validate file exists and has supported extension BEFORE proceeding
          // This prevents downstream errors that can corrupt the TUI
          if (file_path) {
            // Check for valid extension FIRST (before file existence check)
            const ext = file_path.toLowerCase().match(/\.[^.]+$/)?.[0];
            if (!ext) {
              return content("Error: File path must include an extension such as .png, .pdf, or .jpg");
            }

            // Check for supported MIME type
            const mimeType = MIME_TYPES[ext];
            if (!mimeType) {
              return content(`Error: Unsupported file extension. Supported types are: ${SUPPORTED_EXTENSIONS}`);
            }

            // Check file exists
            if (!existsSync(file_path)) {
              return content("Error: File not found at the specified path");
            }
          }

          // Build file part
          let filePart: { uri: string; name: string };
          let sourceDescription: string;
          let temporaryDir: string | null = null;

          if (image_data) {
            const mimeType = inferMimeTypeFromBase64(image_data);
            if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
              return content(`Error: Unsupported image format. Detected MIME type '${mimeType}'. Supported types are: ${[...SUPPORTED_MIME_TYPES].sort().join(", ")}`);
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
            const mimeType = inferMimeType(file_path);
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

            // Create child session with restricted permissions to reduce token overhead
            // This prevents inheriting full parent context, reducing token overhead ~3.6x
            const createResult = await ctx.session.create(
              createVisionSessionInput(goal, visionAgent, toolContext.sessionID, parentDirectory),
            );

            const sessionID = createResult.id;

            // Send prompt with file to analyst agent
            await ctx.session.prompt({
              sessionID,
              text: prompt,
              files: [filePart],
            });
            await ctx.session.wait({ sessionID });

            const generateResult = await ctx.session.generate({
              sessionID,
              prompt: "Return only the analysis result from the previous response.",
            });

            if (!generateResult.text) {
              return content(`Error: No response from ${visionAgent} agent`);
            }

            return content(generateResult.text);
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
  id: "@unfrgivn/opencode-config:vision-tool",
  setup: VisionToolPlugin,
});

export default plugin;
