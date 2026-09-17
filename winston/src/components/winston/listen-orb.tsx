import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/lib/winston/types";

export function ListenOrb({
  phase,
  micOn,
  onPress,
}: {
  phase: AgentPhase;
  micOn: boolean;
  onPress: () => void;
}) {
  const live = micOn && (phase === "listening" || phase === "capturing" || phase === "awaiting");
  const thinking = phase === "thinking" || phase === "speaking";

  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={micOn}
      aria-label={micOn ? "Winston is listening" : "Allow microphone"}
      className={cn(
        "relative mx-auto grid size-[168px] place-items-center rounded-full",
        "transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        live && "orb-pulse",
      )}
    >
      <span
        className={cn(
          "relative grid size-[124px] place-items-center rounded-full",
          "bg-surface-2 text-fg shadow-[var(--shadow-border)]",
          live && "orb-live bg-accent text-accent-fg",
          thinking && "bg-paper text-ink",
        )}
      >
        <Mic className="size-9" strokeWidth={1.6} />
      </span>
    </button>
  );
}
