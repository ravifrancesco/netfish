import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, ChannelProgram } from '@netfish/shared';
import { api } from '../api';
import { useConfig } from './hooks';
import { locale } from '../i18n';

/**
 * Channels (an admin turns them on): every screen works from the server's clock, so
 * everyone on a channel is at the same minute of the same programme.
 */

let offset = 0;
/** The server's time now (ms). */
export const serverNow = () => Date.now() + offset;

export function useChannels() {
  const on = Boolean(useConfig().data?.features.channels);
  return useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const before = Date.now();
      const res = await api.channels();
      // Halfway through the round trip is when the server read its clock.
      offset = res.now - (before + Date.now()) / 2;
      return res;
    },
    enabled: on,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

/** The server's clock, ticking (every `ms`). */
export function useServerNow(ms = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export const programEnd = (p: ChannelProgram) => p.start + p.seconds * 1000;

export interface OnNow {
  /** The programme playing, if one is (not the break before the next). */
  program?: ChannelProgram;
  next?: ChannelProgram;
  /** Seconds into `program`. */
  offset: number;
}

/** What's on a channel at `now`: a programme, or the break before the next one. */
export function onNow(channel: Channel, now: number): OnNow {
  const list = channel.programs;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (now < p.start) return { next: p, offset: 0 };
    if (now < programEnd(p)) return { program: p, next: list[i + 1], offset: (now - p.start) / 1000 };
  }
  return { offset: 0 };
}

/** "S1:E4 · Pilot" for an episode; nothing for a film. */
export const episodeLine = (p: ChannelProgram) =>
  p.seasonNumber !== undefined && p.episodeNumber !== undefined ? `S${p.seasonNumber}:E${p.episodeNumber} · ${p.title}` : undefined;

/** The big title: the show for an episode, the film's title otherwise. */
export const programTitle = (p: ChannelProgram) => p.seriesTitle ?? p.title;

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
