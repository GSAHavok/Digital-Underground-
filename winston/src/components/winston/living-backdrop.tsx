import { useEffect, useRef, useState } from "react";
import {
  getWinstonMood,
  isTvSilent,
  subscribeTvSilent,
  subscribeWinstonMood,
  type WinstonMood,
} from "@/lib/winston/atmosphere";

const WATCH = "/life/watch.mp4";
const REACT = "/life/react.mp4";
const LISTEN = "/life/listen.mp4";
const SIDE = ["/life/darts.mp4", "/winston-bg.mp4", "/life/tea.mp4"];
const NEWS_ID = "5vfaDsMhCF4";

function newsSrc(muted: boolean) {
  const origin = typeof window === "undefined" ? "" : encodeURIComponent(window.location.origin);
  return `https://www.youtube.com/embed/${NEWS_ID}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&fs=0&enablejsapi=1&origin=${origin}`;
}

function ytCall(iframe: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

export function LivingBackdrop() {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const newsRef = useRef<HTMLIFrameElement>(null);
  const front = useRef<0 | 1>(0);
  const moodRef = useRef<WinstonMood>(getWinstonMood());
  const scene = useRef<"watch" | "side" | "react" | "listen">("watch");
  const sideIndex = useRef(0);
  const [active, setActive] = useState(0);
  const [showTv, setShowTv] = useState(true);
  const [silent, setSilent] = useState(isTvSilent());

  const show = (el: HTMLVideoElement | null) => {
    if (!el) return;
    void el.play().catch(() => undefined);
  };

  const swapTo = (src: string, loop: boolean) => {
    const next: 0 | 1 = front.current === 0 ? 1 : 0;
    const incoming = next === 0 ? aRef.current : bRef.current;
    if (!incoming) return;
    incoming.loop = loop;
    const start = () => {
      incoming.oncanplay = null;
      show(incoming);
    };
    incoming.oncanplay = start;
    if (incoming.getAttribute("src") !== src) {
      incoming.src = src;
    } else {
      incoming.currentTime = 0;
      start();
    }
    front.current = next;
    setActive(next);
  };

  const goWatch = () => {
    scene.current = "watch";
    setShowTv(true);
    swapTo(WATCH, true);
  };

  const goSide = () => {
    if (moodRef.current !== "life") return;
    scene.current = "side";
    setShowTv(false);
    const src = SIDE[sideIndex.current % SIDE.length];
    sideIndex.current += 1;
    swapTo(src, false);
  };

  const onEnded = () => {
    if (moodRef.current === "attention") {
      if (scene.current === "react") {
        scene.current = "listen";
        swapTo(LISTEN, true);
      }
      return;
    }
    if (scene.current === "side") goWatch();
  };

  const applyNewsMute = (muted: boolean) => {
    const frame = newsRef.current;
    ytCall(frame, muted ? "mute" : "unMute");
    ytCall(frame, "playVideo");
    setSilent(muted);
  };

  useEffect(() => {
    goWatch();
    const kick = () => {
      show(aRef.current);
      show(bRef.current);
      applyNewsMute(isTvSilent());
    };
    window.addEventListener("touchstart", kick, { once: true, passive: true });
    window.addEventListener("click", kick, { once: true });

    const wander = window.setInterval(() => {
      if (moodRef.current !== "life") return;
      if (scene.current !== "watch") return;
      goSide();
    }, 90_000);

    const unsubMood = subscribeWinstonMood((mood) => {
      if (moodRef.current === mood) return;
      moodRef.current = mood;
      if (mood === "attention") {
        scene.current = "react";
        setShowTv(false);
        swapTo(REACT, false);
      } else {
        goWatch();
      }
    });

    const unsubTv = subscribeTvSilent((muted) => {
      applyNewsMute(muted);
    });

    return () => {
      unsubMood();
      unsubTv();
      window.clearInterval(wander);
      window.removeEventListener("touchstart", kick);
      window.removeEventListener("click", kick);
    };
  }, []);

  return (
    <div className="winston-stage" aria-hidden>
      <video
        ref={aRef}
        className={`winston-bg-video ${active === 0 ? "is-front" : ""}`}
        muted
        playsInline
        preload="auto"
        poster="/winston-bg.jpg"
        src={WATCH}
        onEnded={onEnded}
      />
      <video
        ref={bRef}
        className={`winston-bg-video ${active === 1 ? "is-front" : ""}`}
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
      />
      <div className={`winston-tv-set ${showTv ? "" : "is-hidden"}`}>
        <iframe
          ref={newsRef}
          title="CBC News Live"
          src={newsSrc(silent)}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          tabIndex={-1}
        />
        <span className="winston-tv-glass" />
      </div>
    </div>
  );
}
