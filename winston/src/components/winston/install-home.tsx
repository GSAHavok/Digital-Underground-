import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function InstallHome() {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [promptEvent, setPromptEvent] = useState<PromptEvent | null>(null);

  useEffect(() => {
    setInstalled(isStandalone());
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as PromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return null;

  const onPress = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setPromptEvent(null);
      setOpen(false);
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon"
        aria-label="Add Winston to Home Screen"
        aria-expanded={open}
        onClick={() => void onPress()}
      >
        <Smartphone />
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[16.5rem] rounded-xl bg-surface p-3 text-left shadow-[var(--shadow-border)]">
          <p className="text-sm font-medium text-fg">Add to Home Screen</p>
          <ol className="mt-2 space-y-1.5 text-xs leading-snug text-muted">
            <li>1. Chrome menu (three dots)</li>
            <li>2. Add to Home screen</li>
            <li>3. Tap Add</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
