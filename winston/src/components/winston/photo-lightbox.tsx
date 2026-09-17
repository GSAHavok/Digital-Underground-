import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function PhotoLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    txRef.current = tx;
  }, [tx]);
  useEffect(() => {
    tyRef.current = ty;
  }, [ty]);

  const clamp = (s: number) => Math.min(6, Math.max(1, Number(s.toFixed(2))));

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = clamp(s + delta);
      if (next <= 1) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch.current = { dist: touchDist(e.touches), scale: scaleRef.current };
        pan.current = null;
        return;
      }
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap.current < 280) {
          lastTap.current = 0;
          if (scaleRef.current > 1) {
            reset();
          } else {
            setScale(2.4);
          }
          return;
        }
        lastTap.current = now;
        if (scaleRef.current > 1) {
          pan.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            tx: txRef.current,
            ty: tyRef.current,
          };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault();
        const ratio = touchDist(e.touches) / pinch.current.dist;
        const next = clamp(pinch.current.scale * ratio);
        setScale(next);
        if (next <= 1) {
          setTx(0);
          setTy(0);
        }
        return;
      }
      if (e.touches.length === 1 && pan.current && scaleRef.current > 1) {
        e.preventDefault();
        setTx(pan.current.tx + (e.touches[0].clientX - pan.current.x));
        setTy(pan.current.ty + (e.touches[0].clientY - pan.current.y));
      }
    };

    const onTouchEnd = () => {
      pinch.current = null;
      pan.current = null;
      if (scaleRef.current <= 1.05) reset();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.2 : -0.2);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [reset, zoomBy]);

  return (
    <div className="fixed inset-0 z-50 bg-bg/94">
      <div ref={stageRef} className="absolute inset-0 touch-none overflow-hidden">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-h-[82dvh] max-w-[92vw] select-none rounded-md"
          style={{
            width: "auto",
            height: "auto",
            objectFit: "contain",
            transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-[calc(12px+env(safe-area-inset-top))] right-4 z-10 rounded-md bg-surface p-2 text-fg shadow-[var(--shadow-border)]"
        aria-label="Close photo"
      >
        <X className="size-4" />
      </button>

      <div className="absolute bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-10 flex -translate-x-1/2 gap-2">
        <button
          type="button"
          onClick={() => zoomBy(-0.4)}
          className="rounded-md bg-surface p-3 text-fg shadow-[var(--shadow-border)]"
          aria-label="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-surface px-3 py-3 text-xs font-medium text-fg shadow-[var(--shadow-border)]"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.4)}
          className="rounded-md bg-surface p-3 text-fg shadow-[var(--shadow-border)]"
          aria-label="Zoom in"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function touchDist(touches: TouchList) {
  const a = touches[0];
  const b = touches[1];
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.max(1, Math.hypot(dx, dy));
}
