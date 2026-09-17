import type { Spec } from "./types";

const LS_KEY = "winston-specs-v2";
const DB_NAME = "winston-specs";
const DB_VERSION = 2;
const STORE = "library";
const PHOTOS = "photos";

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function isSpec(value: unknown): value is Spec {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    (v.kind === "recipe" || v.kind === "procedure") &&
    Array.isArray(v.steps)
  );
}

function stripPhoto(spec: Spec): Spec {
  const copy = { ...spec };
  delete copy.photoDataUrl;
  return copy;
}

function parseList(raw: string | null): Spec[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSpec).filter((s) => s.source !== "starter");
  } catch {
    return [];
  }
}

function loadLegacyLocal(): Spec[] {
  if (!canUseStorage()) return [];
  return parseList(localStorage.getItem(LS_KEY) ?? localStorage.getItem("winston-specs-v1"));
}

function saveLite(specs: Spec[]) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(specs.map(stripPhoto)));
  } catch {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify(
          specs.map((s) => ({
            ...stripPhoto(s),
            ingredients: s.ingredients.slice(0, 40),
            materials: s.materials.slice(0, 40),
            steps: s.steps.slice(0, 40),
          })),
        ),
      );
    } catch {
      // ignore
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB"));
  });
}

async function urlToBlob(url: string): Promise<Blob | null> {
  if (!url || url.length < 8) return null;
  if (url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(url);
    if (match) {
      try {
        const bin = atob(match[2]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: match[1] || "image/jpeg" });
      } catch {
        return null;
      }
    }
  }
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (!blob || blob.size < 32) return null;
    return blob;
  } catch {
    return null;
  }
}

async function blobToUrl(blob: Blob | undefined): Promise<string | undefined> {
  if (!blob || blob.size < 32) return undefined;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

export async function loadSavedSpecs(): Promise<Spec[]> {
  const lite = loadLegacyLocal();
  if (typeof indexedDB === "undefined") return lite;
  try {
    const db = await openDb();
    const rows = await new Promise<Spec[]>((resolve, reject) => {
      const tx = db.transaction(
        db.objectStoreNames.contains(PHOTOS) ? [STORE, PHOTOS] : [STORE],
        "readonly",
      );
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Spec[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const withPhotos: Spec[] = [];
    for (const row of rows.filter(isSpec).filter((s) => s.source !== "starter")) {
      let photo = row.photoDataUrl;
      if (!photo && db.objectStoreNames.contains(PHOTOS)) {
        const blob = await new Promise<Blob | undefined>((resolve, reject) => {
          const tx = db.transaction(PHOTOS, "readonly");
          const req = tx.objectStore(PHOTOS).get(row.id);
          req.onsuccess = () => resolve(req.result as Blob | undefined);
          req.onerror = () => reject(req.error);
        });
        photo = await blobToUrl(blob);
      }
      withPhotos.push({ ...row, photoDataUrl: photo });
    }
    db.close();
    const byId = new Map<string, Spec>();
    for (const spec of lite) byId.set(spec.id, spec);
    for (const spec of withPhotos) byId.set(spec.id, spec);
    return [...byId.values()];
  } catch {
    return lite;
  }
}

async function writeOne(db: IDBDatabase, spec: Spec) {
  const meta = stripPhoto(spec);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (!spec.photoDataUrl || !db.objectStoreNames.contains(PHOTOS)) return;
  const blob = await urlToBlob(spec.photoDataUrl);
  if (!blob) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PHOTOS, "readwrite");
      tx.objectStore(PHOTOS).put(blob, spec.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // keep the card text even if the photo will not fit
  }
}

export async function putSpec(spec: Spec) {
  if (spec.source === "starter") return;
  saveLite(
    mergeLibrary([
      spec,
      ...loadLegacyLocal().filter((s) => s.id !== spec.id),
    ]),
  );
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await writeOne(db, spec);
    db.close();
  } catch {
    // lite backup already written
  }
}

export async function deleteSpec(id: string) {
  saveLite(loadLegacyLocal().filter((s) => s.id !== id));
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const names = db.objectStoreNames.contains(PHOTOS) ? [STORE, PHOTOS] : [STORE];
      const tx = db.transaction(names, "readwrite");
      tx.objectStore(STORE).delete(id);
      if (db.objectStoreNames.contains(PHOTOS)) tx.objectStore(PHOTOS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

let saveChain: Promise<void> = Promise.resolve();

export async function saveSpecs(specs: Spec[]) {
  const keep = specs.filter((s) => s.source !== "starter");
  const job = saveChain.then(async () => {
    saveLite(keep);
    if (typeof indexedDB === "undefined") return;
    const db = await openDb();
    const existing = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    const keepIds = new Set(keep.map((s) => s.id));
    if (keep.length === 0 && existing.length > 0) {
      db.close();
      return;
    }
    for (const spec of keep) {
      await writeOne(db, spec);
    }
    for (const key of existing) {
      const id = String(key);
      if (keepIds.has(id)) continue;
      await new Promise<void>((resolve, reject) => {
        const names = db.objectStoreNames.contains(PHOTOS) ? [STORE, PHOTOS] : [STORE];
        const tx = db.transaction(names, "readwrite");
        tx.objectStore(STORE).delete(id);
        if (db.objectStoreNames.contains(PHOTOS)) tx.objectStore(PHOTOS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  });
  saveChain = job.catch(() => undefined);
  await saveChain;
}

export function mergeLibrary(saved: Spec[]): Spec[] {
  const byId = new Map<string, Spec>();
  for (const spec of saved) {
    if (spec.source === "starter") continue;
    byId.set(spec.id, spec);
  }
  return [...byId.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title),
  );
}
