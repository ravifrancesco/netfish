import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TriangleAlert, CalendarClock, Check, CircleCheck, Clock, Layers, Play, Plus, Star, Clapperboard, Undo2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { DownloadItem, MediaType, SeasonSummary, TitleDetail } from '@netfish/shared';
import { api, type TitleRef } from '../api';
import { Row } from '../components/Cards';
import { DownloadButton } from '../components/DownloadButton';
import { WatchTogetherButton } from '../components/Together';
import { NameLinks, PeopleRow } from '../components/People';
import { isNotAvailable, notOutText } from '../components/NotOut';
import { DeleteFromDisk, DownloadAgain, RemovedNote, StopDownload } from '../components/Manage';
import { RatingsStrip, TrailerPlayer } from '../components/Extras';
import { RequestButton } from '../components/RequestButton';
import { SubtitlesSheet } from '../components/SubtitlesSheet';
import { VersionsSheet } from '../components/VersionsSheet';
import { ErrorState, Img, Progress, Spinner, StatusChip, useToast } from '../components/ui';
import { AVAILABILITY_LABEL, DOWNLOAD_LABEL, ago, bytes, decimal, duration, percent } from '../lib/format';
import { t, tn, locale } from '../i18n';
import { useConfig, useMe, useRefreshTitle } from '../lib/hooks';

type Sheet =
  | { kind: 'versions'; language?: string; seasonNumber?: number; episodeNumber?: number }
  | { kind: 'subtitles'; seasonNumber?: number };

/** Watched / not watched in Jellyfin; for a show, every episode. */
function useSetWatched() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ itemId, watched }: { itemId: string; watched: boolean }) => api.setWatched(itemId, watched),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['title'] });
      void qc.invalidateQueries({ queryKey: ['season'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (err) => toast('error', (err as Error).message),
  });
}

function WatchedButton({ d }: { d: TitleDetail }) {
  const set = useSetWatched();
  if (!d.jellyfinId || d.watched === undefined) return null;
  return (
    <button className="btn btn--ghost btn--lg" disabled={set.isPending} onClick={() => set.mutate({ itemId: d.jellyfinId!, watched: !d.watched })}>
      {d.watched ? <Undo2 size={20} /> : <CircleCheck size={20} />} {d.watched ? t('Mark as unwatched') : t('Mark as watched')}
    </button>
  );
}

function EpisodeWatched({ itemId, played }: { itemId: string; played?: boolean }) {
  const set = useSetWatched();
  return (
    <button
      type="button"
      className={`link-btn episode__watched${played ? ' is-on' : ''}`}
      disabled={set.isPending}
      onClick={() => set.mutate({ itemId, watched: !played })}
      title={played ? t('Mark as unwatched') : undefined}
    >
      {played ? <Check size={14} /> : <CircleCheck size={14} />} {played ? t('Watched') : t('Mark as watched')}
    </button>
  );
}

function DownloadLine({ d, canStop }: { d: DownloadItem; canStop: boolean }) {
  const bits = [
    d.state === 'downloading' ? percent(d.progress) : DOWNLOAD_LABEL[d.state],
    d.size ? t('{done} of {total}', { done: bytes(d.size - d.sizeLeft), total: bytes(d.size) }) : undefined,
    d.etaSeconds ? t('{time} left', { time: duration(d.etaSeconds) }) : undefined,
    d.speed ? `${bytes(d.speed)}/s` : undefined,
  ].filter(Boolean);
  return (
    <div className={`dlline dlline--${d.state}`}>
      <div className="dlline__top">
        <span className="dlline__label">{d.detail && d.mediaType === 'tv' ? d.detail : DOWNLOAD_LABEL[d.state]}</span>
        <span className="muted">{bits.join(' · ')}</span>
        {canStop && <StopDownload d={d} small />}
      </div>
      <Progress value={d.progress} tone={d.state === 'stalled' || d.state === 'warning' ? 'warn' : 'accent'} />
      {d.message && (
        <div className="dlline__msg">
          <TriangleAlert size={14} /> {d.message}
        </div>
      )}
    </div>
  );
}

function StatusPanel({ d }: { d: TitleDetail }) {
  const { data: me } = useMe();
  // Admins, and whoever asked for it, can stop a download.
  const canStop = Boolean(me?.isAdmin || d.requests.some((r) => r.mine));
  const inLibrary = d.status === 'available' || d.status === 'partial';
  const latest = inLibrary ? undefined : d.requests[0];
  // A new episode only arrives by itself when Sonarr manages the show.
  const notOut = d.notOut && (d.notOut.kind !== 'airing' || d.managed) && !d.downloads.length ? d.notOut : undefined;
  const waitingForRelease = isNotAvailable(notOut);
  if (!d.downloads.length && !latest && d.status !== 'processing' && d.status !== 'pending' && !notOut && !d.removed) return null;
  return (
    <div className="statusbox">
      {d.downloads.map((dl) => (
        <DownloadLine key={dl.id} d={dl} canStop={canStop} />
      ))}
      <RemovedNote d={d} />
      {notOut && (
        <p className="statusbox__note">
          <CalendarClock size={16} />
          <span>
            {waitingForRelease && <strong>{t('Not available yet')} · </strong>}
            {notOutText(notOut, d.mediaType, d.managed || d.status !== 'none')}
          </span>
        </p>
      )}
      {!d.downloads.length && d.status === 'processing' && !waitingForRelease && (
        <p className="statusbox__note">
          <Clock size={16} /> {t("Requested — looking for a good release. It'll start downloading as soon as one turns up.")}
        </p>
      )}
      {d.status === 'pending' && (
        <p className="statusbox__note">
          <Clock size={16} /> {t('Waiting for an admin to approve the request.')}
        </p>
      )}
      {latest && (
        <p className="muted small">
          {latest.mine
            ? t('Requested by you {when}', { when: ago(latest.createdAt) })
            : t('Requested by {name} {when}', { name: latest.requestedBy, when: ago(latest.createdAt) })}
          {latest.status === 'declined' && ` · ${t('declined')}`}
        </p>
      )}
    </div>
  );
}

function Languages({ d, onSheet }: { d: TitleDetail; onSheet: (s: Sheet) => void }) {
  const { data: config } = useConfig();
  if (!d.play && d.status !== 'available' && d.status !== 'partial') return null;
  const canSubs = config?.features.subtitles && d.managed;
  return (
    <dl className="langs">
      <div className="langs__row">
        <dt>{t('Audio')}</dt>
        <dd>
          {d.audio.length ? d.audio.map((a) => a.label).join(' · ') : <span className="muted">{t('Unknown')}</span>}
          {d.canChooseVersion && (
            <button className="link-btn" onClick={() => onSheet({ kind: 'versions', language: '' })}>
              <Plus size={14} /> {t('Another language')}
            </button>
          )}
        </dd>
      </div>
      <div className="langs__row">
        <dt>{t('Subtitles')}</dt>
        <dd>
          {d.subtitles.length ? d.subtitles.map((s) => (s.forced ? t('{language} (forced)', { language: s.label }) : s.label)).join(' · ') : <span className="muted">{t('None')}</span>}
          {canSubs && (
            <button className="link-btn" onClick={() => onSheet({ kind: 'subtitles' })}>
              <Plus size={14} /> {t('Add subtitles')}
            </button>
          )}
        </dd>
      </div>
    </dl>
  );
}

function RequestSeason({ d, season }: { d: TitleDetail; season: SeasonSummary }) {
  const toast = useToast();
  const refresh = useRefreshTitle();
  const request = useMutation({
    mutationFn: () => api.request({ mediaType: 'tv', tmdbId: d.tmdbId!, seasons: [season.seasonNumber] }),
    onSuccess: () => {
      toast('ok', t('Requested {season}.', { season: season.name }));
      refresh('tv', d.tmdbId);
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  return (
    <button className="btn btn--accent btn--sm" disabled={request.isPending} onClick={() => request.mutate()}>
      {request.isPending ? <Spinner size={14} /> : <Plus size={16} />} {t('Request {season}', { season: season.name })}
    </button>
  );
}

function Episodes({ d, titleRef, onSheet, initialSeason }: { d: TitleDetail; titleRef: TitleRef; onSheet: (s: Sheet) => void; initialSeason?: number }) {
  const seasons = d.seasons ?? [];
  const [season, setSeason] = useState(initialSeason ?? seasons.find((s) => s.status === 'available' || s.status === 'partial')?.seasonNumber ?? seasons[0]?.seasonNumber ?? 1);
  const current = seasons.find((s) => s.seasonNumber === season);
  const q = useQuery({
    queryKey: ['season', titleRef.type, String(titleRef.id), season],
    queryFn: () => api.season(titleRef, season),
    refetchInterval: d.downloads.length ? 5000 : false,
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="section container">
      <div className="section__head">
        <h2>{t('Episodes')}</h2>
        <select className="select" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label={t('Season')}>
          {seasons.map((s) => (
            <option key={s.seasonNumber} value={s.seasonNumber}>
              {s.name}
            </option>
          ))}
        </select>
        {current && <StatusChip status={current.status} />}
        <span className="spacer" />
        {current?.status === 'none' && d.tmdbId && <RequestSeason d={d} season={current} />}
        {d.canChooseVersion && (
          <button className="btn btn--ghost btn--sm" onClick={() => onSheet({ kind: 'versions', seasonNumber: season })}>
            <Layers size={16} /> {t('Versions')}
          </button>
        )}
      </div>
      {q.data?.overview && <p className="muted section__lede">{q.data.overview}</p>}
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <ol className="episodes">
          {q.data!.episodes.map((e) => {
            const upcoming = !e.available && e.airDate && e.airDate > today;
            const thumb = (
              <>
                <Img src={e.still} className="episode__img" />
                {e.available && (
                  <span className="episode__play" aria-hidden="true">
                    <Play size={20} fill="currentColor" />
                  </span>
                )}
                {e.progress !== undefined && <Progress value={e.progress} tone="watch" className="episode__bar" />}
              </>
            );
            return (
              <li key={e.episodeNumber} className={`episode${e.available ? '' : ' is-missing'}`}>
                <span className="episode__num">{e.episodeNumber}</span>
                {e.jellyfinId ? (
                  <Link to={`/watch/${e.jellyfinId}`} className="episode__thumb" aria-label={t('Play episode {n}', { n: e.episodeNumber })}>
                    {thumb}
                  </Link>
                ) : (
                  <div className="episode__thumb">{thumb}</div>
                )}
                <div className="episode__body">
                  <div className="episode__top">
                    <h3>{e.title}</h3>
                    {e.runtimeMinutes && <span className="muted">{t('{m} min', { m: e.runtimeMinutes })}</span>}
                  </div>
                  {e.overview && <p className="episode__overview">{e.overview}</p>}
                  <div className="episode__status">
                    {e.download ? (
                      <span className="chip chip--dl">{t('Downloading {pct}%', { pct: Math.round(e.download.progress * 100) })}</span>
                    ) : upcoming ? (
                      <span className="muted small">{t('Airs {date}', { date: new Date(e.airDate!).toLocaleDateString(locale) })}</span>
                    ) : !e.available ? (
                      <span className="muted small">{t('Not in your library')}</span>
                    ) : e.jellyfinId ? (
                      <EpisodeWatched itemId={e.jellyfinId} played={e.played} />
                    ) : null}
                  </div>
                </div>
                {e.jellyfinId && (
                  <span className="episode__download">
                    <DownloadButton itemId={e.jellyfinId} compact />
                  </span>
                )}
                {d.canChooseVersion && !upcoming && (
                  <button
                    className="icon-btn icon-btn--sm episode__more"
                    title={t('Versions of this episode')}
                    aria-label={t('Versions of episode {n}', { n: e.episodeNumber })}
                    onClick={() => onSheet({ kind: 'versions', seasonNumber: season, episodeNumber: e.episodeNumber })}
                  >
                    <Layers size={16} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default function Title() {
  const { type = 'movie', id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const titleRef: TitleRef = { type: type as MediaType | 'jf', id };
  const q = useQuery({
    queryKey: ['title', type, id],
    queryFn: () => api.title(titleRef),
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.downloads.length || d.status === 'processing') ? 5000 : false;
    },
  });
  const [sheet, setSheet] = useState<Sheet>();
  const [trailer, setTrailer] = useState(false);
  const d = q.data;

  // Prefer canonical TMDB URLs; open a sheet when linked from the player.
  useEffect(() => {
    if (type === 'jf' && d?.tmdbId) navigate(`/title/${d.mediaType}/${d.tmdbId}`, { replace: true });
  }, [type, d, navigate]);
  useEffect(() => {
    const s = params.get('sheet');
    if (!d || !s) return;
    if (s === 'versions' && d.canChooseVersion) setSheet({ kind: 'versions', language: '' });
    if (s === 'subtitles') setSheet({ kind: 'subtitles' });
    setParams({}, { replace: true });
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isError) return <div className="page container"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (!d) {
    return (
      <div className="tp">
        <div className="tp__backdrop skeleton" />
        <div className="tp__head container">
          <Spinner size={28} />
        </div>
      </div>
    );
  }

  const meta = [
    d.year,
    d.certification,
    d.mediaType === 'movie' ? (d.runtimeMinutes ? duration(d.runtimeMinutes * 60) : undefined) : d.seasons ? tn(d.seasons.filter((s) => s.seasonNumber > 0).length, '{n} season', '{n} seasons') : undefined,
  ].filter(Boolean);
  const stars = d.cast.slice(0, 4);

  return (
    <div className="tp">
      <div className="tp__backdrop">
        <Img src={d.backdrop} className="tp__backdrop-img" />
      </div>
      <div className="tp__shade" />
      <div className="tp__head container">
        <div className="tp__poster">
          <Img src={d.poster} fallback={<span className="card__fallback">{d.title}</span>} />
        </div>
        <div className="tp__info">
          <h1 className="tp__title">{d.title}</h1>
          {d.originalTitle && <div className="tp__original">{d.originalTitle}</div>}
          <div className="tp__meta">
            {meta.map((m) => (
              <span key={String(m)}>{m}</span>
            ))}
            {d.rating && !d.tmdbId && (
              <span className="rating">
                <Star size={14} fill="currentColor" /> {decimal(d.rating)}
              </span>
            )}
            {d.status === 'processing' && isNotAvailable(d.notOut) ? (
              <span className="avail avail--pending">{t('Not available')}</span>
            ) : d.removed && !d.removed.seasons && d.status === 'none' ? (
              <span className="avail avail--none">{t('Not on disk')}</span>
            ) : (
              <span className={`avail avail--${d.status}`}>{AVAILABILITY_LABEL[d.status]}</span>
            )}
          </div>
          {d.genres.length > 0 && <div className="tp__genres">{d.genres.join(' · ')}</div>}
          {d.tmdbId && <RatingsStrip mediaType={d.mediaType} tmdbId={d.tmdbId} />}
          {d.tagline && <p className="tp__tagline">{d.tagline}</p>}
          {d.overview && <p className="tp__overview">{d.overview}</p>}

          <div className="tp__actions">
            {d.play && (
              <Link to={`/watch/${d.play.itemId}`} className="btn btn--primary btn--lg">
                <Play size={22} fill="currentColor" /> {d.play.label}
              </Link>
            )}
            {d.play && <WatchTogetherButton itemId={d.play.itemId} />}
            {d.play && d.mediaType === 'movie' && <DownloadButton itemId={d.play.itemId} />}
            {d.removed && !d.removed.seasons && d.canManage ? (
              <DownloadAgain d={d} className="btn btn--accent btn--lg" />
            ) : (
              <RequestButton title={d} className={d.play ? 'btn btn--ghost btn--lg' : 'btn btn--accent btn--lg'} />
            )}
            {d.canChooseVersion && (
              <button className="btn btn--ghost btn--lg" onClick={() => setSheet({ kind: 'versions' })}>
                <Layers size={20} /> {t('Versions')}
              </button>
            )}
            {d.trailerYoutubeKey && (
              <button className="btn btn--ghost btn--lg" onClick={() => setTrailer(true)}>
                <Clapperboard size={20} /> {t('Trailer')}
              </button>
            )}
            <WatchedButton d={d} />
            <DeleteFromDisk d={d} />
          </div>
          {d.play?.progress !== undefined && <Progress value={d.play.progress} tone="watch" className="tp__progress" />}

          <StatusPanel d={d} />
          <Languages d={d} onSheet={setSheet} />

          {(stars.length > 0 || d.crew.length > 0) && (
            <div className="tp__credits">
              {stars.length > 0 && (
                <p>
                  <span className="muted">{t('Starring')}</span> <NameLinks people={stars} />
                </p>
              )}
              {d.crew.length > 0 && (
                <p>
                  <span className="muted">{d.mediaType === 'tv' ? t('Created by') : t('Directed & written by')}</span> <NameLinks people={d.crew} />
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {d.mediaType === 'tv' && (d.seasons?.length ?? 0) > 0 && <Episodes d={d} titleRef={titleRef} onSheet={setSheet} />}

      {d.cast.length > 0 && (
        <section className="section container">
          <h2>{t('Cast')}</h2>
          <PeopleRow people={d.cast} />
        </section>
      )}

      {d.recommendations.length > 0 && (
        <div className="rows rows--flat">
          <Row row={{ id: 'more', title: t('More like this'), style: 'poster', items: d.recommendations }} />
        </div>
      )}

      {sheet?.kind === 'versions' && (
        <VersionsSheet
          title={d}
          onClose={() => setSheet(undefined)}
          language={sheet.language}
          seasonNumber={sheet.seasonNumber}
          episodeNumber={sheet.episodeNumber}
        />
      )}
      {trailer && d.trailerYoutubeKey && <TrailerPlayer youtubeKey={d.trailerYoutubeKey} title={d.title} onClose={() => setTrailer(false)} />}
      {sheet?.kind === 'subtitles' && <SubtitlesSheet title={d} onClose={() => setSheet(undefined)} seasonNumber={sheet.seasonNumber} />}
    </div>
  );
}
