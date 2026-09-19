import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AskBar } from "@/components/winston/ask-bar";
import { InstallHome } from "@/components/winston/install-home";
import { LibrarySheet } from "@/components/winston/library-sheet";
import { ListenOrb } from "@/components/winston/listen-orb";
import { PhotoLightbox } from "@/components/winston/photo-lightbox";
import { RecipePanel } from "@/components/winston/recipe-panel";
import { useWinston } from "@/lib/winston/use-winston";

export const Route = createFileRoute("/")({ component: Home });

function SpecsFileButton({
  id,
  disabled,
  onFiles,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className={className}>
      {children}
      <input
        id={id}
        type="file"
        accept="image/*,.heic,.heif,.png,.jpg,.jpeg,.webp"
        multiple
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length === 0) return;
          onFiles(files);
        }}
      />
    </label>
  );
}

function Home() {
  const w = useWinston();
  const onFiles = (files: File[]) => void w.addFiles(files);
  const [heroOpen, setHeroOpen] = useState(false);
  const reading = Boolean(w.active);

  useEffect(() => {
    if (!w.active) setHeroOpen(false);
  }, [w.active]);

  const phaseLabel = {
    idle: w.needsUnlock ? "Tap once to allow the mic" : "Always listening",
    listening: "Listening for Hey Winston",
    capturing: "Go ahead",
    thinking: "Looking it up",
    speaking: "Speaking",
    awaiting: "Say next, repeat, or stop",
    error: "Something went wrong",
  }[w.phase];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Voice attendant
          </p>
          <h1 className="font-display text-[2.15rem] font-medium italic leading-none tracking-[-0.04em] text-fg">
            Winston
          </h1>
        </div>
        <div className="flex gap-2">
          <SpecsFileButton
            id="winston-add-header"
            disabled={w.busy}
            onFiles={onFiles}
            className="relative inline-flex size-11 items-center justify-center overflow-hidden rounded-md text-fg shadow-[var(--shadow-border)]"
          >
            <Plus className="size-4" />
            <span className="sr-only">Add Specs photos</span>
          </SpecsFileButton>
          <InstallHome />
          <Button
            variant="outline"
            size="icon"
            aria-label="Open Specs library"
            onClick={() => w.setLibraryOpen(true)}
          >
            <BookOpen />
          </Button>
        </div>
      </header>

      {!reading ? (
        <>
          <section className="mt-6 flex flex-col items-center text-center">
            <ListenOrb phase={w.phase} micOn={w.micOn} onPress={w.ensureListening} />
            <p className="mt-4 text-sm text-muted">{phaseLabel}</p>
            <p className="mt-1 max-w-[34ch] text-pretty text-base leading-snug text-fg">
              {w.statusLine}
            </p>
            {(w.heard || w.interim) && (
              <p className="mt-3 max-w-[40ch] text-sm italic text-muted">
                “{w.interim || w.heard}”
              </p>
            )}
            {w.micError ? (
              <p className="mt-3 max-w-[40ch] text-sm text-danger">{w.micError}</p>
            ) : null}
          </section>

          <div className="mt-6">
            <AskBar onAsk={w.askTyped} disabled={w.busy} />
          </div>
        </>
      ) : w.active?.photoDataUrl ? (
        <button
          type="button"
          onClick={() => setHeroOpen(true)}
          className="mt-4 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-border)]"
          aria-label="Expand spec photo"
        >
          <img
            src={w.active.photoDataUrl}
            alt={w.active.title}
            className="mx-auto max-h-[72vh] w-full bg-white object-contain object-top"
          />
        </button>
      ) : null}

      {!reading ? (
        w.library.filter((s) => s.source !== "starter").length > 0 ? (
          <section className="mt-6">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
              {w.library.filter((s) => s.source !== "starter").length} saved on this phone
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {w.library
                .filter((s) => s.source !== "starter")
                .slice(0, 4)
                .map((s) => s.title)
                .map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => w.askTyped(label)}
                    className="rounded-full bg-surface px-3.5 py-2 text-sm text-fg shadow-[var(--shadow-border)]"
                  >
                    {label}
                  </button>
                ))}
            </div>
          </section>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-sm leading-snug text-muted">
              Load the screenshots from your Specs album. Winston keeps them on
              this phone and reads them out loud.
            </p>
            <SpecsFileButton
              id="winston-add-main"
              disabled={w.busy}
              onFiles={onFiles}
              className={`relative mt-4 block overflow-hidden rounded-lg ${w.busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="inline-flex h-11 w-full items-center justify-center bg-accent px-4 text-sm font-medium text-accent-fg">
                Add Specs photos
              </span>
            </SpecsFileButton>
          </div>
        )
      ) : (
        <div className="mt-4">
          <RecipePanel
            spec={w.active!}
            stepIndex={w.stepIndex}
            reading={w.reading}
            phase={w.phase}
            hidePhoto
            onNext={() => void w.goNext()}
            onBack={() => void w.goBack()}
            onRepeat={() => void w.readCurrent()}
            onRead={() => void w.openSpec(w.active!, "auto")}
            onStop={() => {
              w.stopAudio();
              w.askTyped("stop");
            }}
            onDelete={() => w.removeSpec(w.active!.id)}
          />
        </div>
      )}

      {!reading ? (
        <p className="mt-auto pt-8 text-center text-xs leading-relaxed text-subtle">
          Leave this screen open. Say Hey Winston, then your request. While a card
          is open you can say next, repeat, or stop.
        </p>
      ) : null}

      <LibrarySheet
        open={w.libraryOpen}
        onClose={() => w.setLibraryOpen(false)}
        library={w.library}
        busy={w.busy}
        onOpenSpec={(spec) => void w.openSpec(spec, "manual")}
        onAddFiles={onFiles}
        onDeleteSpec={(spec) => w.removeSpec(spec.id)}
      />

      {heroOpen && w.active?.photoDataUrl ? (
        <PhotoLightbox
          src={w.active.photoDataUrl}
          alt={w.active.title}
          onClose={() => setHeroOpen(false)}
        />
      ) : null}

      {w.needsUnlock ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/92 px-8 text-center"
          onClick={w.unlockMic}
        >
          <p className="font-display text-3xl font-medium italic tracking-[-0.04em]">Winston</p>
          <p className="mt-4 max-w-[28ch] text-pretty text-base leading-snug text-fg">
            Your phone asks for the microphone once. Tap anywhere, then just say Hey Winston.
          </p>
        </button>
      ) : null}
    </main>
  );
}
