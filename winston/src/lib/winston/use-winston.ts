import { useCallback, useEffect, useRef, useState } from "react";
import { isFramed } from "@/lib/app-data/login";
import { useRefetchWhenConnectorReady } from "@/lib/app-data/use-connector-readiness";
import {
  askWinston,
  extractFromPhoto,
  readDriveSpec,
  speakText,
  syncSpecsFolder,
} from "./actions";
import { clockIn, clockOut, formatClock, formatDay, formatDuration } from "./hours";
import { currentStation, lastStation, nudgeRadio, playStation, setRadioDuck, stopRadio } from "./radio";
import { matchStation, spokenFreq, stationCommand, wantsRadioOff } from "./stations";
import { isReadableSpecFile, isMaybeSpecFile } from "./drive-parse";
import { batchLabel, needsFor, stepsFor, takeBatchFromQuery, type BatchSize } from "./batch";
import { foldHeard, isHandsFreeCommand, isRecipeAsk, looseSpecCommand, parseIntent, spokenList, stripWake } from "./intent";
import { coalesceSpecs } from "./extract";
import { preparePhoto, splitIntoHalves } from "./image";
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

const PHOTO_HINT =
  "a recipe or procedure. Default is one spec for the whole photo. Only make two specs if two clearly separate titled recipes are visible. Do not invent a second recipe from a crop or food photo. If there are 1/2, Full, and 2x columns, use Full for ingredients and steps.";

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
    return { specs: coalesceSpecs(specs.length > 0 ? specs : result.specs) };
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
    ingredientsHalf: extracted.ingredientsHalf,
    ingredientsDouble: extracted.ingredientsDouble,
    stepsHalf: extracted.stepsHalf,
    stepsDouble: extracted.stepsDouble,
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
  const [statusLine, setStatusLine] = useState("Always listening for Winston.");
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
  const [radioOpen, setRadioOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantMic = useRef(true);
  const pauseRec = useRef(false);
  const duckHold = useRef(false);
  const ignoreUntil = useRef(0);
  const speakGen = useRef(0);
  const captureTimer = useRef<number | null>(null);
  const holdBuf = useRef("");
  const holdTimer = useRef<number | null>(null);
  const lastHeardAt = useRef(Date.now());
  const watchdog = useRef<number | null>(null);
  const pendingPicks = useRef<Spec[]>([]);
  const chatRef = useRef<{ role: "user" | "winston"; text: string }[]>([]);
  const readingAll = useRef(false);
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
  const batchRef = useRef<BatchSize>("full");
  const pendingBatch = useRef<BatchSize>("full");
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
    if (!active) return;
    duckHold.current = true;
    setRadioDuck(true);
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

  const killPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const stopAudio = useCallback(() => {
    readingAll.current = false;
    speakGen.current += 1;
    pauseRec.current = false;
    ignoreUntil.current = 0;
    killPlayback();
  }, [killPlayback]);

  const removeSpec = useCallback((id: string) => {
    if (activeRef.current?.id === id) {
      stopAudio();
      setActive(null);
      setReading("intro");
      setStepIndex(0);
      setPhase("listening");
      setStatusLine("Listening for Winston.");
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

  const releaseDuck = useCallback(() => {
    duckHold.current = false;
    setRadioDuck(false);
  }, []);

  const holdDuck = useCallback(() => {
    if (!currentStation()) return;
    duckHold.current = true;
    setRadioDuck(true);
  }, []);

  const armCapture = useCallback((ms = 28000) => {
    clearCapture();
    captureTimer.current = window.setTimeout(() => {
      if (phaseRef.current === "capturing") {
        pendingPicks.current = [];
        setPhase("listening");
        setStatusLine("Listening for Winston.");
        setHeard("");
        if (!activeRef.current) releaseDuck();
      }
    }, ms);
  }, [clearCapture, releaseDuck]);

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
      setRadioDuck(true);
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
      killPlayback();
      setPhase("speaking");
      try {
        let result: { ok: true; mime: string; audioBase64: string } | { ok: false; error: string } =
          { ok: false, error: "tts" };
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (speakGen.current !== id) return;
          result = await Promise.race([
            speakText({ data: { text: cleaned } }),
            new Promise<{ ok: false; error: string }>((resolve) => {
              setTimeout(() => resolve({ ok: false, error: "timeout" }), 12_000);
            }),
          ]);
          if (result.ok) break;
        }
        if (speakGen.current !== id) return;
        if (result.ok) {
          await new Promise<void>((resolve) => {
            const audio = new Audio(`data:${result.mime};base64,${result.audioBase64}`);
            audio.volume = 1;
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
        const keepLow = Boolean(activeRef.current) || duckHold.current;
        if (currentStation()) setRadioDuck(keepLow);
        else setRadioDuck(false);
        if (speakGen.current !== id) return;
        ignoreUntil.current = Date.now() + 200;
        pauseRec.current = false;
        resumeEar();
      }
    },
    [killPlayback, resumeEar],
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
      batchRef.current = "full";
      setActive(null);
      setReading("intro");
      setStepIndex(0);
      setHeard("");
      setPhase("listening");
      setStatusLine(line || "Listening for Winston.");
      releaseDuck();
    },
    [releaseDuck],
  );

  const openSpec = useCallback(
    async (spec: Spec, mode: SpeakMode, batch: BatchSize = "full") => {
      batchRef.current = batch;
      setActive(spec);
      setStepIndex(0);
      setReading("intro");
      setLibraryOpen(false);
      if (mode === "manual") {
        setPhase("awaiting");
        setStatusLine("Say steps, repeat, or close.");
        return;
      }
      const needs = needsFor(spec, batchRef.current);
      const scaleNote = batchRef.current === "full" ? "" : ` ${batchLabel(batchRef.current)}.`;
      if (needs.length > 0) {
        setReading("ingredients");
        await speak(`You'll need${scaleNote}: ${needs.join(". ")}.`);
      } else {
        setReading("intro");
      }
      setStatusLine("Say steps, repeat, or close.");
      setPhase("awaiting");
    },
    [speak],
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
    const needs = needsFor(spec, batchRef.current);
    const steps = stepsFor(spec, batchRef.current);
    if (readingNow === "intro") {
      await speak(spec.spokenIntro);
    } else if (readingNow === "ingredients") {
      await speak(
        `${spec.kind === "recipe" ? "Ingredients" : "What you need"}: ${needs.join(". ")}.`,
      );
    } else {
      const step = steps[idx];
      if (step) {
        await speak(`Step ${idx + 1} of ${steps.length}. ${step}.`);
      }
    }
    setStatusLine("Say steps, repeat, or close.");
    setPhase("awaiting");
  }, [speak]);

  const applyBatch = useCallback(
    async (batch: BatchSize) => {
      const spec = activeRef.current;
      if (!spec) {
        setPhase("listening");
        setStatusLine("Nothing is open.");
        return;
      }
      batchRef.current = batch;
      setStepIndex(0);
      const needs = needsFor(spec, batch);
      if (needs.length > 0) {
        setReading("ingredients");
        await speak(`${batchLabel(batch)}. You'll need: ${needs.join(". ")}.`);
        setStatusLine("Say steps, repeat, or close.");
        setPhase("awaiting");
        return;
      }
      setReading("step");
      setStatusLine("Say steps, repeat, or close.");
      setPhase("awaiting");
    },
    [speak, speakAndWait],
  );

  const readAllSteps = useCallback(async () => {
    const spec = activeRef.current;
    if (!spec) {
      setPhase("listening");
      setStatusLine("Nothing is open.");
      return;
    }
    const steps = stepsFor(spec, batchRef.current);
    if (steps.length === 0) {
      setStatusLine("No steps on this card.");
      setPhase("awaiting");
      return;
    }
    readingAll.current = true;
    setReading("step");
    for (let i = 0; i < steps.length; i += 1) {
      if (!readingAll.current || activeRef.current?.id !== spec.id) return;
      setStepIndex(i);
      await speak(`Step ${i + 1} of ${steps.length}. ${steps[i]}.`);
    }
    if (!readingAll.current || activeRef.current?.id !== spec.id) return;
    readingAll.current = false;
    setStatusLine("Say steps, repeat, or close.");
    setPhase("awaiting");
  }, [speak, speakAndWait]);

  const gotoStep = useCallback(
    async (n: number) => {
      const spec = activeRef.current;
      if (!spec) {
        setPhase("listening");
        setStatusLine("Nothing is open.");
        return;
      }
      const steps = stepsFor(spec, batchRef.current);
      if (n < 1 || n > steps.length) {
        setStatusLine(`${steps.length} steps on this card.`);
        setPhase("awaiting");
        return;
      }
      setReading("step");
      setStepIndex(n - 1);
      await speak(`Step ${n} of ${steps.length}. ${steps[n - 1]}.`);
      setStatusLine("Say steps, repeat, or close.");
      setPhase("awaiting");
    },
    [speak, speakAndWait],
  );

  const goNext = readAllSteps;

  const goBack = useCallback(async () => {
    const spec = activeRef.current;
    if (!spec) return;
    const needs = needsFor(spec, batchRef.current);
    const steps = stepsFor(spec, batchRef.current);
    if (readingRef.current === "step" && stepRef.current > 0) {
      const prev = stepRef.current - 1;
      setStepIndex(prev);
      await speak(`Step ${prev + 1} of ${steps.length}. ${steps[prev]}.`);
      setPhase("awaiting");
      return;
    }
    if (readingRef.current === "step") {
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
    async (query: string, kindHint?: Spec["kind"], silentIfMissing = false) => {
      const parsed = takeBatchFromQuery(query);
      const q = parsed.query || query;
      pendingBatch.current = parsed.batch ?? "full";
      const localHits = findSpecs(libraryRef.current, q, kindHint);

      if (localHits.length === 1) {
        setStatusLine(localHits[0].title);
        await openSpec(localHits[0], "auto", pendingBatch.current);
        return true;
      }
      if (localHits.length > 1) {
        pendingPicks.current = localHits;
        const numbered = localHits
          .map((s, i) => `${i + 1}: ${s.title}`)
          .join(". ");
        setPhase("capturing");
        setStatusLine(numbered);
        armCapture();
        return true;
      }

      if (silentIfMissing) return false;

      setPhase("listening");
      setStatusLine(`I don't have ${q} yet.`);
      return false;
    },
    [armCapture, openSpec, speakAndWait],
  );

  const converse = useCallback(
    async (question: string) => {
      const asked = question.trim();
      if (asked.length < 2) return;
      setPhase("thinking");
      setStatusLine("Winston.");
      const specs = libraryRef.current
        .filter((s) => s.source !== "starter")
        .map((s) => s.title);
      const result = await Promise.race([
        askWinston({
          data: {
            question: asked,
            history: chatRef.current,
            specs,
            nowIso: new Date().toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
        new Promise<{ ok: false; error: string }>((resolve) => {
          setTimeout(() => resolve({ ok: false, error: "timeout" }), 18_000);
        }),
      ]);
      const line =
        result && "ok" in result && result.ok
          ? result.text.replace(/\s+/g, " ").trim()
          : "I didn't catch a good answer. Ask me again.";
      chatRef.current = [
        ...chatRef.current,
        { role: "user" as const, text: asked },
        { role: "winston" as const, text: line },
      ].slice(-10);
      setPhase("listening");
      setStatusLine(line);
    },
    [armCapture],
  );

  const startRadio = useCallback(
    async (query: string) => {
      const station = query.trim() ? matchStation(query) : lastStation();
      if (!station) {
        const heard = spokenFreq(query);
        setPhase("capturing");
        setStatusLine(
          heard
            ? `No station for ${heard}.`
            : "Say play radio, or a station like 101.3.",
        );
        armCapture();
        return;
      }
      try {
        await playStation(station);
        setRadioOpen(false);
        clearCapture();
        setPhase("listening");
        setStatusLine("Listening for Winston.");
      } catch {
        setRadioOpen(false);
        setPhase("listening");
        setStatusLine(`${station.name} didn't start.`);
      }
      if (activeRef.current) setRadioDuck(true, 0.5);
      else releaseDuck();
    },
    [clearCapture, releaseDuck],
  );

  const punchIn = useCallback(async (at: number | null) => {
    const specified = at != null;
    const result = await clockIn(at ?? Date.now(), specified);
    if (!result.ok) {
      setPhase("listening");
      setStatusLine(`Already in since ${formatClock(result.open.inAt)}.`);
    } else {
      setHoursOpen(true);
      const when = `${formatDay(result.shift.inAt)} at ${formatClock(result.shift.inAt)}`;
      setPhase("listening");
      setStatusLine(result.moved ? `Clock-in moved to ${when}.` : `Clocked in ${when}.`);
    }
  }, []);

  const punchOut = useCallback(async () => {
    const result = await clockOut();
    if (!result.ok) {
      setPhase("listening");
      setStatusLine("You're not clocked in.");
    } else {
      const span = (result.shift.outAt ?? Date.now()) - result.shift.inAt;
      setHoursOpen(true);
      setPhase("listening");
      setStatusLine(
        `Clocked out ${formatClock(result.shift.outAt ?? Date.now())}. ${formatDuration(span)}.`,
      );
    }
  }, []);

  const handleUtterance = useCallback(
    async (raw: string, fromTyped = false) => {
      const { woke, rest } = stripWake(raw);
      const recipeOpen = Boolean(activeRef.current);
      const capturing = phaseRef.current === "capturing";
      const picking = pendingPicks.current.length > 0;
      const text = foldHeard((woke ? rest : raw).trim());
      const parsed = text
        ? parseIntent(text)
        : { type: "unknown" as const, raw };
      const radioOn = Boolean(currentStation());
      const stopRadioNow = wantsRadioOff(foldHeard(raw)) || wantsRadioOff(text);
      const loose =
        !stopRadioNow &&
        recipeOpen &&
        (parsed.type === "unknown" || parsed.type === "lookup" || radioOn)
          ? looseSpecCommand(foldHeard(`${rest} ${raw}`))
          : null;
      const intent = stopRadioNow ? ({ type: "radio-stop" } as const) : (loose ?? parsed);
      const handsFree =
        recipeOpen &&
        intent.type === "command" &&
        isHandsFreeCommand(intent.command);
      const stepAsk = recipeOpen && intent.type === "goto-step";

      if (!fromTyped) {
        if (pauseRec.current && !handsFree && !picking && !stepAsk) return;
        if (Date.now() < ignoreUntil.current && !handsFree && !picking && !stepAsk && !woke) return;
        if (handling.current) return;
        if (
          (phaseRef.current === "speaking" || phaseRef.current === "thinking") &&
          !handsFree &&
          !picking &&
          !stepAsk &&
          intent.type !== "command"
        ) {
          return;
        }
      }

      const openMic = capturing || picking;
      if (
        !fromTyped &&
        radioOn &&
        !woke &&
        !capturing &&
        !picking &&
        !handsFree &&
        !stepAsk &&
        !stopRadioNow
      ) {
        return;
      }
      if (!fromTyped && !woke && !handsFree && !stepAsk && !(openMic && text) && !stopRadioNow) return;
      if (!fromTyped && !woke && !handsFree && !stepAsk && !openMic && !stopRadioNow) return;

      handling.current = true;
      clearCapture();
      if (radioOn && (handsFree || stepAsk || Boolean(activeRef.current))) {
        holdDuck();
      }
      try {
        if (phaseRef.current === "speaking" && (handsFree || picking)) {
          stopAudio();
        }

        if (woke && radioOn) setRadioDuck(true, 0.12);
        if (woke && !text && !picking) {
          setHeard("");
          setPhase("capturing");
          setStatusLine("Listening.");
          armCapture(radioOn ? 8000 : 28000);
          return;
        }

        const stationPick = stationCommand(text);
        if (stationPick && (woke || capturing || radioOn)) {
          await startRadio(stationPick);
          return;
        }

        const radioBleed =
          radioOn &&
          woke &&
          !stopRadioNow &&
          !handsFree &&
          !stepAsk &&
          intent.type !== "clock-in" &&
          intent.type !== "clock-out" &&
          intent.type !== "hours" &&
          intent.type !== "radio" &&
          intent.type !== "radio-stop" &&
          text.split(/\s+/).filter(Boolean).length > 4;

        if (radioBleed) {
          setPhase("capturing");
          setStatusLine("Listening.");
          armCapture(8000);
          return;
        }

        setHeard(text);

        if (intent.type === "radio-stop") {
          stopRadio();
          setRadioOpen(false);
          setPhase("listening");
          setStatusLine("Listening for Winston.");
          releaseDuck();
          return;
        }
        if (intent.type === "radio") {
          await startRadio(intent.query);
          return;
        }
        if (intent.type === "clock-in") {
          if (intent.missed) {
            setPhase("capturing");
            setStatusLine("Say clock in for 10 AM.");
            armCapture();
            return;
          }
          await punchIn(intent.at);
          return;
        }
        if (intent.type === "clock-out") {
          await punchOut();
          return;
        }
        if (intent.type === "hours") {
          setHoursOpen(true);
          setPhase("listening");
          setStatusLine("Hours.");
          return;
        }

        if (picking && text) {
          if (intent.type === "command" && intent.command === "close") {
            pendingPicks.current = [];
            await returnHome();
            return;
          }
          const chosen = pickFromList(pendingPicks.current, text);
          if (chosen) {
            pendingPicks.current = [];
            await openSpec(chosen, "auto", pendingBatch.current);
            return;
          }
          const numbered = pendingPicks.current
            .map((s, i) => `${i + 1}: ${s.title}`)
            .join(". ");
          setPhase("capturing");
          setStatusLine(numbered);
          armCapture();
          return;
        }

        if (intent.type === "command") {
          if (intent.command === "close") {
            stopAudio();
            await returnHome();
            return;
          }
          if (intent.command === "list") {
            const own = libraryRef.current.filter((s) => s.source !== "starter");
            if (own.length === 1) {
              await openSpec(own[0], "auto");
              return;
            }
            setPhase("listening");
            setStatusLine(listSpeech());
            return;
          }
          if (intent.command === "steps") {
            await readAllSteps();
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
            await openSpec(activeRef.current, "auto", batchRef.current);
            return;
          }
          if (intent.command === "half") {
            await applyBatch("half");
            return;
          }
          if (intent.command === "double") {
            await applyBatch("double");
            return;
          }
          if (intent.command === "full-batch") {
            await applyBatch("full");
            return;
          }
        }

        if (intent.type === "goto-step") {
          await gotoStep(intent.n);
          return;
        }

        if (intent.type === "lookup") {
          const found = await lookup(intent.query, intent.kindHint, true);
          if (found) return;
          if (isRecipeAsk(intent.query) || isRecipeAsk(text)) {
            setPhase("listening");
            setStatusLine(`I don't have ${intent.query} yet.`);
            return;
          }
          await converse(text);
          return;
        }

        if ((capturing || fromTyped || woke) && text.length >= 2) {
          const found = await lookup(text, undefined, true);
          if (found) return;
          await converse(text);
        }
      } finally {
        handling.current = false;
      }
    },
    [
      armCapture,
      clearCapture,
      holdDuck,
      goBack,
      gotoStep,
      readAllSteps,
      applyBatch,
      converse,
      listSpeech,
      lookup,
      openSpec,
      punchIn,
      punchOut,
      readCurrent,
      resumeEar,
      returnHome,
      startRadio,
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
    rec.maxAlternatives = 4;
    rec.onresult = (event) => {
      lastHeardAt.current = Date.now();
      if (pauseRec.current) return;
      const { finalText, live } = bestTranscript(event);
      const armed =
        phaseRef.current === "capturing" ||
        phaseRef.current === "awaiting" ||
        phaseRef.current === "thinking" ||
        Boolean(activeRef.current);
      const preview = `${holdBuf.current} ${live} ${finalText}`.trim();
      const liveWoke = stripWake(preview).woke || stripWake(finalText).woke;
      const listeningForCommand =
        phaseRef.current === "capturing" || phaseRef.current === "awaiting";
      if (liveWoke && currentStation()) {
        setRadioDuck(true, 0.12);
        holdBuf.current = "";
      }
      if (
        currentStation() &&
        !listeningForCommand &&
        finalText &&
        !stripWake(finalText).woke
      ) {
        return;
      }
      if (armed || liveWoke) {
        if (live) setInterim(live);
      } else if (live) {
        setInterim("");
      }
      if (!finalText) return;
      if (Date.now() < ignoreUntil.current && !stripWake(finalText).woke) return;
      if (currentStation() && stripWake(finalText).woke) {
        holdBuf.current = finalText.trim();
      } else {
        holdBuf.current = `${holdBuf.current} ${finalText}`.trim();
      }
      if (currentStation()) {
        const words = holdBuf.current.split(/\s+/);
        if (words.length > 12) holdBuf.current = words.slice(-12).join(" ");
      }
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      const phraseNow = holdBuf.current;
      const wokeNow = stripWake(phraseNow).woke;
      const specCue =
        Boolean(activeRef.current) && /\b(steps?|repeat|close)\b/i.test(`${finalText} ${phraseNow}`);
      const shortCommand =
        specCue ||
        (/^(steps|repeat|close|stop|next|back|ingredients|half|double|full)[.!?]*$/i.test(finalText.trim()) &&
          Boolean(activeRef.current));
      const restWords = stripWake(phraseNow).rest.split(/\s+/).filter(Boolean).length;
      const capturing = phaseRef.current === "capturing" || phaseRef.current === "awaiting";
      const delay = shortCommand
        ? 80
        : wokeNow && currentStation()
          ? 900
          : wokeNow && restWords >= 2
            ? 650
            : wokeNow
              ? 500
              : capturing
                ? 400
                : 320;
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
      lastHeardAt.current = Date.now();
    };
    rec.onend = () => {
      nudgeRadio();
      if (!wantMic.current || pauseRec.current) return;
      const restart = () => {
        if (!wantMic.current || pauseRec.current) return;
        try {
          rec.start();
        } catch {
          // already running
        }
        nudgeRadio();
      };
      if (currentStation()) {
        restart();
        return;
      }
      window.setTimeout(restart, 160);
    };
    recRef.current = rec;
    return rec;
  }, []);

  const startMic = useCallback(async () => {
    if (startingRef.current) return;
    if (phaseRef.current === "speaking") return;
    if (pauseRec.current) pauseRec.current = false;
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
          setStatusLine("On your phone, Winston stays on. Say Winston.");
        } else {
          setNeedsUnlock(true);
          setStatusLine("Tap anywhere once so Winston can keep listening.");
        }
        return;
      }
      setNeedsUnlock(false);
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = "play-and-record";
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
        if (currentStation()) return;
        if (Date.now() - lastHeardAt.current < 12_000) return;
        try {
          recRef.current?.abort();
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          if (!wantMic.current || pauseRec.current) return;
          try {
            recRef.current?.start();
          } catch {
            // already running
          }
        }, 180);
      }, 8000);
      setMicOn(true);
      setPhase("listening");
      setStatusLine("Listening for Winston.");
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
        setStatusLine("Listening for Winston.");
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
            let specs: ExtractedSpec[] = [];
            let error = "";

            setStatusLine(`Reading photo ${i + 1} of ${list.length}…`);
            const whole = await extractSpecsFromUrl(extractUrl, PHOTO_HINT, 48_000);
            specs = whole.specs;
            if (whole.error) error = whole.error;

            if (specs.length === 0) {
              setStatusLine(`Photo ${i + 1} is dense — trying a closer read…`);
              for (const axis of ["horizontal", "vertical"] as const) {
                if (specs.length > 0) break;
                const extractHalves = await splitIntoHalves(extractUrl, axis, 0.78);
                const parts: ExtractedSpec[] = [];
                for (const half of extractHalves) {
                  const part = await extractSpecsFromUrl(half, PHOTO_HINT, 40_000);
                  parts.push(...part.specs);
                  if (part.error) error = part.error;
                }
                specs = coalesceSpecs(parts);
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
                photoDataUrl: displayUrl,
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
            : `Saved ${added.length} specs on this phone. Say Winston, then ask for one.`;
        await speak(line);
        setStatusLine("Listening for Winston.");
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
    radioOpen,
    setRadioOpen,
    hoursOpen,
    setHoursOpen,
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
