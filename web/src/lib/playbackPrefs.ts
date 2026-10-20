import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaybackPrefs } from '@netfish/shared';
import { api } from '../api';
import { setPrefs } from './prefs';

/**
 * Audio and subtitle settings: each person's Jellyfin ones (the same on every device, and in
 * Jellyfin's own apps), so what plays is what Jellyfin would pick. A copy stays on the device for
 * the downloads player (offline) and older servers.
 */

function keepHere(p: Partial<PlaybackPrefs>) {
  setPrefs({
    ...(p.subtitleMode ? { subtitlesByDefault: p.subtitleMode === 'Always' } : {}),
    ...(p.subtitleLanguage ? { subtitleLanguage: p.subtitleLanguage } : {}),
    ...(typeof p.audioLanguage === 'string' ? { audioLanguage: p.audioLanguage } : {}),
  });
}

export function usePlaybackPrefs() {
  const q = useQuery({ queryKey: ['playback-prefs'], queryFn: api.playbackPrefs, staleTime: 0 });
  useEffect(() => {
    if (q.data) keepHere(q.data);
  }, [q.data]);
  return q;
}

export function useSetPlaybackPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PlaybackPrefs>) => api.setPlaybackPrefs(patch),
    onSuccess: (prefs) => {
      qc.setQueryData(['playback-prefs'], prefs);
      keepHere(prefs);
    },
  });
}

/**
 * Subtitles chosen while watching (or turned off): the person's setting from then on, for films
 * and channels alike (Settings shows the same). Forced ones (signs, foreign lines) don't count
 * as turning them on.
 */
export function rememberSubtitle(track: { code?: string; forced?: boolean } | undefined) {
  const patch: Partial<PlaybackPrefs> =
    track && !track.forced ? { subtitleMode: 'Always', ...(track.code ? { subtitleLanguage: track.code } : {}) } : { subtitleMode: 'OnlyForced' };
  keepHere(patch);
  void api.setPlaybackPrefs(patch).catch(() => {});
}
