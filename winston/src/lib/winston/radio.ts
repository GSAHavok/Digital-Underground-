import { STATIONS, type Station } from "./stations";

type Listener = (station: Station | null) => void;

const listeners = new Set<Listener>();
let audio: HTMLAudioElement | null = null;
let current: Station | null = null;
let ducked = false;
let duckLevel = 1;
let stopped = true;
let resumeLock = false;
const LAST_KEY = "winston-radio-last";

function holdAudioSession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "play-and-record";
}

function releaseAudioSession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "auto";
}

function emit() {
  listeners.forEach((fn) => fn(current));
}

export function nudgeRadio() {
  const el = audio;
  if (stopped || !el || !current || resumeLock) return;
  holdAudioSession();
  if (!el.paused && !el.ended) return;
  resumeLock = true;
  void el.play().finally(() => {
    resumeLock = false;
  });
}

function ensureAudio() {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "auto";
  el.setAttribute("playsinline", "true");
  el.addEventListener("pause", () => {
    if (stopped || !current) return;
    nudgeRadio();
  });
  el.addEventListener("stalled", () => nudgeRadio());
  window.setInterval(() => {
    if (stopped || !el || !current) return;
    el.volume = duckLevel;
    if (el.paused) nudgeRadio();
  }, 700);
  audio = el;
  return el;
}

function setSessionMeta(station: Station | null) {
  if (!("mediaSession" in navigator)) return;
  if (!station) {
    navigator.mediaSession.playbackState = "none";
    return;
  }
  navigator.mediaSession.playbackState = "playing";
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: `${station.freq} ${station.city}`,
    album: "Winston",
  });
}

export function subscribeRadio(fn: Listener) {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

export function currentStation() {
  return current;
}

export function setRadioDuck(on: boolean, level = 0.5) {
  ducked = on;
  duckLevel = on ? level : 1;
  if (!audio || stopped) return;
  audio.volume = duckLevel;
  if (audio.paused) nudgeRadio();
}

export function stopRadio() {
  stopped = true;
  current = null;
  emit();
  setSessionMeta(null);
  releaseAudioSession();
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

export function playStation(station: Station) {
  const el = ensureAudio();
  holdAudioSession();
  stopped = false;
  if (current?.id !== station.id || !el.src) {
    el.src = station.url;
  }
  el.volume = duckLevel;
  current = station;
  try {
    localStorage.setItem(LAST_KEY, station.id);
  } catch {
    // ignore
  }
  setSessionMeta(station);
  emit();
  return el.play();
}

export function lastStation(): Station {
  try {
    const id = localStorage.getItem(LAST_KEY);
    const found = STATIONS.find((s) => s.id === id);
    if (found) return found;
  } catch {
    // ignore
  }
  return STATIONS.find((s) => s.id === "cbc") ?? STATIONS[0]!;
}
