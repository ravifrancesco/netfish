import { useSyncExternalStore } from 'react';
import { desktop, type SystemVolumeState } from './desktop';
import { getPrefs } from './prefs';

/**
 * The computer's own volume, in the Mac and Windows apps: the player's slider follows it and
 * sets it, so the volume keys and the slider are one and the same, and the film itself plays at
 * full volume. Undefined in a browser, in older apps, and on an output whose volume can't be
 * set (the player keeps its own volume then).
 */
export interface Level {
  volume: number;
  muted: boolean;
}

let current: Level | undefined;
/** When the slider last moved (the values coming back meanwhile are older ones). */
let movedAt = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function take(state: SystemVolumeState | null | undefined) {
  let next: Level | undefined = state?.available && typeof state.volume === 'number' ? { volume: state.volume, muted: Boolean(state.muted) } : undefined;
  if (next && current && performance.now() - movedAt < 400) next = { ...next, volume: current.volume };
  if (next?.volume === current?.volume && next?.muted === current?.muted) return;
  current = next;
  notify();
}

/** Once, as the page starts: what it is now, and every change from then on. */
export function startSystemVolume() {
  const bridge = desktop()?.systemVolume;
  if (!bridge) return;
  bridge.onChange(take);
  void bridge.get().then(take, () => {});
}

export const systemVolume = () => current;

export function setSystemVolume(volume: number) {
  const bridge = desktop()?.systemVolume;
  if (!bridge || !current) return;
  movedAt = performance.now();
  // Turning it up unmutes it, like the menu bar's slider.
  if (current.muted && volume > 0) bridge.setMuted(false);
  bridge.set(volume);
  current = { volume, muted: current.muted && volume === 0 };
  notify();
}

export function setSystemMuted(muted: boolean) {
  const bridge = desktop()?.systemVolume;
  if (!bridge || !current) return;
  bridge.setMuted(muted);
  current = { ...current, muted };
  notify();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useSystemVolume = () => useSyncExternalStore(subscribe, systemVolume);

/** What a player starts at: full volume when the computer's volume is the slider, else the last one chosen. */
export const startVolume = () => (current ? 1 : getPrefs().volume);
