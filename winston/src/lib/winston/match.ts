import type { Spec, SpecKind } from "./types";

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => (t === "hi" || t === "tie" || t === "tai" || t === "ty" ? "thai" : t))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "how",
  "do",
  "to",
  "a",
  "an",
  "of",
  "in",
  "my",
  "me",
  "please",
  "recipe",
  "recipes",
  "procedure",
  "process",
  "instructions",
  "steps",
]);

export function scoreSpec(spec: Spec, query: string, kindHint?: SpecKind): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const titleToks = tokens(spec.title);
  if (titleToks.length === 0) return 0;

  let hits = 0;
  let miss = 0;
  for (const word of q) {
    if (titleToks.some((h) => h === word || h.startsWith(word) || word.startsWith(h) || close(h, word))) {
      hits += 1;
    } else if (word.length >= 4) {
      miss += 1;
    }
  }
  let score = hits / q.length;
  score -= miss * 0.24;
  const titleHits = titleToks.filter((t) =>
    q.some((word) => t === word || t.startsWith(word) || word.startsWith(t) || close(t, word)),
  ).length;
  score += 0.22 * (titleHits / titleToks.length);
  if (kindHint && spec.kind === kindHint) score += 0.08;
  const title = spec.title.toLowerCase();
  const raw = query.toLowerCase().trim();
  if (title.includes(raw)) score += 0.4;
  if (raw.includes(title) && title.length > 4) score += 0.28;
  if (spec.source !== "starter") score += 0.03;
  if (q.length === 1 && title.includes(q[0])) score += 0.28;
  return score;
}

function close(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  let miss = 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  let j = 0;
  for (let i = 0; i < longer.length && j < shorter.length; i += 1) {
    if (longer[i] === shorter[j]) j += 1;
    else miss += 1;
    if (miss > 2) return false;
  }
  return j >= shorter.length - 1;
}

export function findSpecs(
  library: Spec[],
  query: string,
  kindHint?: SpecKind,
): Spec[] {
  const ranked = library
    .map((spec) => ({ spec, score: scoreSpec(spec, query, kindHint) }))
    .filter((row) => row.score >= 0.38)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];
  const best = ranked[0];
  const rest = ranked.slice(1);
  const q = tokens(query);
  const distinctive = q.filter(
    (w) =>
      w.length >= 4 &&
      titleHas(best.spec, w) &&
      rest.every((row) => !titleHas(row.spec, w)),
  );
  if (distinctive.length > 0) return [best.spec];
  if (rest[0] && best.score >= rest[0].score + 0.1) return [best.spec];
  if (rest.length === 0) return [best.spec];
  return ranked.slice(0, 5).map((row) => row.spec);
}

function titleHas(spec: Spec, word: string) {
  const title = spec.title.toLowerCase();
  if (title.includes(word)) return true;
  return tokens(spec.title).some(
    (h) => h === word || h.startsWith(word) || word.startsWith(h) || close(h, word),
  );
}

export function pickFromList(list: Spec[], query: string): Spec | null {
  if (list.length === 0) return null;
  const q = query.toLowerCase();
  const ordinals: [RegExp, number][] = [
    [/\b(first|1st|one|number one)\b/, 0],
    [/\b(second|2nd|two|number two)\b/, 1],
    [/\b(third|3rd|three|number three)\b/, 2],
    [/\b(fourth|4th|four)\b/, 3],
    [/\b(last|latter)\b/, list.length - 1],
  ];
  for (const [re, index] of ordinals) {
    if (re.test(q) && list[index]) return list[index];
  }

  const ranked = list
    .map((spec) => ({ spec, score: scoreSpec(spec, query) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0] && ranked[0].score >= 0.16) {
    if (ranked.length === 1 || ranked[0].score >= (ranked[1]?.score ?? 0) + 0.06) {
      return ranked[0].spec;
    }
  }

  const words = tokens(query);
  const unique = list.filter((spec) =>
    words.some((w) => spec.title.toLowerCase().includes(w)),
  );
  if (unique.length === 1) return unique[0];
  return null;
}

export function titlesForKind(library: Spec[], kindHint?: SpecKind): string[] {
  const list = kindHint
    ? library.filter((s) => s.kind === kindHint)
    : library;
  return list.map((s) => s.title);
}
