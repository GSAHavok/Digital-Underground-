import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteShift,
  formatClock,
  formatDay,
  formatDuration,
  listShifts,
  subscribeHours,
  weekTotal,
  type Shift,
} from "@/lib/winston/hours";

export function HoursSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Shift[]>([]);

  useEffect(() => {
    if (!open) return;
    const load = () => void listShifts().then(setRows);
    load();
    return subscribeHours(load);
  }, [open]);

  if (!open) return null;

  const total = weekTotal(rows);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button type="button" className="absolute inset-0 bg-bg/70" aria-label="Close hours" onClick={onClose} />
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface p-4 shadow-[var(--shadow-border)] sm:rounded-2xl sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-[-0.03em]">Hours</h2>
            <p className="text-sm text-muted">
              This week {formatDuration(total)}. Stays on this phone.
            </p>
          </div>
          <Button variant="outline" size="icon" aria-label="Close hours" onClick={onClose}>
            <X />
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Say Winston, then clock in. When you finish, say clock out.
        </p>
        <ul className="mt-3 space-y-1.5 overflow-y-auto pb-2">
          {rows.length === 0 ? (
            <li className="rounded-xl bg-surface-2 px-3 py-4 text-sm text-muted">No punches yet.</li>
          ) : (
            rows.map((row) => {
              const span = (row.outAt ?? Date.now()) - row.inAt;
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{formatDay(row.inAt)}</p>
                    <p className="text-xs text-muted">
                      {formatClock(row.inAt)}
                      {row.outAt ? ` – ${formatClock(row.outAt)}` : " – still in"}
                      {" · "}
                      {formatDuration(span)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-muted"
                    aria-label="Delete punch"
                    onClick={() => {
                      void deleteShift(row.id).then(() => listShifts().then(setRows));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
