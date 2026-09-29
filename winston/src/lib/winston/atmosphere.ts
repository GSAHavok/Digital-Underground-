export type WinstonMood = "life" | "attention";

let mood: WinstonMood = "life";
const moodListeners = new Set<(next: WinstonMood) => void>();

export function setWinstonMood(next: WinstonMood) {
  if (mood === next) return;
  mood = next;
  moodListeners.forEach((fn) => fn(next));
}

export function getWinstonMood() {
  return mood;
}

export function subscribeWinstonMood(fn: (next: WinstonMood) => void) {
  moodListeners.add(fn);
  return () => {
    moodListeners.delete(fn);
  };
}

let tvMuted = false;
let tvDuck = false;
const tvListeners = new Set<(muted: boolean) => void>();

function emitTv() {
  const muted = tvMuted || tvDuck;
  tvListeners.forEach((fn) => fn(muted));
}

export function setTvMuted(next: boolean) {
  if (tvMuted === next) return;
  tvMuted = next;
  emitTv();
}

export function setTvDuck(next: boolean) {
  if (tvDuck === next) return;
  tvDuck = next;
  emitTv();
}

export function getTvMuted() {
  return tvMuted;
}

export function isTvSilent() {
  return tvMuted || tvDuck;
}

export function subscribeTvSilent(fn: (muted: boolean) => void) {
  tvListeners.add(fn);
  return () => {
    tvListeners.delete(fn);
  };
}
