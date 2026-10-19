import type {
  Availability,
  EpisodeInfo,
  LangTrack,
  MediaType,
  Person,
  SeasonDetail,
  SeasonSummary,
  TitleDetail,
} from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { jellyfin, ticksToSeconds, type JfItem, type JfItemsResult, type JfMediaStream } from '../clients/jellyfin';
import type { SeerrMediaInfo, SeerrMovie, SeerrPage, SeerrTv } from '../clients/seerr';
import { settle } from '../lib/async';
import { jfImage, tmdbImage } from '../lib/images';
import { findLanguage, languageLabel } from '../lib/languages';
import { HttpError } from '../lib/upstream';
import { radarrMovie, sonarrSeries } from './arrLookup';
import { canChooseVersion } from './releases';
import { movieNotOut, showNotOut } from './notOut';
import { diskOf, removedInfo } from './manage';
import { availabilityFromSeerr, episodeLabel, resolveAvailability, seerrCards } from './cards';
import { catalog } from './catalog';
import { allDownloads, detailsFor, downloadsFor, progressByTitle } from './downloads';
import { findInLibrary, libraryIndex } from './library';
import { handOverWatched, markOffDisk, offDiskWatched } from './watched';
import { toSummary } from './requests';
import { maybeSeerrUserId } from './seerrUsers';
import { t } from '../lib/i18n';

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };
const EMPTY_PAGE: SeerrPage = { page: 1, totalPages: 0, totalResults: 0, results: [] };
const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || undefined : undefined);

// ---------- Tracks ----------

function dedupe(tracks: LangTrack[]): LangTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = `${t.code ?? t.label}|${t.forced ? 'f' : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tracksFrom(streams: JfMediaStream[] = []): { audio: LangTrack[]; subtitles: LangTrack[] } {
  const toTrack = (s: JfMediaStream): LangTrack => ({
    code: findLanguage(s.Language)?.code ?? s.Language,
    label: languageLabel(s.Language) ?? s.Title ?? s.DisplayTitle ?? 'Unknown',
    codec: s.Codec,
    external: s.IsExternal || undefined,
    forced: s.IsForced || undefined,
    default: s.IsDefault || undefined,
  });
  return {
    audio: dedupe(streams.filter((s) => s.Type === 'Audio').map(toTrack)),
    subtitles: dedupe(streams.filter((s) => s.Type === 'Subtitle').map(toTrack)),
  };
}

const streamsOf = (item?: JfItem) => item?.MediaStreams ?? item?.MediaSources?.[0]?.MediaStreams ?? [];

function playOf(item: JfItem | undefined): TitleDetail['play'] {
  if (!item) return undefined;
  const pos = item.UserData?.PlaybackPositionTicks ?? 0;
  const progress = pos && item.RunTimeTicks ? pos / item.RunTimeTicks : undefined;
  const ep = item.Type === 'Episode' ? episodeLabel(item) : undefined;
  const label = pos > 0 ? (ep ? t('Resume {episode}', { episode: ep }) : t('Resume')) : ep ? t('Play {episode}', { episode: ep }) : t('Play');
  return { itemId: item.Id, label, progress };
}

/** The episode the Play button should start: in-progress or next unwatched, else the first. */
async function nextEpisode(user: SessionUser, seriesId: string): Promise<JfItem | undefined> {
  const next = await settle(
    jellyfin.nextUp(user.token, user.id, { seriesId, limit: 1, enableResumable: true, disableFirstEpisode: false }),
    EMPTY,
  );
  const pick = next.Items[0] ?? (await settle(jellyfin.episodes(user.token, user.id, seriesId, { limit: 1 }), EMPTY)).Items[0];
  return pick ? settle(jellyfin.item(user.token, user.id, pick.Id), pick) : undefined;
}

/** What Play starts for a title in the library: the film, or the show's next episode. */
export async function playTarget(user: SessionUser, mediaType: 'movie' | 'tv', jellyfinId: string): Promise<TitleDetail['play']> {
  const item = mediaType === 'tv' ? await nextEpisode(user, jellyfinId) : await settle(jellyfin.item(user.token, user.id, jellyfinId), undefined);
  return playOf(item);
}

// ---------- People ----------

function castFromTmdb(credits?: SeerrMovie['credits']): Person[] {
  return [...(credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 16)
    .map((c) => ({ id: c.id ? String(c.id) : undefined, name: c.name, role: c.character, photo: tmdbImage(c.profilePath, 'w185') }));
}

/** Directors and writers, each once even when they did both. */
function crewFromTmdb(credits?: SeerrMovie['credits']): Person[] {
  const seen = new Set<string>();
  return (credits?.crew ?? [])
    .filter((c) => c.job === 'Director' || c.job === 'Screenplay' || c.job === 'Writer')
    .filter((c) => !seen.has(c.name) && Boolean(seen.add(c.name)))
    .slice(0, 4)
    .map((c) => ({ id: c.id ? String(c.id) : undefined, name: c.name, role: c.job }));
}

function castFromJellyfin(item: JfItem): { cast: Person[]; crew: Person[] } {
  const people = item.People ?? [];
  const photo = (p: (typeof people)[number]) => jfImage(p.Id, 'Primary', p.PrimaryImageTag, { maxWidth: 185 });
  return {
    cast: people.filter((p) => p.Type === 'Actor').slice(0, 16).map((p) => ({ id: `jf-${p.Id}`, name: p.Name, role: p.Role, photo: photo(p) })),
    crew: people
      .filter((p) => p.Type === 'Director' || p.Type === 'Writer')
      .filter((p, i, all) => all.findIndex((q) => q.Name === p.Name) === i)
      .slice(0, 4)
      .map((p) => ({ id: `jf-${p.Id}`, name: p.Name, role: p.Type })),
  };
}

export const trailerOf = (videos?: SeerrMovie['relatedVideos']) =>
  (videos?.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ?? videos?.find((v) => v.site === 'YouTube'))?.key;

function requestsOf(mediaInfo: SeerrMediaInfo | undefined, mySeerrId: number | undefined) {
  return (mediaInfo?.requests ?? [])
    .map((r) => toSummary(r, mySeerrId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Movies ----------

export async function movieDetail(user: SessionUser, tmdbId: number): Promise<TitleDetail> {
  const index = await libraryIndex(user);
  const entry = findInLibrary(index, 'movie', tmdbId);
  if (!has.seerr()) {
    if (!entry) throw new HttpError(404, t('Not in your library'));
    return jellyfinDetail(user, entry.id);
  }

  const [movie, downloads, mySeerrId, item, recs, managed] = await Promise.all([
    catalog.movie(tmdbId),
    settle(allDownloads(), []),
    maybeSeerrUserId(user),
    entry ? settle(jellyfin.item(user.token, user.id, entry.id), undefined) : Promise.resolve(undefined),
    settle(catalog.recommendations('movie', tmdbId), EMPTY_PAGE),
    settle(radarrMovie(tmdbId), null),
  ]);
  const removed = await removedInfo('movie', tmdbId);
  // Back on disk: a watched mark made while it wasn't goes to Jellyfin.
  const handed = item ? await settle(handOverWatched(user, `movie-${tmdbId}`, item.Id), undefined) : undefined;
  // Deleted from disk through Netfish: not available, whatever Seerr still says.
  const status = removed && !entry ? 'none' : resolveAvailability(movie.mediaInfo, Boolean(entry));
  const certification = movie.releases?.results
    ?.find((r) => r.iso_3166_1 === 'US')
    ?.release_dates?.find((d) => d.certification)?.certification;

  return {
    key: `movie-${tmdbId}`,
    mediaType: 'movie',
    tmdbId,
    jellyfinId: entry?.id,
    title: movie.title,
    originalTitle: movie.originalTitle !== movie.title ? movie.originalTitle : undefined,
    year: year(movie.releaseDate),
    overview: movie.overview,
    tagline: movie.tagline || undefined,
    runtimeMinutes: movie.runtime || undefined,
    genres: movie.genres?.map((g) => g.name) ?? [],
    rating: movie.voteAverage || undefined,
    certification,
    poster: tmdbImage(movie.posterPath, 'w500'),
    backdrop: tmdbImage(movie.backdropPath, 'original'),
    originalLanguage: movie.originalLanguage,
    status,
    cast: castFromTmdb(movie.credits),
    crew: crewFromTmdb(movie.credits),
    trailerYoutubeKey: trailerOf(movie.relatedVideos),
    play: playOf(item),
    watched: item ? (handed ?? Boolean(item.UserData?.Played)) : removed ? (offDiskWatched(user.id, `movie-${tmdbId}`) ?? false) : undefined,
    ...tracksFrom(streamsOf(item)),
    requests: requestsOf(movie.mediaInfo, mySeerrId),
    downloads: downloadsFor(downloads, 'movie', tmdbId).map((d) => detailsFor(user.isAdmin, d)),
    recommendations: seerrCards(recs.results, index, progressByTitle(downloads)).slice(0, 18),
    managed: Boolean(managed),
    notOut: status === 'available' ? undefined : movieNotOut(movie, managed),
    disk: user.isAdmin ? diskOf('movie', managed) : undefined,
    removed,
    canManage: user.isAdmin && Boolean(managed),
    canChooseVersion: Boolean(managed) && canChooseVersion(user),
    canRequest: status === 'none',
  };
}

// ---------- Shows ----------

function seasonStatus(tv: SeerrTv, seasonNumber: number, inJellyfin: boolean): Availability {
  const s = availabilityFromSeerr(tv.mediaInfo?.seasons?.find((x) => x.seasonNumber === seasonNumber)?.status);
  if (!inJellyfin) return s;
  return s === 'available' || s === 'none' ? 'available' : 'partial';
}

export async function tvDetail(user: SessionUser, tmdbId: number): Promise<TitleDetail> {
  const index = await libraryIndex(user);
  if (!has.seerr()) {
    const entry = findInLibrary(index, 'tv', tmdbId);
    if (!entry) throw new HttpError(404, t('Not in your library'));
    return jellyfinDetail(user, entry.id);
  }

  const tv = await catalog.tv(tmdbId);
  const tvdbId = tv.externalIds?.tvdbId;
  const entry = findInLibrary(index, 'tv', tmdbId, tvdbId);
  const [downloads, mySeerrId, jfSeasons, playItem, recs, managed, series] = await Promise.all([
    settle(allDownloads(), []),
    maybeSeerrUserId(user),
    entry ? settle(jellyfin.seasons(user.token, user.id, entry.id), EMPTY) : Promise.resolve(EMPTY),
    entry ? nextEpisode(user, entry.id) : Promise.resolve(undefined),
    settle(catalog.recommendations('tv', tmdbId), EMPTY_PAGE),
    settle(sonarrSeries(tvdbId), null),
    entry ? settle(jellyfin.item(user.token, user.id, entry.id), undefined) : Promise.resolve(undefined),
  ]);

  const jfByNumber = new Map(jfSeasons.Items.map((s) => [s.IndexNumber ?? -1, s]));
  const seasons: SeasonSummary[] = (tv.seasons ?? [])
    .filter((s) => s.seasonNumber > 0 || jfByNumber.has(0))
    .map((s) => ({
      seasonNumber: s.seasonNumber,
      name: s.name,
      episodeCount: s.episodeCount,
      airDate: s.airDate ?? undefined,
      poster: tmdbImage(s.posterPath, 'w342'),
      status: seasonStatus(tv, s.seasonNumber, jfByNumber.has(s.seasonNumber)),
      jellyfinId: jfByNumber.get(s.seasonNumber)?.Id,
    }));
  // Seasons deleted from disk through Netfish: Seerr keeps calling them available until its next sync.
  const removed = await removedInfo('tv', tmdbId);
  const handed = series ? await settle(handOverWatched(user, `tv-${tmdbId}`, series.Id), undefined) : undefined;
  for (const s of seasons) {
    if (removed && (!removed.seasons || removed.seasons.includes(s.seasonNumber)) && !jfByNumber.has(s.seasonNumber) && s.status === 'available') s.status = 'none';
  }
  const status = removed && !removed.seasons && !entry ? 'none' : resolveAvailability(tv.mediaInfo, Boolean(entry));
  const certification = tv.contentRatings?.results?.find((r) => r.iso_3166_1 === 'US')?.rating;

  return {
    key: `tv-${tmdbId}`,
    mediaType: 'tv',
    tmdbId,
    jellyfinId: entry?.id,
    title: tv.name,
    originalTitle: tv.originalName !== tv.name ? tv.originalName : undefined,
    year: year(tv.firstAirDate),
    overview: tv.overview,
    tagline: tv.tagline || undefined,
    runtimeMinutes: tv.episodeRunTime?.[0],
    genres: tv.genres?.map((g) => g.name) ?? [],
    rating: tv.voteAverage || undefined,
    certification,
    poster: tmdbImage(tv.posterPath, 'w500'),
    backdrop: tmdbImage(tv.backdropPath, 'original'),
    originalLanguage: tv.originalLanguage,
    status,
    cast: castFromTmdb(tv.credits),
    crew: (tv.createdBy ?? []).map((c) => ({ id: c.id ? String(c.id) : undefined, name: c.name, role: 'Creator' })),
    trailerYoutubeKey: trailerOf(tv.relatedVideos),
    play: playOf(playItem),
    watched: series ? (handed ?? Boolean(series.UserData?.Played)) : removed && !removed.seasons ? (offDiskWatched(user.id, `tv-${tmdbId}`) ?? false) : undefined,
    ...tracksFrom(streamsOf(playItem)),
    requests: requestsOf(tv.mediaInfo, mySeerrId),
    downloads: downloadsFor(downloads, 'tv', tmdbId, tvdbId).map((d) => detailsFor(user.isAdmin, d)),
    seasons,
    recommendations: seerrCards(recs.results, index, progressByTitle(downloads)).slice(0, 18),
    managed: Boolean(managed),
    notOut: showNotOut(tv, managed),
    disk: user.isAdmin ? diskOf('tv', managed) : undefined,
    removed,
    canManage: user.isAdmin && Boolean(managed),
    canChooseVersion: Boolean(managed) && canChooseVersion(user),
    canRequest: seasons.some((s) => s.seasonNumber > 0 && s.status === 'none'),
  };
}

function episodesFromJellyfin(items: JfItem[], seasonNumber: number): Map<number, JfItem> {
  const map = new Map<number, JfItem>();
  for (const ep of items) {
    if (ep.ParentIndexNumber !== seasonNumber || ep.IndexNumber === undefined) continue;
    for (let n = ep.IndexNumber; n <= (ep.IndexNumberEnd ?? ep.IndexNumber); n++) map.set(n, ep);
  }
  return map;
}

function jfEpisode(ep: JfItem, seasonNumber: number, episodeNumber: number): EpisodeInfo {
  const pos = ep.UserData?.PlaybackPositionTicks ?? 0;
  return {
    seasonNumber,
    episodeNumber,
    title: ep.Name,
    overview: ep.Overview,
    still: jfImage(ep.Id, 'Primary', ep.ImageTags?.Primary, { maxWidth: 400 }),
    airDate: ep.PremiereDate?.slice(0, 10),
    runtimeMinutes: ep.RunTimeTicks ? Math.round(ticksToSeconds(ep.RunTimeTicks) / 60) : undefined,
    jellyfinId: ep.Id,
    available: true,
    progress: pos && ep.RunTimeTicks ? pos / ep.RunTimeTicks : undefined,
    played: ep.UserData?.Played || undefined,
  };
}

export async function seasonDetail(user: SessionUser, tmdbId: number, seasonNumber: number): Promise<SeasonDetail> {
  const index = await libraryIndex(user);
  const tv = has.seerr() ? await catalog.tv(tmdbId) : undefined;
  const tvdbId = tv?.externalIds?.tvdbId;
  const entry = findInLibrary(index, 'tv', tmdbId, tvdbId);
  if (!tv && !entry) throw new HttpError(404, t('Not in your library'));

  const [season, jfEps, downloads] = await Promise.all([
    tv ? settle(catalog.season(tmdbId, seasonNumber), undefined) : Promise.resolve(undefined),
    entry ? settle(jellyfin.episodes(user.token, user.id, entry.id, { season: seasonNumber }), EMPTY) : Promise.resolve(EMPTY),
    settle(allDownloads(), []),
  ]);
  const local = episodesFromJellyfin(jfEps.Items, seasonNumber);
  const active = downloadsFor(downloads, 'tv', tmdbId, tvdbId).filter((d) => d.seasonNumber === seasonNumber);

  const episodes: EpisodeInfo[] = (season?.episodes ?? []).map((e) => {
    const jf = local.get(e.episodeNumber);
    const dl = active.find((d) => d.episodes?.includes(e.episodeNumber));
    const base = jf ? jfEpisode(jf, seasonNumber, e.episodeNumber) : undefined;
    return {
      seasonNumber,
      episodeNumber: e.episodeNumber,
      title: e.name || base?.title || `Episode ${e.episodeNumber}`,
      overview: e.overview || base?.overview,
      still: tmdbImage(e.stillPath, 'w300') ?? base?.still,
      airDate: e.airDate ?? base?.airDate,
      runtimeMinutes: e.runtime || base?.runtimeMinutes,
      jellyfinId: base?.jellyfinId,
      available: Boolean(base),
      progress: base?.progress,
      played: base?.played,
      download: dl ? { progress: dl.progress, state: dl.state } : undefined,
    };
  });
  // Anything Jellyfin has that TMDB doesn't know about (specials, odd numbering).
  const known = new Set(episodes.map((e) => e.episodeNumber));
  for (const [n, ep] of local) if (!known.has(n)) episodes.push(jfEpisode(ep, seasonNumber, n));
  episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

  return { seasonNumber, name: season?.name, overview: season?.overview || undefined, episodes };
}

// ---------- Jellyfin-only (no Seerr, or items without a TMDB id) ----------

export async function jellyfinDetail(user: SessionUser, itemId: string): Promise<TitleDetail> {
  const [item, downloads] = await Promise.all([jellyfin.item(user.token, user.id, itemId), settle(allDownloads(), [])]);
  if (item.Type !== 'Movie' && item.Type !== 'Series') throw new HttpError(400, t("Can't show details for a {type}", { type: item.Type }));
  const mediaType: MediaType = item.Type === 'Series' ? 'tv' : 'movie';
  const tmdbId = Number(item.ProviderIds?.Tmdb) || undefined;
  const tvdbId = Number(item.ProviderIds?.Tvdb) || undefined;

  let playItem: JfItem | undefined = item;
  let seasons: SeasonSummary[] | undefined;
  if (mediaType === 'tv') {
    const [jfSeasons, next] = await Promise.all([
      settle(jellyfin.seasons(user.token, user.id, item.Id), EMPTY),
      nextEpisode(user, item.Id),
    ]);
    playItem = next;
    seasons = jfSeasons.Items.map((s) => ({
      seasonNumber: s.IndexNumber ?? 0,
      name: s.Name,
      episodeCount: 0,
      poster: jfImage(s.Id, 'Primary', s.ImageTags?.Primary, { maxHeight: 480 }),
      status: 'available',
      jellyfinId: s.Id,
    }));
  }
  const managed = mediaType === 'movie' && tmdbId ? await settle(radarrMovie(tmdbId), null) : await settle(sonarrSeries(tvdbId), null);

  return {
    key: tmdbId ? `${mediaType}-${tmdbId}` : `jf-${item.Id}`,
    mediaType,
    tmdbId,
    jellyfinId: item.Id,
    title: item.Name,
    originalTitle: item.OriginalTitle !== item.Name ? item.OriginalTitle : undefined,
    year: item.ProductionYear,
    overview: item.Overview,
    tagline: item.Taglines?.[0],
    runtimeMinutes: item.RunTimeTicks ? Math.round(ticksToSeconds(item.RunTimeTicks) / 60) : undefined,
    genres: item.Genres ?? [],
    rating: item.CommunityRating,
    certification: item.OfficialRating,
    poster: jfImage(item.Id, 'Primary', item.ImageTags?.Primary, { maxHeight: 750 }),
    backdrop: jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 1920 }),
    status: 'available',
    ...castFromJellyfin(item),
    play: playOf(playItem),
    ...tracksFrom(streamsOf(playItem)),
    requests: [],
    downloads: tmdbId || tvdbId ? downloadsFor(downloads, mediaType, tmdbId, tvdbId).map((d) => detailsFor(user.isAdmin, d)) : [],
    seasons,
    recommendations: [],
    managed: Boolean(managed),
    canManage: false,
    canChooseVersion: Boolean(managed) && canChooseVersion(user),
    canRequest: false,
  };
}

export async function jellyfinSeason(user: SessionUser, seriesId: string, seasonNumber: number): Promise<SeasonDetail> {
  const eps = await jellyfin.episodes(user.token, user.id, seriesId, { season: seasonNumber });
  const local = episodesFromJellyfin(eps.Items, seasonNumber);
  return {
    seasonNumber,
    episodes: [...local].sort(([a], [b]) => a - b).map(([n, ep]) => jfEpisode(ep, seasonNumber, n)),
  };
}

/**
 * Watched or not from a title's page, when Jellyfin has no item for it (deleted from disk): Netfish
 * keeps it until the title is back. In Jellyfin: Jellyfin's own flag, as ever.
 */
export async function setTitleWatched(user: SessionUser, mediaType: MediaType, tmdbId: number, watched: boolean) {
  const entry = findInLibrary(await libraryIndex(user), mediaType, tmdbId);
  if (entry) await jellyfin.setPlayed(user.token, user.id, entry.id, watched);
  else markOffDisk(user.id, `${mediaType}-${tmdbId}`, watched);
  return { ok: true };
}
