import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PhotoLightbox } from "@/components/winston/photo-lightbox";
import { cn } from "@/lib/utils";
import { displayScales, stepsFor } from "@/lib/winston/batch";
import type { AgentPhase, Spec } from "@/lib/winston/types";

export function RecipePanel({
  spec,
  stepIndex,
  reading,
  phase,
  onNext,
  onBack,
  onRepeat,
  onRead,
  onStop,
  onDelete,
  hidePhoto = false,
}: {
  spec: Spec;
  stepIndex: number;
  reading: "intro" | "ingredients" | "step";
  phase: AgentPhase;
  onNext: () => void;
  onBack: () => void;
  onRepeat: () => void;
  onRead: () => void;
  onStop: () => void;
  onDelete: () => void;
  hidePhoto?: boolean;
}) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const scales = displayScales(spec);
  const needs = spec.kind === "recipe" ? scales.full : spec.materials;
  const needLabel = spec.kind === "recipe" ? "Ingredients · full" : "What you need";
  const steps = stepsFor(spec, "full");
  const speaking = phase === "speaking";

  return (
    <article className="rounded-2xl bg-surface p-4 text-fg shadow-[var(--shadow-border)] sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {spec.kind === "recipe" ? "Recipe" : "Procedure"}
            {spec.source === "starter" ? " · starter" : spec.source === "drive" ? " · specs" : " · added"}
          </p>
          <h2 className="mt-1 font-display text-2xl font-medium leading-tight tracking-[-0.03em]">
            {spec.title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {[spec.time, spec.servings].filter(Boolean).join(" · ")}
          </p>
        </div>
        {spec.photoDataUrl && !hidePhoto ? (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="shrink-0"
            aria-label="Expand photo"
          >
            <img
              src={spec.photoDataUrl}
              alt=""
              className="size-20 rounded-md object-cover object-top shadow-[var(--shadow-border)]"
            />
          </button>
        ) : null}
      </header>

      {needs.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            {needLabel}
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-snug">
            {needs.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {spec.kind === "recipe" && scales.half.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Half batch
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-snug text-muted">
            {scales.half.map((item) => (
              <li key={`half-${item}`} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {spec.kind === "recipe" && scales.double.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            2x batch
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-snug text-muted">
            {scales.double.map((item) => (
              <li key={`double-${item}`} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-5">
        <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Steps
        </h3>
        <ol className="mt-2 space-y-2">
          {steps.map((step, i) => {
            const current = reading === "step" && i === stepIndex;
            return (
              <li
                key={`${i}-${step.slice(0, 24)}`}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm leading-snug transition-colors duration-[var(--motion-quick)]",
                  current ? "bg-accent/20 text-fg" : "bg-transparent text-fg",
                )}
              >
                <span className="mr-2 font-medium tabular-nums text-muted">
                  {i + 1}.
                </span>
                {step}
              </li>
            );
          })}
        </ol>
      </section>

      {spec.notes ? (
        <p className="mt-4 text-sm text-muted">{spec.notes}</p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft />
          Back
        </Button>
        <Button variant="outline" onClick={onRepeat}>
          {speaking ? <Pause /> : <Play />}
          Repeat
        </Button>
        <Button variant="outline" onClick={onRead}>
          Read
        </Button>
        <Button variant="primary" onClick={onNext}>
          Next
          <ChevronRight />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onStop}
          className="py-2 text-center text-sm text-muted"
        >
          Stop reading
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="py-2 text-center text-sm text-danger"
        >
          Delete card
        </button>
      </div>

      {photoOpen && spec.photoDataUrl ? (
        <PhotoLightbox
          src={spec.photoDataUrl}
          alt={spec.title}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
    </article>
  );
}
