const DB_NAME = "winston-hours";
const STORE = "shifts";
const LITE = "winston-hours-lite";

export type Shift = {
  id: string;
  inAt: number;
  outAt: number | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeHours(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function readLite(): Shift[] {
  try {
    const raw = localStorage.getItem(LITE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Shift[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLite(rows: Shift[]) {
  try {
    localStorage.setItem(LITE, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

export async function listShifts(): Promise<Shift[]> {
  const lite = readLite();
  if (typeof indexedDB === "undefined") return lite.sort((a, b) => b.inAt - a.inAt);
  try {
    const db = await openDb();
    const rows = await new Promise<Shift[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Shift[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const byId = new Map<string, Shift>();
    for (const row of lite) byId.set(row.id, row);
    for (const row of rows) byId.set(row.id, row);
    const all = [...byId.values()].sort((a, b) => b.inAt - a.inAt);
    writeLite(all);
    return all;
  } catch {
    return lite.sort((a, b) => b.inAt - a.inAt);
  }
}

async function put(shift: Shift) {
  const all = await listShifts();
  writeLite([shift, ...all.filter((s) => s.id !== shift.id)]);
  notify();
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(shift);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteShift(id: string) {
  writeLite(readLite().filter((s) => s.id !== id));
  notify();
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    notify();
  } catch {
    notify();
  }
}

export function openShift(rows: Shift[]) {
  return rows.find((s) => s.outAt == null) ?? null;
}

export function parseShiftTime(raw: string, now = new Date()): number | null {
  let t = raw
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  t = t.replace(/^(?:for|at|to|around|about)\s+/, "");

  let meridiem: "am" | "pm" | null = null;
  if (/\b(a\s*m|am|morning)\b/.test(t)) meridiem = "am";
  else if (/\b(p\s*m|pm|afternoon|evening|night)\b/.test(t)) meridiem = "pm";
  t = t
    .replace(/\b(a\s*m|am|p\s*m|pm|in the morning|in the afternoon|in the evening|at night|morning|afternoon|evening|night)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const mins: Record<string, number> = {
    five: 5,
    ten: 10,
    fifteen: 15,
    quarter: 15,
    twenty: 20,
    "twenty five": 25,
    thirty: 30,
    half: 30,
    "thirty five": 35,
    forty: 40,
    "forty five": 45,
    fifty: 50,
    "fifty five": 55,
  };

  let hour: number | null = null;
  let minute = 0;
  const numeric = t.match(/^(\d{1,2})(?:\s*[:]\s*(\d{2}))?\b/);
  if (numeric) {
    hour = Number(numeric[1]);
    minute = numeric[2] ? Number(numeric[2]) : 0;
  } else {
    const word = t.match(
      /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(?:oh\s+)?(\d{1,2}|fifteen|twenty(?: five)?|thirty(?: five)?|forty(?: five)?|fifty(?: five)?|quarter|half|five|ten))?/,
    );
    if (word?.[1]) {
      hour = words[word[1]] ?? null;
      const bit = (word[2] ?? "").trim();
      if (/^\d+$/.test(bit)) minute = Number(bit);
      else if (bit) minute = mins[bit] ?? 0;
    }
  }
  if (hour == null || minute > 59) return null;
  if (hour >= 13 && hour <= 23) {
    // already 24-hour
  } else {
    if (hour < 1 || hour > 12) return null;
    if (!meridiem) meridiem = hour === 12 || hour < 8 ? "pm" : "am";
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  }
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export async function clockIn(at = Date.now(), specified = false) {
  const rows = await listShifts();
  const open = openShift(rows);
  if (open) {
    if (!specified) return { ok: false as const, open };
    const shift: Shift = { ...open, inAt: at };
    await put(shift);
    return { ok: true as const, shift, moved: true };
  }
  const shift: Shift = { id: `shift-${Date.now()}`, inAt: at, outAt: null };
  await put(shift);
  return { ok: true as const, shift, moved: false };
}

export async function clockOut(now = Date.now()) {
  const rows = await listShifts();
  const open = openShift(rows);
  if (!open) return { ok: false as const };
  const shift: Shift = { ...open, outAt: now };
  await put(shift);
  return { ok: true as const, shift };
}

export function formatClock(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(ms);
}

export function formatDay(ms: number) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(ms);
}

export function formatDuration(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} minutes`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minutes`;
}

export function weekTotal(rows: Shift[], now = Date.now()) {
  const start = new Date(now);
  const day = start.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - mondayOffset);
  const from = start.getTime();
  let ms = 0;
  for (const row of rows) {
    if (row.inAt < from) continue;
    const end = row.outAt ?? (row.inAt >= from ? now : row.inAt);
    if (row.outAt == null && row.inAt >= from) ms += now - row.inAt;
    else if (row.outAt != null) ms += Math.max(0, row.outAt - row.inAt);
    void end;
  }
  return ms;
}
