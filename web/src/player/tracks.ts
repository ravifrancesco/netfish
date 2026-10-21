import type { PlaybackSession, StreamTrack } from '@netfish/shared';
import { getPrefs } from '../lib/prefs';

/**
 * The subtitle to start with: the one already chosen, the server's pick, else forced ones,
 * else your language if you like subtitles on. `anyKind`: the player draws picture
 * subtitles too (mpv, ExoPlayer), not just text ones.
 */
export function pickSubtitle(s: PlaybackSession, current: StreamTrack | undefined, anyKind: boolean) {
  const usable = (t: StreamTrack) => anyKind || Boolean(t.vttUrl);
  if (current) return s.subtitleTracks.find((t) => t.index === current.index) ?? current;
  // Jellyfin's choice for this person (their settings, what it remembers per show): as it is, none included.
  if (s.subtitleChosen) {
    const theirs = s.subtitleTracks.find((t) => t.index === s.subtitleStreamIndex);
    return theirs && usable(theirs) ? theirs : undefined;
  }
  const fromServer = s.subtitleTracks.find((t) => t.index === s.subtitleStreamIndex);
  if (fromServer) return fromServer;
  if (!getPrefs().subtitlesByDefault) return s.subtitleTracks.find((t) => t.forced && usable(t));
  return s.subtitleTracks.find((t) => t.code === getPrefs().subtitleLanguage && !t.forced && usable(t));
}

/**
 * Forced subtitles (signs, lines in another language) for the language being heard: what "Off"
 * still shows, as Jellyfin does when subtitles are off or only wanted for other languages.
 */
export function forcedFor(s: PlaybackSession, audioIndex: number | undefined, anyKind: boolean) {
  const audio = s.audioTracks.find((t) => t.index === audioIndex) ?? s.audioTracks.find((t) => t.default) ?? s.audioTracks[0];
  return s.subtitleTracks.find((t) => t.forced && (anyKind || Boolean(t.vttUrl)) && (!audio?.code || !t.code || t.code === audio.code));
}

/**
 * The subtitles to choose from: forced ones go with "Off" (they stay on by themselves), unless
 * they're all a language has.
 */
export function menuSubtitles<T extends { forced?: boolean; code?: string }>(tracks: T[]): T[] {
  return tracks.filter((t) => !t.forced || !tracks.some((o) => !o.forced && o.code === t.code));
}
