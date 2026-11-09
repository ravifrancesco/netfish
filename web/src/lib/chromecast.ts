import { useEffect, useState } from 'react';
import { desktop, type CastBridge, type CastState } from './desktop';

/**
 * The Chromecast outside the player (the Android app on phones and tablets): connecting to one
 * before choosing a film, and the way back to the film playing there.
 */

/** The title a Chromecast's link is for: /videos/<id>/… (Jellyfin 12 writes ids with dashes). */
export function castItemOf(url: string | undefined): string | undefined {
  const id = url && /\/videos\/([0-9a-f-]{32,36})\//i.exec(url)?.[1];
  return id ? id.replace(/-/g, '').toLowerCase() : undefined;
}

/** The audio track that link plays (Jellyfin's number), when it says. */
export function castAudioOf(url: string | undefined): number | undefined {
  const index = url && /[?&]AudioStreamIndex=(\d+)/i.exec(url)?.[1];
  return index ? Number(index) : undefined;
}

/** A film is on the Chromecast (playing, paused or loading), not finished or stopped. */
export const castBusy = (state: CastState) => Boolean(state.connected && state.url && (state.playing || state.paused || state.buffering));

export const chromecast = (): CastBridge | undefined => desktop()?.cast;

/**
 * What the Chromecast says, kept current. `watch`: the list of devices is on screen, so look
 * for them (it costs battery).
 */
export function useChromecast(watch = false): CastState {
  const cast = chromecast();
  const [state, setState] = useState<CastState>(() => cast?.last() ?? {});
  useEffect(() => {
    if (!cast) return;
    const stop = cast.onState(() => setState({ ...cast.last() }));
    return stop;
  }, [cast]);
  useEffect(() => {
    if (!cast || !watch) return;
    cast.watch(true);
    return () => cast.watch(false);
  }, [cast, watch]);
  return state;
}
