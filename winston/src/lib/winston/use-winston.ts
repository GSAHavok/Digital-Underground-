import { useCallback, useEffect, useRef, useState } from "react";
import { isFramed } from "@/lib/app-data/login";
import { useRefetchWhenConnectorReady } from "@/lib/app-data/use-connector-readiness";
import {
  extractFromPhoto,
  readDriveSpec,
  speakText,
  syncSpecsFolder,
} from "./actions";
import { isReadableSpecFile, isMaybeSpecFile } from "./drive-parse";
import { foldHeard, isHandsFreeCommand, parseIntent, spokenList, stripWake } from "./intent";
import { measurePhoto, preparePhoto, splitIntoHalves } from "./image";
import {
  bestTranscript,
  getSpeechRecognition,
  isSpeechSupported,
  requestMicAccess,
  requestWakeLock,
  type SpeechRecognitionLike,
} from "./listen";
import { findSpecs, pickFromList } from "./match";
import { deleteSpec, loadSavedSpecs, mergeLibrary, putSpec, saveSpecs } from "./storage";
import type { AgentPhase, DriveFile, DriveStatus, ExtractedSpec, Spec } from "./types";

type SpeakMode = "auto" | "manual";

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickBrowserVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  cachedVoice =
    voices.find((v) => /en-US/i.test(v.lang) && /google/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    voices[0] ??
    null;
  return cachedVoice;
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.96;
    u.pitch = 1;
    const voice = pickBrowserVoice();
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

const SHEET_HINT =
  "a kitchen spec sheet. The Process column is the steps. Title from the product name. Shelf life and production time go in time or notes. Extract only what is in this image.";

function clipSpeech(text: string, max = 1400) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const idx = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return idx > 120 ? cut.slice(0, idx + 1) : cut;
}

function playTimeoutMs(text: string) {
  return Math.min(120_000, Math.max(20_000, text.length * 95 + 5000));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractSpecsFromUrl(
  dataUrl: string,
  hint?: string,
  ms = 48_000,
): Promise<{ specs: ExtractedSpec[]; error?: string }> {
  const result = await Promise.race([
    extractFromPhoto({ data: { dataUrl, hint } }),
    new Promise<{ ok: false; error: string }>((resolve) => {
      setTimeout(
        () => resolve({ ok: false, error: "That photo took too long to read." }),
        ms,
      );
    }),
  ]);
  if ("ok" in result && result.ok && result.specs.length > 0) {
    const specs = result.specs.filter((s) => s.title !== "Unreadable spec");
    return { specs: specs.length > 0 ? specs : result.specs };
  }
  return {
    specs: [],
    error: "error" in result ? result.error : "Could not read that photo.",
  };
}

function specFromExtracted(
  extracted: ExtractedSpec,
  extras: {
    id: string;
    source: Spec["source"];
    photoDataUrl?: string;
    driveFileId?: string;
    mimeType?: string;
  },
): Spec {
  return {
    id: extras.id,
    title: extracted.title,
    kind: extracted.kind,
    source: extras.source,
    photoDataUrl: extras.photoDataUrl,
    driveFileId: extras.driveFileId,
    mimeType: extras.mimeType,
    time: extracted.time,
    servings: extracted.servings,
    ingredients: extracted.ingredients,
    materials: extracted.materials,
    steps: extracted.steps,
    notes: extracted.notes,
    spokenIntro: extracted.spokenIntro,
    updatedAt: Date.now(),
  };
}

function prettyFileName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function placeholderFromDrive(file: DriveFile): Spec {
  const title = prettyFileName(file.name) || file.name;
  return {
    id: `drive-${file.id}`,
    title,
    kind: /proc|how|step|fix|change/i.test(title) ? "procedure" : "recipe",
    source: "drive",
    driveFileId: file.id,
    mimeType: file.mimeType,
    ingredients: [],
    materials: [],
    steps: ["Winston is still reading this screenshot."],
    spokenIntro: `I found ${title} in Specs. I'll read it in a moment.`,
    updatedAt: Date.now(),
  };
}

export function useWinston() {
  const [library, setLibrary] = useState<Spec[]>(() => mergeLibrary([]));
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [heard, setHeard] = useState("");
  const [interim, setInterim] = useState("");
  const [statusLine, setStatusLine] = useState("Always listening for Hey Winston.");
  const [active, setActive] = useState<Spec | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [reading, setReading] = useState<"intro" | "ingredients" | "step">("intro");
  const [micOn, setMicOn] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechOk, setSpeechOk] = useState(false);
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({ state: "idle" });
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantMic = useRef(true);
  const pauseRec = useRef(false);
  const ignoreUntil = useRef(0);
  const speakGen = useRef(0);
  const captureTimer = useRef<number | null>(null);
  const holdBuf = useRef("");
  const holdTimer = useRef<number | null>(null);
  const lastHeardAt = useRef(Date.now());
  const watchdog = useRef<number | null>(null);
  const pendingPicks = useRef<Spec[]>([]);
  const handling = useRef(false);
  const startingRef = useRef(false);
  const greetedRef = useRef(false);
  const indexedIds = useRef(new Set<string>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const phaseRef = useRef(phase);
  const activeRef = useRef(active);
  const stepRef = useRef(stepIndex);
  const readingRef = useRef(reading);
  const libraryRef = useRef(library);
  const skipSave = useRef(true);
  const driveFilesRef = useRef(driveFiles);
  const handleRef = useRef<(raw: string, fromTyped?: boolean) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    stepRef.current = stepIndex;
  }, [stepIndex]);
  useEffect(() => {
    readingRef.current = reading;
  }, [reading]);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  useEffect(() => {
    driveFilesRef.current = driveFiles;
  }, [driveFiles]);

  useEffect(() => {
    void (async () => {
      const saved = await loadSavedSpecs();
      setLibrary((prev) => {
        if (saved.length === 0) return prev;
        return mergeLibrary([...saved, ...prev]);
      });
      setHydrated(true);
      setSpeechOk(isSpeechSupported());
      for (const spec of saved) {
        if (spec.driveFileId) indexedIds.current.add(spec.driveFileId);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void saveSpecs(libraryRef.current);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [library, hydrated]);

  const upsertSpec = useCallback((spec: Spec) => {
    setLibrary((prev) => {
      const next = prev.filter((s) => s.id !== spec.id);
      next.unshift(spec);
      return next;
    });
    void putSpec(spec);
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const removeSpec = useCallback((id: string) => {
    if (activeRef.current?.id === id) {
      stopAudio();
      setActive(null);
      setReading("intro");
      setStepIndex(0);
      setPhase("listening");
      setStatusLine("Listening for Hey Winston.");
    }
    setLibrary((prev) => prev.filter((s) => s.id !== id));
    void deleteSpec(id);
  }, [stopAudio]);

  const clearCapture = useCallback(() => {
    if (captureTimer.current) {
      window.clearTimeout(captureTimer.current);
      captureTimer.current = null;
    }
  }, []);

  const armCapture = useCallback(() => {
    clearCapture();
    captureTimer.current = window.setTimeout(() => {
      if (phaseRef.current === "capturing") {
        pendingPicks.current = [];
        setPhase("listening");
        setStatusLine("Listening for Hey Winston.");
        setHeard("");
      }
    }, 20000);
  }, [clearCapture]);

  const resumeEar = useCallback(() => {
    if (!wantMic.current || pauseRec.current) return;
    try {
      recRef.current?.start();
    } catch {
      // already running
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const cleaned = clipSpeech(text.trim());
      if (!cleaned) return;
      const id = (speakGen.current += 1);
      pauseRec.current = true;
      ignoreUntil.current = Date.now() + 180_000;
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
      stopAudio();
      setPhase("speaking");
      try {
        let result: { ok: true; mime: string; audioBase64: string } | { ok: false; error: string } =
          { ok: false, error: "tts" };
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (speakGen.current !== id) return;
          result = await Promise.race([
            speakText({ data: { text: cleaned } }),
            new Promise<{ ok: false; error: string }>((resolve) => {
              setTimeout(() => resolve({ ok: false, error: "timeout" }), 22_000);
            }),
          ]);
          if (result.ok) break;
        }
        if (speakGen.current !== id) return;
        if (result.ok) {
          await new Promise<void>((resolve) => {
            const audio = new Audio(`data:${result.mime};base64,${result.audioBase64}`);
            audioRef.current = audio;
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(kill);
              resolve();
            };
            let kill = window.setTimeout(done, playTimeoutMs(cleaned));
            audio.onloadedmetadata = () => {
              if (Number.isFinite(audio.duration) && audio.duration > 0) {
                window.clearTimeout(kill);
                kill = window.setTimeout(done, audio.duration * 1000 + 2500);
              }
            };
            audio.onended = done;
            audio.onerror = done;
            void audio.play().then(undefined, done);
          });
        } else {
          await browserSpeak(cleaned);
        }
      } catch {
        if (speakGen.current === id) await browserSpeak(cleaned);
      } finally {
        if (speakGen.current !== id) return;
        ignoreUntil.current = Date.now() + 800;
        await sleep(500);
        if (speakGen.current !== id) return;
        pauseRec.current = false;
        resumeEar();
      }
    },
    [resumeEar, stopAudio],
  );

  const speakAndWait = useCallback(
    async (text: string, nextPhase: AgentPhase, line: string) => {
      await speak(text);
      setStatusLine(line);
      setPhase(nextPhase);
    },
    [speak],
  );

  const listSpeech = useCallback(() => {
    const own = libraryRef.current
      .filter((s) => s.source !== "starter")
      .map((s) => s.title);
    if (own.length > 0) return spokenList(own.slice(0, 12));
    const drive = driveFilesRef.current
      .filter((f) => !f.isFolder)
      .map((f) => prettyFileName(f.name));
    if (drive.length > 0) return spokenList(drive.slice(0, 12));
    return spokenList(libraryRef.current.map((s) => s.title).slice(0, 12));
  }, []);

  const returnHome = useCallback(
    async (line?: string) => {
      pendingPicks.current = [];
      setActive(null);
      setReading("intro");
      setStepIndex(0);
      setHeard("");
      if (line) {
        await speakAndWait(line, "listening", "Listening for Hey Winston.");
        return;
      }
      setPhase("listening");
      setStatusLine("Listening for Hey Winston.");
    },
    [speakAndWait],
  );

  const openSpec = useCallback(
    async (spec: Spec, mode: SpeakMode) => {
      setActive(spec);
      setStepIndex(0);
      setReading("intro");
      setLibraryOpen(false);
      if (mode === "manual") {
        setPhase("awaiting");
        setStatusLine("Say Hey Winston, then the name. Or say next.");
        return;
      }
      const needs = spec.kind === "recipe" ? spec.ingredients : spec.materials;
      if (needs.length > 0) {
        setReading("ingredients");
        await speak(`You'll need: ${needs.join(". ")}. Say next when you're ready for step one.`);
        setStatusLine("Say next, repeat, or stop.");
        setPhase("awaiting");
        return;
      }
      setReading("step");
      await speak(`Step 1 of ${spec.steps.length}. ${spec.steps[0]}.${spec.steps.length <= 1 ? " That's everything." : ""}`);
      if (spec.steps.length <= 1) {
        await returnHome();
        return;
      }
      setStatusLine("Say next, repeat, or stop.");
      setPhase("awaiting");
    },
    [returnHome, speak],
  );

  const ingestDriveFile = useCallback(
    async (file: DriveFile): Promise<Spec | null> => {
      const result = await readDriveSpec({
        data: { fileId: file.id, name: file.name, mimeType: file.mimeType },
      });
      indexedIds.current.add(file.id);
      if (!("ok" in result) || !result.ok) {
        setLibrary((prev) =>
          prev.map((s) =>
            s.id === `drive-${file.id}`
              ? {
                  ...s,
                  notes: "Could not read this screenshot yet.",
                  steps: [
                    "I found this file in Specs but could not read it clearly. Add it with Add photo.",
                  ],
                }
              : s,
          ),
        );
        return null;
      }
      const extracted = result.specs;
      const photo = "photoDataUrl" in result ? result.photoDataUrl : undefined;
      const made: Spec[] = extracted.map((item, i) =>
        specFromExtracted(item, {
          id: extracted.length === 1 ? `drive-${file.id}` : `drive-${file.id}-${i}`,
          source: "drive",
          photoDataUrl: photo,
          driveFileId: file.id,
          mimeType: file.mimeType,
        }),
      );
      setLibrary((prev) => prev.filter((s) => s.id !== `drive-${file.id}` || made.some((m) => m.id === s.id)));
      for (const spec of made) upsertSpec(spec);
      return made[0] ?? null;
    },
    [upsertSpec],
  );

  const readCurrent = useCallback(async () => {
    const spec = activeRef.current;
    if (!spec) return;
    const readingNow = readingRef.current;
    const idx = stepRef.current;
    if (readingNow === "intro") {
      await speak(spec.spokenIntro);
    } else if (readingNow === "ingredients") {
      const needs = spec.kind === "recipe" ? spec.ingredients : spec.materials;
      await speak(
        `${spec.kind === "recipe" ? "Ingredients" : "What you need"}: ${needs.join(". ")}.`,
      );
    } else {
      const step = spec.steps[idx];
      if (step) {
        await speak(`Step ${idx + 1} of ${spec.steps.length}. ${step}.`);
      }
    }
    setStatusLine("Say next, repeat, or stop.");
    setPhase("awaiting");
  }, [speak]);

  const goNext = useCallback(async () => {
    const spec = activeRef.current;
    if (!spec) {
      await speakAndWait(
        "Nothing is open. Ask me for a recipe or a process.",
        "listening",
        "Listening for Hey Winston.",
      );
      return;
    }
    if (readingRef.current === "intro") {
      const needs = spec.kind === "recipe" ? spec.ingredients : spec.materials;
      if (needs.length > 0) {
        setReading("ingredients");
        await speak(`You'll need: ${needs.join(". ")}. Say next for step one.`);
        setPhase("awaiting");
        return;
      }
      setReading("step");
      setStepIndex(0);
      await speak(`Step 1 of ${spec.steps.length}. ${spec.steps[0]}.${spec.steps.length <= 1 ? " That's everything." : ""}`);
      if (spec.steps.length <= 1) {
        await returnHome();
        return;
      }
      setPhase("awaiting");
      return;
    }
    if (readingRef.current === "ingredients") {
      setReading("step");
      setStepIndex(0);
      await speak(`Step 1 of ${spec.steps.length}. ${spec.steps[0]}.${spec.steps.length <= 1 ? " That's everything." : ""}`);
      if (spec.steps.length <= 1) {
        await returnHome();
        return;
      }
      setPhase("awaiting");
      return;
    }
    const next = stepRef.current + 1;
    if (next >= spec.steps.length) {
      await returnHome("That's everything.");
      return;
    }
    setStepIndex(next);
    const last = next + 1 >= spec.steps.length;
    await speak(
      `Step ${next + 1} of ${spec.steps.length}. ${spec.steps[next]}.${last ? " That's everything." : ""}`,
    );
    if (last) {
      await returnHome();
      return;
    }
    setPhase("awaiting");
  }, [returnHome, speak, speakAndWait]);

  const goBack = useCallback(async () => {
    const spec = activeRef.current;
    if (!spec) return;
    if (readingRef.current === "step" && stepRef.current > 0) {
      const prev = stepRef.current - 1;
      setStepIndex(prev);
      await speak(`Step ${prev + 1} of ${spec.steps.length}. ${spec.steps[prev]}.`);
      setPhase("awaiting");
      return;
    }
    if (readingRef.current === "step") {
      const needs = spec.kind === "recipe" ? spec.ingredients : spec.materials;
      if (needs.length > 0) {
        setReading("ingredients");
        await speak(
          `${spec.kind === "recipe" ? "Ingredients" : "What you need"}: ${needs.join(". ")}.`,
        );
        setPhase("awaiting");
        return;
      }
    }
    await readCurrent();
  }, [readCurrent, speak]);

  const lookup = useCallback(
    async (query: string, kindHint?: Spec["kind"]) => {
      setPhase("thinking");
      setStatusLine(`Looking up ${query}…`);
      const localHits = findSpecs(libraryRef.current, query, kindHint);

      if (localHits.length === 1) {
        await openSpec(localHits[0], "auto");
        return;
      }
      if (localHits.length > 1) {
        pendingPicks.current = localHits;
        const numbered = localHits
          .map((s, i) => `${i + 1}: ${s.title}`)
          .join(". ");
        await speakAndWait(
          `I found a few. ${numbered}. Say the number or the name.`,
          "capturing",
          "Say the number or the name.",
        );
        armCapture();
        return;
      }

      const files = driveFilesRef.current.filter((f) => {
        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const hay = prettyFileName(f.name).toLowerCase();
        return !f.isFolder && words.some((w) => hay.includes(w) || f.name.toLowerCase().includes(w));
      });

      const pick = files[0] ?? (driveFilesRef.current.filter((f) => !f.isFolder).length === 1
        ? driveFilesRef.current.find((f) => !f.isFolder)
        : undefined);

      if (pick) {
        setStatusLine(`Reading ${pick.name} from Specs…`);
        const spec = await ingestDriveFile(pick);
        if (spec) {
          await openSpec(spec, "auto");
          return;
        }
      }

      await speakAndWait(
        `I don't have ${query} in Specs yet. Add a photo of it, or check that it's in your Drive Specs folder.`,
        "listening",
        "Listening for Hey Winston.",
      );
    },
    [armCapture, ingestDriveFile, openSpec, speakAndWait],
  );

  const handleUtterance = useCallback(
    async (raw: string, fromTyped = false) => {
      const { woke, rest } = stripWake(raw);
      const recipeOpen = Boolean(activeRef.current);
      const capturing = phaseRef.current === "capturing";
      const picking = pendingPicks.current.length > 0;
      const text = foldHeard((woke ? rest : raw).trim());
      const intent = text
        ? parseIntent(text)
        : { type: "unknown" as const, raw };
      const handsFree =
        recipeOpen &&
        intent.type === "command" &&
        isHandsFreeCommand(intent.command);

      if (!fromTyped) {
        if (pauseRec.current && !handsFree && !picking) return;
        if (Date.now() < ignoreUntil.current && !handsFree && !picking) return;
        if (handling.current) return;
        if (
          (phaseRef.current === "speaking" || phaseRef.current === "thinking") &&
          !handsFree &&
          !picking &&
          intent.type !== "command"
        ) {
          return;
        }
      }

      const openMic = capturing || picking;
      if (!fromTyped && !woke && !handsFree && !(openMic && text)) return;
      if (!fromTyped && !woke && !handsFree && !openMic) return;

      handling.current = true;
      clearCapture();
      try {
        if (phaseRef.current === "speaking" && (handsFree || picking)) {
          stopAudio();
        }

        if (woke && !text && !picking) {
          setHeard("Hey Winston");
          setPhase("capturing");
          setStatusLine("Listening.");
          armCapture();
          return;
        }

        setHeard(text);

        if (picking && text) {
          if (intent.type === "command" && intent.command === "stop") {
            pendingPicks.current = [];
            setPhase("listening");
            setStatusLine("Listening for Hey Winston.");
            return;
          }
          const chosen = pickFromList(pendingPicks.current, text);
          if (chosen) {
            pendingPicks.current = [];
            await openSpec(chosen, "auto");
            return;
          }
          const numbered = pendingPicks.current
            .map((s, i) => `${i + 1}: ${s.title}`)
            .join(". ");
          await speakAndWait(
            `Say one, two, or the name. ${numbered}.`,
            "capturing",
            "Say the number or the name.",
          );
          armCapture();
          return;
        }

        if (intent.type === "command") {
          if (intent.command === "stop") {
            stopAudio();
            setActive(null);
            setPhase("listening");
            setStatusLine("Listening for Hey Winston.");
            return;
          }
          if (intent.command === "list") {
            const own = libraryRef.current.filter((s) => s.source !== "starter");
            if (own.length === 1) {
              await openSpec(own[0], "auto");
              return;
            }
            await speakAndWait(listSpeech(), "listening", "Listening for Hey Winston.");
            return;
          }
          if (intent.command === "next") {
            await goNext();
            return;
          }
          if (intent.command === "repeat") {
            await readCurrent();
            return;
          }
          if (intent.command === "back") {
            await goBack();
            return;
          }
          if (intent.command === "ingredients") {
            if (!activeRef.current) return;
            setReading("ingredients");
            await readCurrent();
            return;
          }
          if (intent.command === "start-over") {
            if (!activeRef.current) return;
            setReading("intro");
            setStepIndex(0);
            await openSpec(activeRef.current, "auto");
            return;
          }
        }

        if (intent.type === "lookup") {
          await lookup(intent.query, intent.kindHint);
          return;
        }

        if (capturing && text.length >= 2) {
          await lookup(text);
        }
      } finally {
        handling.current = false;
      }
    },
    [
      armCapture,
      clearCapture,
      goBack,
      goNext,
      listSpeech,
      lookup,
      openSpec,
      readCurrent,
      speakAndWait,
      stopAudio,
    ],
  );

  useEffect(() => {
    handleRef.current = handleUtterance;
  }, [handleUtterance]);

  const attachRecognizer = useCallback(() => {
    if (recRef.current) return recRef.current;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      lastHeardAt.current = Date.now();
      if (pauseRec.current) return;
      const { finalText, live } = bestTranscript(event);
      if (live) setInterim(live);
      if (!finalText) return;
      if (Date.now() < ignoreUntil.current && !stripWake(finalText).woke) return;
      setHeard(finalText);
      holdBuf.current = `${holdBuf.current} ${finalText}`.trim();
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      const phraseNow = holdBuf.current;
      const woke = stripWake(phraseNow).woke;
      const shortCommand =
        /^(next|repeat|stop|back|ingredients)[.!?]*$/i.test(finalText.trim()) &&
        Boolean(activeRef.current);
      const delay = shortCommand ? 60 : woke && stripWake(phraseNow).rest.length > 1 ? 200 : 400;
      holdTimer.current = window.setTimeout(() => {
        const phrase = holdBuf.current.trim();
        holdBuf.current = "";
        holdTimer.current = null;
        setInterim("");
        if (phrase) void handleRef.current(phrase);
      }, delay);
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        setMicError("Microphone is blocked. Allow it in Chrome, then tap the screen once.");
        setNeedsUnlock(true);
        setMicOn(false);
        setPhase("idle");
        return;
      }
    };
    rec.onend = () => {
      if (!wantMic.current || pauseRec.current) return;
      window.setTimeout(() => {
        if (!wantMic.current || pauseRec.current) return;
        try {
          rec.start();
        } catch {
          // already running
        }
      }, 160);
    };
    recRef.current = rec;
    return rec;
  }, []);

  const startMic = useCallback(async () => {
    if (startingRef.current) return;
    if (pauseRec.current || phaseRef.current === "speaking") return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setMicError(
        "This browser has no voice input. Open Winston in Chrome on your phone.",
      );
      return;
    }
    startingRef.current = true;
    wantMic.current = true;
    setMicError(null);
    try {
      const allowed = await requestMicAccess();
      if (!allowed) {
        setMicOn(false);
        setPhase("idle");
        const automation =
          typeof navigator !== "undefined" &&
          Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver);
        if (isFramed() || automation) {
          setNeedsUnlock(false);
          setStatusLine("On your phone, Winston stays on. Say Hey Winston.");
        } else {
          setNeedsUnlock(true);
          setStatusLine("Tap anywhere once so Winston can keep listening.");
        }
        return;
      }
      setNeedsUnlock(false);
      const rec = attachRecognizer();
      if (!rec) return;
      if (!pauseRec.current) {
        try {
          rec.start();
        } catch {
          // already started
        }
      }
      lastHeardAt.current = Date.now();
      if (watchdog.current) window.clearInterval(watchdog.current);
      watchdog.current = window.setInterval(() => {
        if (!wantMic.current) return;
        if (pauseRec.current) return;
        if (phaseRef.current === "speaking") return;
        try {
          recRef.current?.start();
        } catch {
          // already running
        }
      }, 8000);
      setMicOn(true);
      setPhase("listening");
      setStatusLine("Listening for Hey Winston.");
      const lock = await requestWakeLock();
      if (lock) wakeLockRef.current = lock;
      if (!greetedRef.current) {
        greetedRef.current = true;
      }
    } finally {
      startingRef.current = false;
    }
  }, [attachRecognizer, resumeEar]);

  const unlockMic = useCallback(() => {
    void startMic();
  }, [startMic]);

  const ensureListening = useCallback(() => {
    if (!wantMic.current) wantMic.current = true;
    if (micOn) {
      resumeEar();
      return;
    }
    void startMic();
  }, [micOn, resumeEar, startMic]);

  useEffect(() => {
    if (!hydrated) return;
    void startMic();
  }, [hydrated, startMic]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void requestWakeLock().then((lock) => {
        if (lock) wakeLockRef.current = lock;
      });
      if (wantMic.current && !pauseRec.current && phaseRef.current !== "speaking") {
        void startMic();
      }
    };
    const onFocus = () => {
      if (wantMic.current) resumeEar();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    const tick = window.setInterval(() => {
      if (wantMic.current && !pauseRec.current) resumeEar();
    }, 2500);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      window.clearInterval(tick);
    };
  }, [resumeEar, startMic]);

  const syncDrive = useCallback(async (opts?: { quiet?: boolean }) => {
    try {
      const snap = await syncSpecsFolder();
      setDriveStatus(snap.status);
      setDriveFiles(snap.files);
      return snap;
    } catch {
      return { status: { state: "error" as const, message: "Drive failed" }, files: [] };
    }
  }, []);

  const driveWait = useRefetchWhenConnectorReady(
    driveStatus.state === "pending",
    syncDrive,
  );

  useEffect(() => {
    void syncDrive();
  }, [syncDrive]);

  useEffect(() => {
    if (driveStatus.state !== "pending") return;
    if (driveWait === "waiting") return;

    let cancelled = false;
    let n = 0;
    let timer: number | undefined;
    const tick = async () => {
      if (cancelled) return;
      n += 1;
      const snap = await syncDrive({ quiet: true });
      if (cancelled) return;
      if (snap.status.state !== "pending") return;
      const delay = n < 10 ? 2000 : 8000;
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 600);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [driveWait, driveStatus.state, syncDrive]);

  useEffect(() => {
    const readable = driveFiles.filter(
      (f) => isReadableSpecFile(f) || isMaybeSpecFile(f),
    );
    if (readable.length === 0) return;
    setLibrary((prev) => {
      let changed = false;
      const next = [...prev];
      for (const file of readable) {
        const id = `drive-${file.id}`;
        if (next.some((s) => s.id === id)) continue;
        next.unshift(placeholderFromDrive(file));
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [driveFiles]);

  useEffect(() => {
    const unread = driveFiles
      .filter((f) => isReadableSpecFile(f) || isMaybeSpecFile(f))
      .filter((f) => !indexedIds.current.has(f.id));
    if (unread.length === 0) return;
    let cancelled = false;
    void (async () => {
      setStatusLine("Reading your Specs folder…");
      for (const file of unread.slice(0, 8)) {
        if (cancelled) return;
        await ingestDriveFile(file);
      }
      if (!cancelled && phaseRef.current === "listening") {
        setStatusLine("Listening for Hey Winston.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driveFiles, ingestDriveFile]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => f && f.size >= 0).slice(0, 24);
      if (list.length === 0) {
        setStatusLine("No photos came through. Tap Add Specs photos and pick them again.");
        setPhase("error");
        return;
      }
      setBusy(true);
      setPhase("thinking");
      const added: Spec[] = [];
      let lastError = "";
      try {
        for (let i = 0; i < list.length; i += 1) {
          setStatusLine(`Reading photo ${i + 1} of ${list.length}…`);
          try {
            const { displayUrl, extractUrl } = await preparePhoto(list[i]);
            const size = await measurePhoto(displayUrl);
            const stacked = size.height > size.width * 1.18;
            const sideBySide = size.width > size.height * 1.25;
            let specs: ExtractedSpec[] = [];
            let photos: string[] = [];
            let error = "";

            if (stacked || sideBySide) {
              const axis = stacked ? "horizontal" : "vertical";
              setStatusLine(`Photo ${i + 1} has two sheets — reading each…`);
              const extractHalves = await splitIntoHalves(extractUrl, axis, 0.78);
              const displayHalves = await splitIntoHalves(displayUrl, axis, 0.9);
              for (let h = 0; h < extractHalves.length; h += 1) {
                const part = await extractSpecsFromUrl(extractHalves[h], SHEET_HINT, 45_000);
                for (const item of part.specs) {
                  specs.push(item);
                  photos.push(displayHalves[h] ?? displayUrl);
                }
                if (part.error) error = part.error;
              }
            }

            if (specs.length === 0) {
              setStatusLine(`Reading photo ${i + 1} of ${list.length}…`);
              const part = await extractSpecsFromUrl(extractUrl, SHEET_HINT, 48_000);
              specs = part.specs;
              photos = specs.map(() => displayUrl);
              if (part.error) error = part.error;
            }

            if (specs.length === 0) {
              setStatusLine(`Photo ${i + 1} is dense — reading each half…`);
              for (const axis of ["horizontal", "vertical"] as const) {
                if (specs.length > 0) break;
                const extractHalves = await splitIntoHalves(extractUrl, axis, 0.78);
                const displayHalves = await splitIntoHalves(displayUrl, axis, 0.9);
                for (let h = 0; h < extractHalves.length; h += 1) {
                  const part = await extractSpecsFromUrl(extractHalves[h], SHEET_HINT, 40_000);
                  for (const item of part.specs) {
                    specs.push(item);
                    photos.push(displayHalves[h] ?? displayUrl);
                  }
                  if (part.error) error = part.error;
                }
              }
            }
            if (specs.length === 0) {
              lastError = error || "Could not read that photo.";
              continue;
            }
            specs.forEach((item, j) => {
              const spec = specFromExtracted(item, {
                id: `phone-${Date.now()}-${i}-${j}`,
                source: "phone",
                photoDataUrl: photos[j] ?? displayUrl,
              });
              upsertSpec(spec);
              added.push(spec);
            });
          } catch (err) {
            lastError = err instanceof Error ? err.message : "Could not read that photo.";
          }
        }
        if (added.length === 0) {
          const line = lastError || "Could not read those photos.";
          setPhase("error");
          setStatusLine(line);
          await speak(line);
          setPhase("listening");
          return;
        }
        if (added.length === 1) {
          await openSpec(added[0], "auto");
          return;
        }
        const names = added.map((s) => s.title);
        const line =
          list.length === 1
            ? `That screenshot had ${added.length} cards: ${spokenList(names).replace(/^I have /, "")}`
            : `Saved ${added.length} specs on this phone. Say Hey Winston, then ask for one.`;
        await speak(line);
        setStatusLine("Listening for Hey Winston.");
        setPhase("listening");
      } catch (err) {
        const line = err instanceof Error ? err.message : "Upload failed. Try one photo at a time.";
        setPhase("error");
        setStatusLine(line);
        await speak(line);
        setPhase("listening");
      } finally {
        setBusy(false);
      }
    },
    [openSpec, speak, upsertSpec],
  );

  const addPhoto = useCallback(
    async (dataUrl: string) => {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "spec.jpg", { type: "image/jpeg" });
      await addFiles([file]);
    },
    [addFiles],
  );

  const askTyped = useCallback((text: string) => {
    void handleRef.current(text, true);
  }, []);

  return {
    library,
    phase,
    heard,
    interim,
    statusLine,
    active,
    stepIndex,
    reading,
    micOn,
    needsUnlock,
    micError,
    speechOk,
    driveStatus,
    driveFiles,
    busy,
    libraryOpen,
    setLibraryOpen,
    ensureListening,
    unlockMic,
    askTyped,
    openSpec,
    addPhoto,
    addFiles,
    removeSpec,
    syncDrive,
    goNext,
    goBack,
    readCurrent,
    stopAudio,
  };
}
