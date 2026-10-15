import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorCog } from 'lucide-react';
import { useLocation } from 'react-router';
import type { ServerSettings } from '@netfish/shared';
import { api } from '../api';
import { Connections } from '../components/Connections';
import { Storage } from '../components/Storage';
import { AppUpdate } from '../components/AppUpdate';
import { notifySupport } from '../lib/notify';
import { DeviceProfiles } from '../components/DeviceProfiles';
import { LanguageSelect } from '../components/LanguageSelect';
import { Mark } from '../components/Logo';
import { Spinner, StorageWarning, useToast } from '../components/ui';
import { useConfig, useMe } from '../lib/hooks';
import { appKind, desktop, useOffline } from '../lib/desktop';
import { bytes } from '../lib/format';
import { defaultScreenName, savedScreenName, setScreenName } from '../lib/screens';
import { setPrefs, usePrefs } from '../lib/prefs';
import { LANGUAGES, languageSetting, setLanguage, t, tn, type Language } from '../i18n';

const BITRATES = [
  { value: 0, label: t('Best available (home network)') },
  { value: 40_000_000, label: '40 Mbps' },
  { value: 20_000_000, label: '20 Mbps' },
  { value: 10_000_000, label: '10 Mbps' },
  { value: 6_000_000, label: '6 Mbps' },
  { value: 3_000_000, label: t('3 Mbps (mobile data)') },
];


/** What this device is called when someone picks where to play something (Play on TV). */
function ScreenNameField() {
  const [name, setName] = useState(savedScreenName);
  return (
    <label className="field">
      <span>{t("This device's name")}</span>
      <input
        className="input"
        value={name}
        maxLength={40}
        placeholder={defaultScreenName()}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setScreenName(name)}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <small className="muted">{t('Shown when you or someone at home picks where to play something, like "Living room TV".')}</small>
    </label>
  );
}

function OfflineStorage() {
  const list = useOffline();
  const [used, setUsed] = useState<number>();
  useEffect(() => {
    void desktop()?.offlineUsage?.().then(setUsed);
  }, [list]);
  return (
    <div className="account">
      <div className="muted small">
        {list.length
          ? tn(list.length, '{n} download · {size} on {device}', '{n} downloads · {size} on {device}', { size: bytes(used), device: appKind().device })
          : t('Nothing downloaded on {device}', { device: appKind().device })}
      </div>
      <span className="spacer" />
      <button className="btn btn--ghost" onClick={() => desktop()?.openOffline?.()}>
        {t('Downloads')}
      </button>
      {list.length > 0 && (
        <button
          className="btn btn--ghost"
          onClick={() => confirm(t('Delete every download from {device}?', { device: appKind().device })) && void desktop()?.clearOffline?.()}
        >
          {t('Delete all')}
        </button>
      )}
    </div>
  );
}

const asText = (v: number | null | undefined) => (v ? String(v) : '');
const asLimit = (v: string) => (v.trim() === '' ? null : Number(v));

/** Server-wide download rules. Applies to versions people pick in Netfish. */
function DownloadRules() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: api.adminSettings });
  const [movie, setMovie] = useState('');
  const [episode, setEpisode] = useState('');
  const [grabs, setGrabs] = useState<ServerSettings['manualGrabs']>('all');
  useEffect(() => {
    if (!q.data) return;
    setMovie(asText(q.data.maxMovieSizeGb));
    setEpisode(asText(q.data.maxEpisodeSizeGb));
    setGrabs(q.data.manualGrabs);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.saveAdminSettings({ maxMovieSizeGb: asLimit(movie), maxEpisodeSizeGb: asLimit(episode), manualGrabs: grabs }),
    onSuccess: (data) => {
      qc.setQueryData(['admin-settings'], data);
      void qc.invalidateQueries({ queryKey: ['releases'] });
      void qc.invalidateQueries({ queryKey: ['title'] });
      toast('ok', t('Download rules saved.'));
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  if (!q.data) return <Spinner />;
  const dirty =
    asText(q.data.maxMovieSizeGb) !== movie.trim() || asText(q.data.maxEpisodeSizeGb) !== episode.trim() || q.data.manualGrabs !== grabs;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="field">
        <span>{t('Who can pick specific versions')}</span>
        <select className="select" value={grabs} onChange={(e) => setGrabs(e.target.value as ServerSettings['manualGrabs'])}>
          <option value="all">{t('Everyone')}</option>
          <option value="admin">{t('Admins only')}</option>
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t('Max size for a movie')}</span>
          <span className="input-unit">
            <input className="input" type="number" min="0" step="0.5" inputMode="decimal" placeholder={t('No limit')} value={movie} onChange={(e) => setMovie(e.target.value)} />
            <span>GB</span>
          </span>
        </label>
        <label className="field">
          <span>{t('Max size per episode')}</span>
          <span className="input-unit">
            <input className="input" type="number" min="0" step="0.5" inputMode="decimal" placeholder={t('No limit')} value={episode} onChange={(e) => setEpisode(e.target.value)} />
            <span>GB</span>
          </span>
        </label>
      </div>
      <small className="muted">
        {t(
          "Releases over these sizes are hidden in Versions and can't be downloaded from Netfish. Season packs count per episode (a 10-episode pack under a 2 GB limit can be up to 20 GB). Admins can still show and pick them. Automatic downloads from requests follow Radarr/Sonarr's own size settings.",
        )}
      </small>
      <div>
        <button className="btn btn--accent" disabled={!dirty || save.isPending}>
          {save.isPending ? <Spinner size={16} /> : null} {t('Save')}
        </button>
      </div>
    </form>
  );
}

export default function Settings() {
  const prefs = usePrefs();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [hash]);
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });

  return (
    <div className="page container page--narrow">
      <h1 className="page__title">{t('Settings')}</h1>
      {me?.isAdmin && <StorageWarning problem={config?.storageProblem} />}

      <section className="panel">
        <h2>{t('Account')}</h2>
        <div className="account">
          <div className="avatar avatar--lg">{me?.avatar ? <img src={me.avatar} alt="" /> : <span>{me?.name[0]?.toUpperCase()}</span>}</div>
          <div>
            <strong>{me?.name}</strong>
            <div className="muted small">{t('{role} · signed in with your Jellyfin account', { role: me?.isAdmin ? t('Administrator') : t('Member') })}</div>
          </div>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={() => logout.mutate()}>
            <LogOut size={18} /> {t('Sign out')}
          </button>
        </div>
      </section>

      <section className="panel" id="profiles">
        <h2>{t('Profiles on this device')}</h2>
        <DeviceProfiles />
      </section>

      <section className="panel">
        <h2>{t('Language')}</h2>
        <label className="field">
          <select className="select" value={languageSetting()} onChange={(e) => setLanguage(e.target.value as 'auto' | Language)} aria-label={t('Language')}>
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === 'auto' ? t(option.label) : option.label}
              </option>
            ))}
          </select>
          <small className="muted">{t("Automatic follows this device's language. Changing it reloads the page.")}</small>
        </label>
      </section>

      <section className="panel">
        <h2>{t('Playback on this device')}</h2>
        <ScreenNameField />
        <label className="field">
          <span>{t('Streaming quality')}</span>
          <select className="select" value={prefs.maxBitrate} onChange={(e) => setPrefs({ maxBitrate: Number(e.target.value) })}>
            {BITRATES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          <small className="muted">{t('Lower it when watching away from home. Anything the Pi has to shrink costs it CPU.')}</small>
        </label>
        <label className="field">
          <span>{t('Preferred audio language')}</span>
          <LanguageSelect value={prefs.audioLanguage} onChange={(audioLanguage) => setPrefs({ audioLanguage })} anyLabel={t('Original / file default')} />
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.subtitlesByDefault} onChange={(e) => setPrefs({ subtitlesByDefault: e.target.checked })} />
          <span>{t('Turn subtitles on automatically')}</span>
        </label>
        <label className="field">
          <span>{t('Subtitle language')}</span>
          <LanguageSelect value={prefs.subtitleLanguage} onChange={(subtitleLanguage) => setPrefs({ subtitleLanguage })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={prefs.autoplayNext} onChange={(e) => setPrefs({ autoplayNext: e.target.checked })} />
          <span>{t('Play the next episode automatically')}</span>
        </label>
        {notifySupport() && (
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.notifyReady && (notifySupport() === 'app' || Notification.permission === 'granted')}
              onChange={async (e) => {
                const on = e.target.checked;
                // A browser asks once whether Netfish may notify.
                if (on && notifySupport() === 'browser' && Notification.permission !== 'granted') {
                  if ((await Notification.requestPermission()) !== 'granted') return;
                }
                setPrefs({ notifyReady: on });
              }}
            />
            <span>{t('Notify me when something I asked for is ready to watch')}</span>
          </label>
        )}
        {notifySupport() && (
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.notifyTogether && (notifySupport() === 'app' || Notification.permission === 'granted')}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && notifySupport() === 'browser' && Notification.permission !== 'granted') {
                  if ((await Notification.requestPermission()) !== 'granted') return;
                }
                setPrefs({ notifyTogether: on });
              }}
            />
            <span>{t('Notify me when someone wants to watch together')}</span>
          </label>
        )}
      </section>

      {desktop() && (
        <section className="panel" id="app">
          <h2>{appKind().name}</h2>
          <div className="account">
            <MonitorCog size={22} />
            <div className="muted small">Netfish {desktop()?.version} · {location.host}</div>
            <span className="spacer" />
            <button className="btn btn--ghost" onClick={() => desktop()?.changeServer()}>
              {t('Change server…')}
            </button>
          </div>
          {desktop()?.update && <AppUpdate />}
          {desktop()?.openOffline && <OfflineStorage />}
        </section>
      )}

      {me?.isAdmin && (
        <section className="panel" id="connections">
          <h2>{t('Connections')}</h2>
          <p className="muted small">
            {t("Where Netfish finds your other services. Saved here, these take over from the Portainer stack's variables and apply right away.")}
          </p>
          <Connections />
        </section>
      )}

      {me?.isAdmin && config?.features.downloads && (
        <section className="panel" id="storage">
          <h2>{t('Storage')}</h2>
          <Storage />
        </section>
      )}

      {me?.isAdmin && config?.features.versions && (
        <section className="panel">
          <h2>{t('Downloads')}</h2>
          <DownloadRules />
        </section>
      )}

      <footer className="about">
        <Mark size={22} />
        <span className="muted small">Netfish {config?.version}</span>
      </footer>
    </div>
  );
}
