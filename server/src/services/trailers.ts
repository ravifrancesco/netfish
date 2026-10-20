import type { MediaType, TrailerChoices } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin } from '../clients/jellyfin';
import { seerr, type SeerrMovie } from '../clients/seerr';
import { settle } from '../lib/async';
import { HOUR, MINUTE, TTLCache } from '../lib/cache';
import { findLanguage } from '../lib/languages';
import { trailerOf } from './titles';

/**
 * Trailers in the two languages that matter: the audio language this person's Jellyfin profile
 * prefers, and English. Seerr doesn't say what language
 * a video is in, so each language is asked for on its own: what English has too is English (Seerr
 * fills in English when a language has no trailer).
 */

type Videos = SeerrMovie['relatedVideos'];
const videos = new TTLCache<{ videos: Videos; original?: string }>(500);
const preferences = new TTLCache<string | undefined>(200);

function videosIn(mediaType: MediaType, tmdbId: number, language: string) {
  return videos.wrap(`${mediaType}-${tmdbId}:${language}`, 6 * HOUR, async () => {
    const title = mediaType === 'movie' ? await seerr.movie(tmdbId, language) : await seerr.tv(tmdbId, language);
    return { videos: title.relatedVideos ?? [], original: title.originalLanguage };
  });
}

/** The audio language a Jellyfin profile prefers ("ita" → "it"), when it has one. */
function preferredLanguage(user: SessionUser): Promise<string | undefined> {
  return preferences
    .wrap(user.id, 10 * MINUTE, async () => findLanguage((await jellyfin.me(user.token)).Configuration?.AudioLanguagePreference || undefined)?.code)
    .catch(() => undefined);
}

export async function trailersFor(user: SessionUser, mediaType: MediaType, tmdbId: number): Promise<TrailerChoices> {
  const [preferred, english] = await Promise.all([preferredLanguage(user), videosIn(mediaType, tmdbId, 'en')]);
  const original = english.original;
  const inEnglish = new Set((english.videos ?? []).map((v) => v.key));
  // The profile's own language (when there's a trailer in it) and English: nothing else.
  const wanted = [...new Set([preferred, 'en'].filter((code): code is string => Boolean(code)))];
  const found = await Promise.all(
    wanted.map(async (code) => {
      const list = code === 'en' ? english.videos : (await settle(videosIn(mediaType, tmdbId, code), undefined))?.videos?.filter((v) => !inEnglish.has(v.key));
      const youtubeKey = trailerOf(list);
      return youtubeKey ? { language: code, label: findLanguage(code)?.native ?? code, youtubeKey, original: code === original } : undefined;
    }),
  );
  const options = found.filter((o): o is TrailerChoices['options'][number] => Boolean(o));
  // Their profile's language first, else English.
  const chosen = [preferred, 'en'].find((code) => options.some((o) => o.language === code)) ?? options[0]?.language;
  return { options, chosen };
}
