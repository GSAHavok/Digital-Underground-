import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Spec } from "@/lib/winston/types";

export function LibrarySheet({
  open,
  onClose,
  library,
  busy,
  onOpenSpec,
  onAddFiles,
  onDeleteSpec,
}: {
  open: boolean;
  onClose: () => void;
  library: Spec[];
  busy: boolean;
  onOpenSpec: (spec: Spec) => void;
  onAddFiles: (files: File[]) => void;
  onDeleteSpec: (spec: Spec) => void;
}) {
  if (!open) return null;

  const yours = library.filter((s) => s.source !== "starter");

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-bg/70"
        aria-label="Close library"
        onClick={onClose}
      />
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface p-4 shadow-[var(--shadow-border)] sm:rounded-2xl sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-[-0.03em]">Specs</h2>
            <p className="text-sm text-muted">Saved on this phone. Winston reads these.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <label
          htmlFor="winston-lib-gallery"
          className="relative mt-4 block overflow-hidden rounded-lg"
        >
          <span className="inline-flex h-11 w-full items-center justify-center gap-2 bg-accent px-4 text-sm font-medium text-accent-fg">
            <ImagePlus className="size-4" />
            Add Specs photos
          </span>
          <input
            id="winston-lib-gallery"
            type="file"
            accept="image/*,.heic,.heif,.png,.jpg,.jpeg,.webp"
            multiple
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length === 0) return;
              onAddFiles(files.slice(0, 24));
              onClose();
            }}
          />
        </label>
        <label
          htmlFor="winston-lib-camera"
          className="relative mt-2 block overflow-hidden rounded-lg"
        >
          <span className="inline-flex h-11 w-full items-center justify-center gap-2 bg-surface-2 px-4 text-sm font-medium text-fg shadow-[var(--shadow-border)]">
            <Camera className="size-4" />
            Take photo
          </span>
          <input
            id="winston-lib-camera"
            type="file"
            accept="image/*"
            capture="environment"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length === 0) return;
              onAddFiles(files.slice(0, 24));
              onClose();
            }}
          />
        </label>

        <p className="mt-3 text-xs leading-snug text-subtle">
          Open your Specs album and select the screenshots. Winston reads them
          one by one and keeps them on this phone.
        </p>

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {yours.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-3 py-4 text-sm leading-snug text-muted">
              Nothing saved yet. Add the photos from your Specs folder.
            </p>
          ) : (
            <ul className="space-y-2">
              {yours.map((spec) => (
                <SpecRow
                  key={spec.id}
                  spec={spec}
                  onOpen={onOpenSpec}
                  onDelete={onDeleteSpec}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SpecRow({
  spec,
  onOpen,
  onDelete,
}: {
  spec: Spec;
  onOpen: (spec: Spec) => void;
  onDelete: (spec: Spec) => void;
}) {
  return (
    <li className="flex items-stretch gap-1 rounded-xl bg-surface-2 shadow-[var(--shadow-border)]">
      <button
        type="button"
        onClick={() => onOpen(spec)}
        className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left"
      >
        <span
          className={cn(
            "mt-0.5 rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
            spec.kind === "recipe" ? "bg-accent/20 text-fg" : "bg-paper/10 text-muted",
          )}
        >
          {spec.kind === "recipe" ? "Recipe" : "Process"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug">{spec.title}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {spec.steps.length} steps
            {spec.time ? ` · ${spec.time}` : ""}
            {spec.source === "drive" ? " · Drive" : spec.source === "phone" ? " · saved" : ""}
          </span>
        </span>
        {spec.photoDataUrl ? (
          <img
            src={spec.photoDataUrl}
            alt=""
            className="size-12 shrink-0 rounded-md object-cover"
          />
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Delete ${spec.title}`}
        onClick={() => onDelete(spec)}
        className="flex w-12 shrink-0 items-center justify-center text-muted hover:text-danger"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
