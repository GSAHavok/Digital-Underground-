import { createServerFn } from "@tanstack/react-start";
import { classifyCallToolError } from "@/lib/app-data/errors";
import {
  ConnectorType,
  GoogleDriveTools,
  type CallToolResult,
} from "@/lib/app-data/types";
import {
  extractDriveFiles,
  extractFileText,
  isMaybeSpecFile,
} from "./drive-parse";
import type { DriveFile, DriveStatus, ExtractedSpec, SpecKind } from "./types";

const WINSTON_VOICE = "orion";
const MAX_TTS_CHARS = 1400;
const MAX_VISION_CHARS = 1800;

type DriveSnapshot = {
  status: DriveStatus;
  files: DriveFile[];
  folderId?: string;
};

function asExtracted(value: unknown): ExtractedSpec | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  const kind: SpecKind = v.kind === "procedure" ? "procedure" : "recipe";
  const steps = Array.isArray(v.steps)
    ? v.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  if (!title || steps.length === 0) return null;
  const list = (key: string) =>
    Array.isArray(v[key])
      ? (v[key] as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
  return {
    title,
    kind,
    time: typeof v.time === "string" ? v.time : undefined,
    servings: typeof v.servings === "string" ? v.servings : undefined,
    ingredients: list("ingredients"),
    materials: list("materials"),
    steps: steps.map((s) => s.trim()),
    ingredientsHalf: list("ingredientsHalf"),
    ingredientsDouble: list("ingredientsDouble"),
    stepsHalf: list("stepsHalf"),
    stepsDouble: list("stepsDouble"),
    notes: typeof v.notes === "string" ? v.notes : undefined,
    spokenIntro:
      typeof v.spokenIntro === "string" && v.spokenIntro.trim()
        ? v.spokenIntro.trim()
        : `Here is ${title}. I'll read it step by step.`,
  };
}

function asExtractedList(value: unknown): ExtractedSpec[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(asExtracted).filter((s): s is ExtractedSpec => Boolean(s));
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.specs)) {
      return v.specs.map(asExtracted).filter((s): s is ExtractedSpec => Boolean(s));
    }
    const one = asExtracted(value);
    if (one) return [one];
  }
  return [];
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  const objStart = body.indexOf("{");
  const arrStart = body.indexOf("[");
  try {
    if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
      const end = body.lastIndexOf("}");
      if (end > objStart) return JSON.parse(body.slice(objStart, end + 1));
    }
    if (arrStart >= 0) {
      const end = body.lastIndexOf("]");
      if (end > arrStart) return JSON.parse(body.slice(arrStart, end + 1));
    }
  } catch {
    return null;
  }
  return null;
}

async function grokChat(
  messages: unknown[],
  maxTokens: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "AI is not available in this environment" };
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: maxTokens,
      temperature: 0.2,
      messages,
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `xAI API error ${res.status}` };
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return { ok: true, text: body.choices?.[0]?.message?.content ?? "" };
}

const EXTRACT_SYSTEM = `You extract recipes and how-to procedures from photos, notes, and documents.
Return ONLY JSON with this shape:
{
  "specs": [
    {
      "title": string,
      "kind": "recipe" | "procedure",
      "time": string,
      "servings": string,
      "ingredients": string[],
      "materials": string[],
      "steps": string[],
      "ingredientsHalf": string[],
      "ingredientsDouble": string[],
      "stepsHalf": string[],
      "stepsDouble": string[],
      "notes": string,
      "spokenIntro": string
    }
  ]
}
Rules:
- Kitchen spec sheets: the Process column is the steps. Title from the product or process name. Shelf life and production time go in time or notes.
- Many kitchen sheets have 1/2, Full, and 2x columns. ingredients and steps MUST be the FULL / standard batch only. Never read half and double amounts into those arrays.
- Put the 1/2 column in ingredientsHalf and stepsHalf. Put the 2x column in ingredientsDouble and stepsDouble. Leave those arrays empty if the sheet has no scaled columns.
- Do not write "1/2: … Full: … 2x: …" into one ingredient or step string.
- specs is an array. Default is ONE spec for the whole photo.
- A full recipe page with a food photo, title, ingredients, and steps is ONE spec. Do not split a single page into two cards.
- Only return two specs if there are two clearly separate titled recipes or procedures, each with its own ingredients and steps.
- Never invent a second recipe from a header, logo, food photo, or a random crop of the page.
- Do not invent extra specs. If you are unsure, return one spec for the whole image.
- kind is recipe if it is food/drink, otherwise procedure.
- steps are spoken-friendly ordered instructions, one action each, no numbering in the string.
- ingredients for food; materials for tools/parts on procedures. Keep each spec's lists only from that item.
- spokenIntro is one or two short sentences Winston will say out loud before starting. No emoji.
- If the image is unreadable, return one spec titled "Unreadable spec" with one step explaining that.`;

async function extractFromParts(
  userContent: unknown,
): Promise<{ ok: true; specs: ExtractedSpec[] } | { ok: false; error: string }> {
  const result = await grokChat(
    [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: userContent },
    ],
    3200,
  );
  if (!result.ok) return result;
  const specs = asExtractedList(parseJsonValue(result.text));
  if (specs.length === 0) return { ok: false, error: "Could not read that spec clearly." };
  return { ok: true, specs };
}

function statusFromTool(result: CallToolResult): DriveStatus | null {
  const classified = classifyCallToolError(result);
  if (!classified) return null;
  if (classified.kind === "pending") return { state: "pending" };
  if (classified.kind === "login") {
    return {
      state: "login",
      message: classified.message,
      loginUrl: result.loginUrl,
    };
  }
  if (classified.kind === "not_connected") {
    return { state: "not_connected", message: classified.message };
  }
  return { state: "error", message: classified.message };
}

export const syncSpecsFolder = createServerFn({ method: "POST" }).handler(
  async (): Promise<DriveSnapshot> => {
    const { callTool } = await import("@/lib/app-data/client.server");
    const options = { connectorType: ConnectorType.GoogleDrive };

    const searchOnce = async (args: Record<string, string>) => {
      const result = await callTool(GoogleDriveTools.search, args, options);
      return result;
    };

    const first = await searchOnce({ q: "Specs", query: "Specs" });
    const blocked = statusFromTool(first);
    if (blocked) return { status: blocked, files: [] };
    if (!first.ok) {
      return {
        status: { state: "error", message: first.errorMessage ?? "Drive search failed" },
        files: [],
      };
    }

    let hits = extractDriveFiles(first.data);

    const looksLikeSpecs = (f: DriveFile) =>
      /^specs?$/i.test(f.name.trim()) || f.name.toLowerCase().includes("specs");

    if (!hits.some(looksLikeSpecs)) {
      const second = await searchOnce({
        q: "name contains 'Specs'",
        query: "name contains 'Specs'",
      });
      if (second.ok) {
        const extra = extractDriveFiles(second.data);
        const seen = new Set(hits.map((h) => h.id));
        hits = hits.concat(extra.filter((h) => !seen.has(h.id)));
      }
    }

    const candidates = [
      ...hits.filter((f) => /^specs?$/i.test(f.name.trim())),
      ...hits.filter((f) => looksLikeSpecs(f)),
    ].filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);

    for (const candidate of candidates.slice(0, 3)) {
      const listed = await callTool(
        GoogleDriveTools.listFolder,
        {
          folderId: candidate.id,
          folder_id: candidate.id,
          id: candidate.id,
        },
        options,
      );
      const listBlocked = statusFromTool(listed);
      if (listBlocked) return { status: listBlocked, files: [] };
      if (!listed.ok) continue;
      const files = extractDriveFiles(listed.data).filter((f) => f.id !== candidate.id);
      if (files.length > 0 || candidate.isFolder) {
        return {
          status: {
            state: "ready",
            folderName: candidate.name,
            fileCount: files.filter(isMaybeSpecFile).length,
          },
          files,
          folderId: candidate.id,
        };
      }
    }

    const named = hits.filter(looksLikeSpecs);
    if (named.length > 0) {
      return {
        status: {
          state: "ready",
          folderName: "Specs",
          fileCount: named.filter(isMaybeSpecFile).length,
        },
        files: named,
      };
    }

    return {
      status: {
        state: "missing_folder",
        message:
          "Drive is connected, but I can't find a folder named Specs. Name the folder Specs, put your screenshots in it, then tap refresh.",
      },
      files: [],
    };
  },
);

export const readDriveSpec = createServerFn({ method: "POST" })
  .validator((input: { fileId: string; name: string; mimeType: string }) => input)
  .handler(async ({ data }) => {
    const { callTool } = await import("@/lib/app-data/client.server");
    const result = await callTool(
      GoogleDriveTools.readFile,
      { fileId: data.fileId, file_id: data.fileId, id: data.fileId },
      { connectorType: ConnectorType.GoogleDrive },
    );
    const blocked = statusFromTool(result);
    if (blocked) return { ok: false as const, status: blocked };
    if (!result.ok) {
      return {
        ok: false as const,
        status: {
          state: "error" as const,
          message: result.errorMessage ?? "Could not open that file",
        },
      };
    }

    const extracted = extractFileText(result.data);
    if (extracted.dataUrl) {
      const got = await extractFromParts([
        { type: "image_url", image_url: { url: extracted.dataUrl } },
        {
          type: "text",
        text: `Read this photo from the Specs folder. File name: ${data.name}. Extract every distinct recipe or procedure. If the screenshot contains two photos or two recipes, return two specs.`,
        },
      ]);
      if (!got.ok) return { ok: false as const, error: got.error };
      return { ok: true as const, specs: got.specs, photoDataUrl: extracted.dataUrl };
    }

    const text = (extracted.text ?? "").slice(0, MAX_VISION_CHARS);
    if (text.trim().length < 8) {
      return {
        ok: false as const,
        error:
          "I found that file in Specs but could not read its contents. Add a photo of it here and I'll transcribe it.",
      };
    }

    const got = await extractFromParts(
      `File name: ${data.name}\n\nExtract every distinct recipe or procedure from this document. If there are two, return two specs.\n\n${text}`,
    );
    if (!got.ok) return { ok: false as const, error: got.error };
    return { ok: true as const, specs: got.specs };
  });

export const extractFromPhoto = createServerFn({ method: "POST" })
  .validator((input: { dataUrl: string; hint?: string }) => input)
  .handler(async ({ data }) => {
    if (!data.dataUrl.startsWith("data:image/")) {
      return { ok: false as const, error: "That does not look like a photo." };
    }
    if (data.dataUrl.length > 2_200_000) {
      return { ok: false as const, error: "That photo is too large. Try a closer crop." };
    }
    const hint = data.hint?.trim() || "a recipe or procedure";
    const got = await extractFromParts([
      { type: "image_url", image_url: { url: data.dataUrl } },
      {
        type: "text",
        text: `Read this photo of ${hint}. Default is ONE spec for the whole page. A normal recipe screenshot with a picture plus ingredients and steps is still one spec. Only return two specs if two clearly separate titled recipes are visible. Do not invent a second recipe from a crop, header, or food photo. If it is a spec sheet with 1/2, Full, and 2x columns, use the Full column for ingredients and steps.`,
      },
    ]);
    if (!got.ok) return { ok: false as const, error: got.error };
    return { ok: true as const, specs: got.specs };
  });

export const speakText = createServerFn({ method: "POST" })
  .validator((input: { text: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "voice-unavailable" };
    const text = data.text.trim().slice(0, MAX_TTS_CHARS);
    if (!text) return { ok: false as const, error: "empty" };

    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text,
        voice_id: WINSTON_VOICE,
        language: "en",
        speed: 0.98,
      }),
    });
    if (!res.ok) {
      return { ok: false as const, error: `tts ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "audio/mpeg";
    return {
      ok: true as const,
      mime,
      audioBase64: buf.toString("base64"),
    };
  });
