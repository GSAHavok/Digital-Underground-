import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentStation, playStation, stopRadio, subscribeRadio } from "@/lib/winston/radio";
import { STATIONS, type Station } from "@/lib/winston/stations";

export function RadioSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [now, setNow] = useState<Station | null>(currentStation());
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => subscribeRadio(setNow), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button type="button" className="absolute inset-0 bg-bg/70" aria-label="Close radio" onClick={onClose} />
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface p-4 shadow-[var(--shadow-border)] sm:rounded-2xl sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-[-0.03em]">Radio</h2>
            <p className="text-sm text-muted">Norfolk, Tillsonburg, Woodstock, London.</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Close radio" onClick={onClose}>
            <X />
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Say Winston, then play radio, or play 101.3. Say stop radio to turn it off.
        </p>
        <ul className="mt-3 space-y-1.5 overflow-y-auto pb-2">
          {STATIONS.map((station) => {
            const on = now?.id === station.id;
            return (
              <li key={station.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left",
                    on ? "bg-accent/20 text-fg" : "bg-surface-2 text-fg",
                  )}
                  onClick={() => {
                    setFailed(null);
                    void playStation(station)
                      .then(() => onClose())
                      .catch(() => setFailed(station.name));
                  }}
                >
                  <span>
                    <span className="block text-sm font-medium">
                      {station.freq} {station.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {station.city} · {station.format}
                    </span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                    {on ? "On" : "Play"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {failed ? (
          <p className="text-xs text-danger">{failed} didn’t start. Try another station.</p>
        ) : null}
        {now ? (
          <button type="button" className="mt-2 py-2 text-sm text-muted" onClick={() => stopRadio()}>
            Stop radio
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RadioBar() {
  const [now, setNow] = useState<Station | null>(currentStation());
  useEffect(() => subscribeRadio(setNow), []);
  if (!now) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface/90 px-3 py-2 text-xs shadow-[var(--shadow-border)]">
      <p className="min-w-0 truncate text-fg">
        {now.freq} {now.name}
      </p>
      <button type="button" className="shrink-0 text-muted" onClick={() => stopRadio()}>
        Stop
      </button>
    </div>
  );
}
