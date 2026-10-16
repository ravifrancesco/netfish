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
  const fromServer = s.subtitleTracks.find((t) => t.index === s.subtitleStreamIndex);
  if (fromServer) return fromServer;
  if (!getPrefs().subtitlesByDefault) return s.subtitleTracks.find((t) => t.forced && usable(t));
  return s.subtitleTracks.find((t) => t.code === getPrefs().subtitleLanguage && !t.forced && usable(t));
}
