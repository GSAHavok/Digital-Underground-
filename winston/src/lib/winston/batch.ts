import type { Spec } from "./types";

export type BatchSize = "full" | "half" | "double";

const HALF_LABEL = "(?:1\\s*\\/\\s*2|½|half(?:\\s*batch)?)";
const FULL_LABEL = "(?:full(?:\\s*batch)?|standard|regular)";
const DBL_LABEL = "(?:2\\s*[x×]|2x|double(?:\\s*batch)?|twice)";

function cleanPart(value: string) {
  return value
    .replace(/[|/]+/g, " ")
    .replace(/[,;]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function grabAfter(line: string, label: string) {
  const re = new RegExp(
    `${label}\\s*[:.\\-]?\\s*(.+?)(?=\\s*(?:${HALF_LABEL}|${FULL_LABEL}|${DBL_LABEL})\\b|\\s*[|;]|$)`,
    "i",
  );
  const match = line.match(re);
  return match ? cleanPart(match[1]) : undefined;
}

export function parseScaleLine(line: string): {
  name: string;
  half?: string;
  full: string;
  double?: string;
} | null {
  const raw = line.trim();
  if (!raw) return null;
  const hasHalf = new RegExp(HALF_LABEL, "i").test(raw);
  const hasDouble = new RegExp(DBL_LABEL, "i").test(raw);
  if (!hasHalf && !hasDouble) return null;

  const pipes = raw.split("|").map((s) => s.trim()).filter(Boolean);
  if (pipes.length === 4) {
    return {
      name: pipes[0],
      half: pipes[1],
      full: pipes[2],
      double: pipes[3],
    };
  }
  if (pipes.length === 3 && hasHalf && hasDouble) {
    return { name: "", half: pipes[0], full: pipes[1], double: pipes[2] };
  }

  const half = grabAfter(raw, HALF_LABEL);
  const full = grabAfter(raw, FULL_LABEL);
  const dbl = grabAfter(raw, DBL_LABEL);
  if (!full && !half && !dbl) return null;

  const name = cleanPart(
    raw
      .replace(new RegExp(`${HALF_LABEL}\\s*[:.\\-]?\\s*[^,;|/]+`, "gi"), " ")
      .replace(new RegExp(`${FULL_LABEL}\\s*[:.\\-]?\\s*`, "gi"), " ")
      .replace(new RegExp(`${DBL_LABEL}\\s*[:.\\-]?\\s*[^,;|/]+`, "gi"), " ")
      .replace(/[()|/]+/g, " "),
  );

  return {
    name,
    half,
    full: full || stripAltScales(raw),
    double: dbl,
  };
}

export function stripAltScales(line: string) {
  let t = line;
  t = t.replace(/\([^)]*(?:1\s*\/\s*2|½|half|2\s*[x×]|2x|double)[^)]*\)/gi, "");
  t = t.replace(new RegExp(`\\b${HALF_LABEL}\\s*[:.\\-]?\\s*[^,;|/]+`, "gi"), "");
  t = t.replace(new RegExp(`\\b${DBL_LABEL}\\s*[:.\\-]?\\s*[^,;|/]+`, "gi"), "");
  t = t.replace(new RegExp(`\\b${FULL_LABEL}\\s*[:.\\-]?\\s*`, "gi"), "");
  t = t.replace(/[|/]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, "");
  return t.trim() || line.trim();
}

function joinName(name: string, amount: string) {
  const amt = amount.trim();
  const n = name.trim();
  if (!n) return amt;
  if (!amt) return n;
  if (amt.toLowerCase().includes(n.toLowerCase())) return amt;
  if (n.toLowerCase().includes(amt.toLowerCase())) return n;
  return `${amt} ${n}`.replace(/\s+/g, " ").trim();
}

export function lineForBatch(line: string, batch: BatchSize) {
  const parsed = parseScaleLine(line);
  if (parsed) {
    const amount =
      batch === "half"
        ? parsed.half || parsed.full
        : batch === "double"
          ? parsed.double || parsed.full
          : parsed.full;
    return joinName(parsed.name, amount);
  }
  if (batch === "full") return stripAltScales(line);
  return line.trim();
}

function listOr(primary: string[] | undefined, fallback: string[]) {
  return primary && primary.length > 0 ? primary : fallback;
}

export function needsFor(spec: Spec, batch: BatchSize) {
  if (spec.kind !== "recipe") return spec.materials.map((line) => lineForBatch(line, batch));
  const chosen =
    batch === "half"
      ? listOr(spec.ingredientsHalf, spec.ingredients)
      : batch === "double"
        ? listOr(spec.ingredientsDouble, spec.ingredients)
        : spec.ingredients;
  return chosen.map((line) => lineForBatch(line, batch)).filter((s) => s.length > 0);
}

export function stepsFor(spec: Spec, batch: BatchSize) {
  const chosen =
    batch === "half"
      ? listOr(spec.stepsHalf, spec.steps)
      : batch === "double"
        ? listOr(spec.stepsDouble, spec.steps)
        : spec.steps;
  return chosen.map((line) => lineForBatch(line, batch)).filter((s) => s.length > 0);
}

function differs(a: string[], b: string[]) {
  return a.length > 0 && a.join("\n").toLowerCase() !== b.join("\n").toLowerCase();
}

export function displayScales(spec: Spec) {
  const full = needsFor(spec, "full");
  const half = needsFor(spec, "half");
  const double = needsFor(spec, "double");
  return {
    full,
    half: differs(half, full) ? half : [],
    double: differs(double, full) ? double : [],
  };
}

export function batchLabel(batch: BatchSize) {
  if (batch === "half") return "half batch";
  if (batch === "double") return "double batch";
  return "full recipe";
}

export function takeBatchFromQuery(query: string): { query: string; batch?: BatchSize } {
  let batch: BatchSize | undefined;
  let next = query.trim();
  if (/\b(double(?:\s+batch)?|two times|2\s*x|2x|twice)\b/i.test(next)) {
    batch = "double";
    next = next.replace(/\b(double(?:\s+batch)?|two times|2\s*x|2x|twice)\b/gi, " ");
  } else if (/\b(half(?:\s+batch)?|one half|1\s*\/\s*2)\b/i.test(next)) {
    batch = "half";
    next = next.replace(/\b(half(?:\s+batch)?|one half|1\s*\/\s*2)\b/gi, " ");
  }
  return { query: next.replace(/\s+/g, " ").trim(), batch };
}
