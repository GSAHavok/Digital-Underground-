import type { DriveFile } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function extractDriveFiles(data: unknown): DriveFile[] {
  const out: DriveFile[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;

    const id = pickString(rec, ["id", "fileId", "file_id", "folderId", "folder_id"]);
    const name = pickString(rec, ["name", "title", "filename", "fileName"]);
    const mime =
      pickString(rec, ["mimeType", "mime_type", "mimetype"]) ??
      (typeof rec.isFolder === "boolean" && rec.isFolder
        ? "application/vnd.google-apps.folder"
        : "");

    if (id && name) {
      if (!seen.has(id)) {
        seen.add(id);
        const isFolder =
          mime === "application/vnd.google-apps.folder" ||
          rec.isFolder === true ||
          /folder/i.test(mime);
        out.push({
          id,
          name,
          mimeType: mime || "application/octet-stream",
          isFolder,
        });
      }
      return;
    }

    for (const value of Object.values(rec)) {
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };

  visit(data, 0);
  return out;
}

export function extractFileText(data: unknown): {
  text?: string;
  mimeType?: string;
  name?: string;
  dataUrl?: string;
} {
  const rec = asRecord(data);
  if (!rec) {
    if (typeof data === "string") return { text: data };
    return {};
  }

  const name = pickString(rec, ["name", "title", "filename"]);
  const mime = pickString(rec, ["mimeType", "mime_type", "mimetype"]);
  const text = pickString(rec, [
    "text",
    "content",
    "body",
    "extractedText",
    "extracted_text",
    "markdown",
  ]);

  const encoding = pickString(rec, ["encoding"])?.toLowerCase();
  const rawContent = pickString(rec, ["content", "data", "bytes", "base64"]);
  const looksBase64 =
    encoding === "base64" ||
    (typeof rec.base64 === "string" && rec.base64.length > 80);

  let dataUrl: string | undefined;
  if (looksBase64 && rawContent) {
    const clean = rawContent.replace(/^data:[^,]+,/, "");
    const mimeType = mime && mime.startsWith("image/") ? mime : "image/jpeg";
    dataUrl = `data:${mimeType};base64,${clean}`;
  } else if (typeof rec.base64 === "string" && rec.base64.length > 80) {
    const mimeType = mime && mime.startsWith("image/") ? mime : "image/jpeg";
    dataUrl = `data:${mimeType};base64,${rec.base64}`;
  } else if (typeof rec.dataUrl === "string") {
    dataUrl = rec.dataUrl;
  }

  if (text && !dataUrl && /image\//.test(mime ?? "") && text.length > 200 && !text.includes(" ")) {
    dataUrl = `data:${mime};base64,${text}`;
    return { mimeType: mime, name, dataUrl };
  }

  return { text, mimeType: mime, name, dataUrl };
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export function isReadableSpecFile(file: DriveFile): boolean {
  if (file.isFolder) return false;
  const mime = file.mimeType.toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/vnd.google-apps.document" ||
    mime.includes("word") ||
    /\.(jpg|jpeg|png|webp|gif|heic|pdf|txt|md|doc|docx)$/i.test(file.name)
  );
}

export function isMaybeSpecFile(file: DriveFile): boolean {
  if (file.isFolder) return false;
  if (isReadableSpecFile(file)) return true;
  return /spec|recipe|screen|img[_-]|image|photo|proc/i.test(file.name);
}
