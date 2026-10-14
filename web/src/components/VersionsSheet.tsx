import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TriangleAlert, ArrowDownToLine, Check, RefreshCw, Search } from 'lucide-react';
import type { Release, TitleDetail } from '@netfish/shared';
import { api } from '../api';
import { bytes } from '../lib/format';
import { useLanguages, useMe, useRefreshTitle } from '../lib/hooks';
import { LanguageSelect } from './LanguageSelect';
import { ErrorState, Modal, Spinner, useToast } from './ui';

/**
 * "Versions": Radarr/Sonarr's Interactive Search, inside Netfish. Every result
 * from every indexer, filterable by language/quality, and one click hands the
 * chosen release back to Radarr/Sonarr to download and import.
 */

type Sort = 'best' | 'seeders' | 'size-asc' | 'size-desc' | 'newest';

const RESOLUTIONS = [
  { value: '', label: 'Any quality' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: 'sd', label: 'SD' },
];

function resolutionOf(r: Release): number {
  return r.resolution ?? Number(r.quality.match(/(\d{3,4})p/)?.[1] ?? 0);
}

function age(hours: number): string {
  if (hours < 24) return `${Math.max(1, Math.round(hours))} h`;
  if (hours < 24 * 60) return `${Math.round(hours / 24)} d`;
  return `${Math.round(hours / 24 / 30)} mo`;
}

export function VersionsSheet({
  title,
  onClose,
  language: initialLanguage = '',
  seasonNumber,
  episodeNumber,
}: {
  title: TitleDetail;
  onClose: () => void;
  language?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}) {
  const toast = useToast();
  const refresh = useRefreshTitle();
  const { data: languages = [] } = useLanguages();
  const { data: me } = useMe();
  const [showOversized, setShowOversized] = useState(false);
  const isTv = title.mediaType === 'tv';
  const seasons = (title.seasons ?? []).filter((s) => s.seasonNumber > 0);
  const [season, setSeason] = useState(seasonNumber ?? seasons.find((s) => s.status !== 'none')?.seasonNumber ?? seasons[0]?.seasonNumber ?? 1);
  const [episode, setEpisode] = useState<number | ''>(episodeNumber ?? '');
  const [language, setLanguage] = useState(initialLanguage);
  const [includeMulti, setIncludeMulti] = useState(true);
  const [resolution, setResolution] = useState('');
  const [text, setText] = useState('');
  const [hideRejected, setHideRejected] = useState(false);
  const [sort, setSort] = useState<Sort>('best');
  const [confirming, setConfirming] = useState<string>();
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());

  const search = useQuery({
    queryKey: ['releases', title.mediaType, title.tmdbId, isTv ? season : null, isTv ? episode : null, showOversized],
    queryFn: () =>
      api.releases(title.mediaType, title.tmdbId!, {
        ...(isTv ? { seasonNumber: season, episodeNumber: episode === '' ? undefined : episode } : {}),
        includeOversized: showOversized || undefined,
      }),
    staleTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(undefined), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const grab = useMutation({
    mutationFn: (r: Release) => api.grab(title.mediaType, title.tmdbId!, r.guid, r.indexerId),
    onSuccess: (_, r) => {
      setGrabbed((g) => new Set(g).add(r.guid));
      setConfirming(undefined);
      toast('ok', 'Sent to the downloader — follow it in Activity.');
      refresh(title.mediaType, title.tmdbId);
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  const data = search.data;
  const original = data?.originalLanguage;
  const langName = (code: string) => languages.find((l) => l.code === code)?.name ?? code;
  const presentCodes = useMemo(() => [...new Set((data?.releases ?? []).flatMap((r) => r.languageCodes))], [data]);

  const { strong, maybe } = useMemo(() => {
    let list = data?.releases ?? [];
    if (hideRejected) list = list.filter((r) => !r.rejected);
    if (resolution) list = list.filter((r) => (resolution === 'sd' ? resolutionOf(r) < 720 : resolutionOf(r) === Number(resolution)));
    if (text.trim()) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((r) => words.every((w) => `${r.title} ${r.indexer} ${r.quality}`.toLowerCase().includes(w)));
    }
    const sorters: Record<Sort, (a: Release, b: Release) => number> = {
      best: () => 0,
      seeders: (a, b) => (b.seeders ?? -1) - (a.seeders ?? -1),
      'size-asc': (a, b) => a.size - b.size,
      'size-desc': (a, b) => b.size - a.size,
      newest: (a, b) => a.ageHours - b.ageHours,
    };
    list = [...list].sort(sorters[sort]);
    if (!language) return { strong: list, maybe: [] as Release[] };
    return {
      strong: list.filter((r) => r.languageCodes.includes(language)),
      maybe: includeMulti ? list.filter((r) => !r.languageCodes.includes(language) && r.multi) : [],
    };
  }, [data, hideRejected, resolution, text, sort, language, includeMulti]);

  const renderRelease = (r: Release) => {
    const done = grabbed.has(r.guid);
    const keepsOriginal = language && original && language !== original && (r.languageCodes.includes(original) || r.multi);
    return (
      <li key={r.guid} className={`release${r.rejected ? ' is-rejected' : ''}`}>
        <div className="release__main">
          <div className="release__title" title={r.title}>
            {r.title}
          </div>
          <div className="release__badges">
            <span className="badge badge--strong">{r.quality}</span>
            <span className="badge">
              {bytes(r.size)}
              {r.sizePerEpisode && r.sizePerEpisode !== r.size ? ` · ${bytes(r.sizePerEpisode)}/ep` : ''}
            </span>
            {r.oversized && <span className="badge badge--bad">Over size limit</span>}
            {r.protocol === 'torrent' ? (
              <span className={`badge${(r.seeders ?? 0) === 0 ? ' badge--bad' : ''}`}>{r.seeders ?? '?'} seeders</span>
            ) : (
              <span className="badge">Usenet</span>
            )}
            <span className="badge">{age(r.ageHours)}</span>
            <span className="badge badge--dim">{r.indexer}</span>
            {r.fullSeason && <span className="badge badge--dim">Season pack</span>}
            {r.languageCodes.map((c) => (
              <span key={c} className={`badge badge--lang${c === language ? ' is-match' : ''}`}>
                {langName(c)}
              </span>
            ))}
            {r.multi && <span className="badge badge--lang">MULTi · languages unknown</span>}
            {keepsOriginal && <span className="badge badge--good">Keeps {langName(original!)}</span>}
          </div>
          {(r.rejected || (data?.current && !r.likelyImports)) && (
            <div className="release__warn">
              <TriangleAlert size={14} />
              <span>
                {r.rejected && `Radarr/Sonarr wouldn't pick this automatically: ${r.rejections.join('; ') || 'rejected'}. `}
                {data?.current && !r.likelyImports && `It may not replace your current ${data.current.quality ?? 'copy'} (lower quality).`}
              </span>
            </div>
          )}
        </div>
        <button
          className={`btn btn--sm ${confirming === r.guid ? 'btn--accent' : 'btn--ghost'}`}
          disabled={done || grab.isPending}
          onClick={() => (confirming === r.guid ? grab.mutate(r) : setConfirming(r.guid))}
        >
          {done ? (
            <>
              <Check size={16} /> Sent
            </>
          ) : grab.isPending && grab.variables?.guid === r.guid ? (
            <Spinner size={16} />
          ) : confirming === r.guid ? (
            'Confirm'
          ) : (
            <>
              <ArrowDownToLine size={16} /> Get
            </>
          )}
        </button>
      </li>
    );
  };

  const total = data?.releases.length ?? 0;
  const shown = strong.length + maybe.length;
  const seasonInfo = seasons.find((s) => s.seasonNumber === season);

  return (
    <Modal title={`Versions · ${title.title}`} onClose={onClose} wide>
      <div className="versions">
        {isTv && (
          <div className="versions__scope">
            <select className="select" value={season} onChange={(e) => (setSeason(Number(e.target.value)), setEpisode(''))}>
              {seasons.map((s) => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="select" value={episode} onChange={(e) => setEpisode(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Whole season</option>
              {Array.from({ length: seasonInfo?.episodeCount ?? 0 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Episode {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}

        {data?.current && (
          <p className="versions__current">
            In your library: <strong>{data.current.quality ?? 'unknown quality'}</strong>
            {data.current.languages.length > 0 && <> · {data.current.languages.join(', ')}</>}
          </p>
        )}

        <div className="filters">
          <label className="filters__field">
            <span>Audio language</span>
            <LanguageSelect value={language} onChange={setLanguage} anyLabel="Any language" />
          </label>
          <label className="filters__field">
            <span>Quality</span>
            <select className="select" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filters__field">
            <span>Sort</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="best">Best match</option>
              <option value="seeders">Most seeders</option>
              <option value="size-desc">Largest</option>
              <option value="size-asc">Smallest</option>
              <option value="newest">Newest</option>
            </select>
          </label>
          <label className="filters__field filters__field--grow">
            <span>Filter</span>
            <span className="input-icon">
              <Search size={16} />
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. remux, x265, group name" />
            </span>
          </label>
        </div>
        <div className="filters__toggles">
          <label className="check">
            <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} />
            <span>Hide releases Radarr/Sonarr would skip</span>
          </label>
          {language && (
            <label className="check">
              <input type="checkbox" checked={includeMulti} onChange={(e) => setIncludeMulti(e.target.checked)} />
              <span>Include MULTi releases that might have {langName(language)}</span>
            </label>
          )}
          {language && presentCodes.length > 0 && !presentCodes.includes(language) && (
            <span className="muted">No release is tagged {langName(language)} yet.</span>
          )}
          {me?.isAdmin && data?.limit && (
            <label className="check">
              <input type="checkbox" checked={showOversized} onChange={(e) => setShowOversized(e.target.checked)} />
              <span>Show releases over the size limit</span>
            </label>
          )}
        </div>
        {data && data.hiddenOversized > 0 && data.limit && (
          <p className="versions__limit">
            {data.hiddenOversized} release{data.hiddenOversized === 1 ? ' is' : 's are'} hidden for being over the{' '}
            {bytes(data.limit.bytes)}
            {data.limit.perEpisode ? ' per episode' : ''} limit{me?.isAdmin ? '.' : ' set by your admin.'}
          </p>
        )}

        {search.isLoading || search.isFetching ? (
          <div className="versions__loading">
            <Spinner size={26} />
            <p>Asking your indexers… this can take up to a minute.</p>
          </div>
        ) : search.isError ? (
          <ErrorState error={search.error} retry={() => void search.refetch()} />
        ) : (
          <>
            <div className="versions__count">
              <span>
                {shown} of {total} releases
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => void search.refetch()}>
                <RefreshCw size={14} /> Search again
              </button>
            </div>
            {shown === 0 ? (
              <div className="empty">
                <p>Nothing matches these filters.</p>
              </div>
            ) : (
              <ul className="releases">
                {strong.map(renderRelease)}
                {maybe.length > 0 && <li className="releases__divider">Might include {langName(language)} (MULTi)</li>}
                {maybe.map(renderRelease)}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
