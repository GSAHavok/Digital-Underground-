type RecognitionCtor = new () => SpeechRecognitionLike;

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
};

export type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    [index: number]: { transcript: string };
  }>;
};

export function getSpeechRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechSupported() {
  return getSpeechRecognition() !== null;
}

export async function requestMicAccess(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  const constraints: MediaStreamConstraints[] = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    { audio: true },
  ];
  for (const constraint of constraints) {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraint),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 3500);
        }),
      ]);
      if (!stream) continue;
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      // try looser constraints
    }
  }
  return false;
}

export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const wakeLock = (
    nav as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    }
  )?.wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

const WAKE_HINT =
  /\b(?:ok(?:ay)?|hey|hello|yo|hay|winston|winson|winsten|whenston|whinston|win\s*ston)\b/i;

export function bestTranscript(event: SpeechResultEvent): { finalText: string; live: string } {
  let finalText = "";
  let live = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const row = event.results[i];
    const piece = collectAlts(row);
    if (row.isFinal) finalText += `${piece} `;
    else live += `${piece} `;
  }
  return { finalText: finalText.trim(), live: live.trim() };
}

function collectAlts(row: SpeechResultEvent["results"][number]): string {
  const parts: string[] = [];
  const len = Math.max(row.length || 1, 1);
  for (let i = 0; i < len; i += 1) {
    const t = (row[i]?.transcript ?? "").trim();
    if (t) parts.push(t);
  }
  if (parts.length === 0) return "";
  const woke = parts.find((p) => WAKE_HINT.test(p));
  if (woke) return woke;
  return parts.sort((a, b) => b.length - a.length)[0] ?? "";
}
