import type { PlaybackPrefs, SubtitleMode } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin } from '../clients/jellyfin';
import { findLanguage } from '../lib/languages';

/**
 * Audio and subtitle settings are each person's Jellyfin ones: Netfish reads and changes those,
 * so they're the same on every device and in Jellyfin's own apps, and what Jellyfin picks to
 * play (and remembers per show) is what Netfish plays.
 */

const MODES: SubtitleMode[] = ['Default', 'Always', 'OnlyForced', 'None', 'Smart'];
/** Jellyfin keeps "ita", "eng"…; Netfish "it", "en"… */
const short = (code?: string) => (code ? (findLanguage(code)?.code ?? '') : '');
const long = (code: string) => (code ? (findLanguage(code)?.iso3[0] ?? code) : '');

export async function playbackPrefs(user: SessionUser): Promise<PlaybackPrefs> {
  const c = (await jellyfin.me(user.token)).Configuration ?? {};
  return {
    audioLanguage: short(c.AudioLanguagePreference),
    subtitleMode: MODES.includes(c.SubtitleMode as SubtitleMode) ? (c.SubtitleMode as SubtitleMode) : 'Default',
    subtitleLanguage: short(c.SubtitleLanguagePreference),
  };
}

export async function setPlaybackPrefs(user: SessionUser, patch: Partial<PlaybackPrefs>): Promise<PlaybackPrefs> {
  const configuration = { ...((await jellyfin.me(user.token)).Configuration ?? {}) };
  if (typeof patch.audioLanguage === 'string') configuration.AudioLanguagePreference = long(patch.audioLanguage);
  if (patch.subtitleMode && MODES.includes(patch.subtitleMode)) configuration.SubtitleMode = patch.subtitleMode;
  if (typeof patch.subtitleLanguage === 'string') configuration.SubtitleLanguagePreference = long(patch.subtitleLanguage);
  await jellyfin.setConfiguration(user.token, user.id, configuration);
  return playbackPrefs(user);
}
