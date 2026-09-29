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
        "relative grid size-10 place-items-center rounded-full",
        "transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        live && "orb-pulse",
      )}
    >
      <span
        className={cn(
          "relative grid size-8 place-items-center rounded-full",
          "bg-[#141210] text-[#efe8dc] shadow-[0_0_0_1px_rgba(239,232,220,0.16)]",
          live && "orb-live bg-[#0e0d0b] text-[#f4efe6] shadow-[0_0_0_1px_rgba(239,232,220,0.42)]",
          thinking && "bg-[#1c1a16] text-[#e8e1d4] shadow-[0_0_0_1px_rgba(239,232,220,0.28)]",
        )}
      >
        <Mic className="size-3.5" strokeWidth={1.75} />
      </span>
    </button>
  );
}
