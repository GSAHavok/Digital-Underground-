import type { ExtractedSpec } from "./types";

function titleKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isRealSpec(spec: ExtractedSpec) {
  const title = spec.title.trim();
  if (!title || /unreadable|^untitled$|^recipe$|^procedure$|^spec$|^screenshot$/i.test(title)) {
    return false;
  }
  const steps = spec.steps.filter((s) => s.trim().length > 8);
  const needs = [...spec.ingredients, ...spec.materials].filter((s) => s.trim().length > 1);
  if (steps.length < 2 && needs.length < 2) return false;
  const blob = `${title} ${needs.join(" ")} ${steps.join(" ")}`;
  if (blob.length < 48) return false;
  if (/too long|could not read|not readable|i cannot see/i.test(blob)) return false;
  return true;
}

function mergePair(a: ExtractedSpec, b: ExtractedSpec): ExtractedSpec {
  const needsA = a.ingredients.length + a.materials.length;
  const needsB = b.ingredients.length + b.materials.length;
  const ing = needsA >= needsB ? a : b;
  const steps = a.steps.join("").length >= b.steps.join("").length ? a : b;
  return {
    ...steps,
    title: (ing.title.length >= steps.title.length ? ing.title : steps.title).trim(),
    ingredients: ing.ingredients.length ? ing.ingredients : steps.ingredients,
    materials: ing.materials.length ? ing.materials : steps.materials,
    ingredientsHalf: ing.ingredientsHalf?.length ? ing.ingredientsHalf : steps.ingredientsHalf,
    ingredientsDouble: ing.ingredientsDouble?.length ? ing.ingredientsDouble : steps.ingredientsDouble,
    time: ing.time || steps.time,
    servings: ing.servings || steps.servings,
    notes: [ing.notes, steps.notes].filter(Boolean).join(" ").trim() || undefined,
  };
}

export function coalesceSpecs(specs: ExtractedSpec[]): ExtractedSpec[] {
  const real = specs.filter(isRealSpec);
  const list = real.length > 0 ? real : specs.filter((s) => s.steps.length > 0).slice(0, 1);
  if (list.length === 2) {
    const [a, b] = list;
    const needsA = a.ingredients.length + a.materials.length;
    const needsB = b.ingredients.length + b.materials.length;
    const splitPage =
      (needsA >= 2 && a.steps.length <= 1 && b.steps.length >= 2) ||
      (needsB >= 2 && b.steps.length <= 1 && a.steps.length >= 2);
    const sameName = titleKey(a.title) === titleKey(b.title) || titleKey(a.title).includes(titleKey(b.title)) || titleKey(b.title).includes(titleKey(a.title));
    if (splitPage || sameName) return [mergePair(a, b)];
  }
  const kept: ExtractedSpec[] = [];
  for (const spec of list) {
    const dup = kept.find((k) => {
      const ka = titleKey(k.title);
      const kb = titleKey(spec.title);
      return ka === kb || ka.includes(kb) || kb.includes(ka);
    });
    if (dup) {
      if (spec.steps.join("").length > dup.steps.join("").length) {
        kept.splice(kept.indexOf(dup), 1, spec);
      }
      continue;
    }
    kept.push(spec);
  }
  return kept;
}
