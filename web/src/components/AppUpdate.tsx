import { useEffect, useState } from 'react';
import { CalendarClock, CloudDownload, Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { desktop, type UpdateStatus } from '../lib/desktop';
import { thisApp, updateNeed } from '../lib/appVersions';
import { percent } from '../lib/format';
import { Progress, Spinner, Switch } from './ui';
import { locale, t } from '../i18n';

/** Settings, in the Mac, Windows and Android apps: is there a newer version, and install it from here. */
export function AppUpdate() {
  const update = desktop()?.update;
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [restarting, setRestarting] = useState(false);
  // Android: the system is asking to confirm the install.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const check = async () => {
    if (!update) return;
    setChecking(true);
    setError(undefined);
    try {
      setStatus(await update.check());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async () => {
    if (!update) return;
    setError(undefined);
    // Already downloaded by itself: it only needs a restart.
    if (status?.ready === status?.latest) setRestarting(true);
    else setProgress(0);
    const stop = update.onProgress((p) => setProgress(p.total ? p.received / p.total : undefined));
    try {
      await update.install();
      if (update.asksToConfirm) {
        setProgress(undefined);
        setConfirming(true);
      } else setRestarting(true);
    } catch (err) {
      setError((err as Error).message);
      setProgress(undefined);
      setRestarting(false);
    } finally {
      stop();
    }
  };

  const setAuto = async (on: boolean) => {
    if (!update?.setAuto || !status) return;
    setStatus({ ...status, auto: on, ready: on ? status.ready : undefined, autoProblem: undefined });
    write(CHECKED, 'null'); // Home's note checks again
    try {
      await update.setAuto(on);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!update) return null;
  const busy = progress !== undefined || restarting;
  const line = restarting
    ? t('Restarting Netfish…')
    : confirming
      ? t('Confirm the update on screen.')
    : progress !== undefined
      ? t('Downloading the update… {percent}', { percent: percent(progress) })
      : checking
        ? t('Checking for updates…')
        : status?.available && status.ready === status.latest
          ? t('Netfish {version} is ready and installs when you quit Netfish.', { version: status.latest })
          : status?.available
            ? t('Netfish {version} is available', { version: status.latest })
            : status
            ? t('Netfish is up to date')
            : '';

  return (
    <div className="app-update">
      <div className="account">
        <RefreshCw size={20} />
        <div className="muted small">
          {line}
          {status?.available && status.page && !busy && (
            <>
              {' · '}
              <a href={status.page} target="_blank" rel="noreferrer" className="name-link">
                {t("What's new")}
              </a>
            </>
          )}
        </div>
        <span className="spacer" />
        {status?.available && status.canInstall ? (
          <button className="btn btn--accent btn--sm" disabled={busy} onClick={() => void install()}>
            {busy ? <Spinner size={14} /> : status.ready === status.latest ? <RefreshCw size={15} /> : <Download size={15} />}{' '}
            {status.ready === status.latest ? t('Restart now') : t('Update')}
          </button>
        ) : status?.available && status.page ? (
          <a className="btn btn--ghost btn--sm" href={status.page} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> {t('Download page')}
          </a>
        ) : (
          <button className="btn btn--ghost btn--sm" disabled={checking} onClick={() => void check()}>
            {t('Check again')}
          </button>
        )}
      </div>
      {progress !== undefined && <Progress value={progress} />}
      {error && <p className="conn__result is-bad">{error}</p>}
      {update.setAuto && status && (
        <div className="account" title={t('New versions download in the background and install when you quit Netfish.')}>
          <CloudDownload size={20} />
          <div className="muted small">{t('Auto-update')}</div>
          <span className="spacer" />
          <Switch on={Boolean(status.auto)} onChange={(on) => void setAuto(on)} label={t('Auto-update')} />
        </div>
      )}
      {status?.auto && status.autoProblem && <p className="muted small">{t('Auto-update failed: {problem}', { problem: status.autoProblem })}</p>}
    </div>
  );
}

const CHECKED = 'netfish.updateCheck';
const NOTE = 'netfish.updateNote';
const DAY = 86_400_000;
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: ask again next time */
  }
};
const noteHidden = (key: string) => {
  try {
    const note = JSON.parse(read(NOTE) ?? 'null') as { key: string; until: number } | null;
    return note?.key === key && note.until > Date.now();
  } catch {
    return false;
  }
};

/** iPhone and iPad installed from a Mac: when this install stops opening. */
export function useInstallExpiry() {
  const [date, setDate] = useState<Date>();
  useEffect(() => {
    void desktop()
      ?.installExpires?.()
      .then((iso) => iso && setDate(new Date(iso)))
      .catch(() => {});
  }, []);
  return date;
}

export const longDate = (date: Date) => date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

/** Settings, on an iPhone installed from a Mac: until when this install opens. */
export function InstallExpiry() {
  const date = useInstallExpiry();
  if (!date) return null;
  return <p className="muted small">{t('This install opens until {date}. To renew it, plug this device into the Mac it was installed from.', { date: longDate(date) })}</p>;
}

/** The Mac and Windows apps: is updating by itself on, and is a new version waiting (checked every few hours). */
function useDesktopUpdate(ask: boolean) {
  const update = desktop()?.update;
  const [status, setStatus] = useState<{ auto?: boolean; ready?: string; latest?: string }>();
  useEffect(() => {
    if (!ask || !update?.setAuto) return;
    const last = JSON.parse(read(CHECKED) ?? 'null') as { at: number; auto?: boolean; ready?: string; latest?: string } | null;
    if (last && Date.now() - last.at < 6 * 3600_000) return setStatus(last);
    update
      .check()
      .then((s) => {
        const next = { auto: s.auto, ready: s.ready, latest: s.latest };
        write(CHECKED, JSON.stringify({ at: Date.now(), ...next }));
        setStatus(next);
      })
      .catch(() => setStatus({}));
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  return update?.setAuto ? status : {};
}

/**
 * Home, in the apps: asks to update when this server says the app should (lib/appVersions:
 * only when the app itself gained something, never for changes that come from the server),
 * and on an iPhone installed from a Mac, a couple of days before the install stops opening.
 * Where the app can update itself (Mac, Windows, Android) the button does it right here.
 */
export function UpdateNudge() {
  const app = desktop();
  const which = thisApp();
  const need = updateNeed(which);
  const expires = useInstallExpiry();
  const desk = useDesktopUpdate(Boolean(need));
  const [, setHidden] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'restarting' | 'confirm'>('idle');
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();

  const expiring = expires && expires.getTime() - Date.now() < 3 * DAY ? expires : undefined;
  const key = expiring ? `expiry:${expiring.toISOString().slice(0, 10)}` : need ? `${need.level}:${need.version}` : undefined;
  if (!key || noteHidden(key)) return null;
  // Waiting for the Mac or Windows app to say whether it updates by itself.
  if (!expiring && desk === undefined) return null;
  // Updating by itself: nothing to ask, unless it's needed and only waits for a restart.
  if (!expiring && need?.level === 'recommended' && desk?.auto) return null;
  const update = app?.update;
  const waiting = Boolean(desk?.ready && desk.ready === desk.latest);

  const hide = () => {
    write(NOTE, JSON.stringify({ key, until: Date.now() + (expiring || need?.level === 'needed' ? DAY : 7 * DAY) }));
    setHidden((n) => n + 1);
  };
  const install = async () => {
    if (!update) return;
    setError(undefined);
    setPhase(waiting ? 'restarting' : 'downloading');
    setProgress(undefined);
    const stop = update.onProgress((p) => setProgress(p.total ? p.received / p.total : undefined));
    try {
      await update.install();
      setPhase(update.asksToConfirm ? 'confirm' : 'restarting');
    } catch (err) {
      setError((err as Error).message);
      setPhase('idle');
    } finally {
      stop();
    }
  };

  let text: string;
  if (expiring) {
    text = t('Netfish stops opening on this device on {date}. Plug it into the Mac it was installed from to renew it.', { date: longDate(expiring) });
  } else {
    const how =
      update || !which
        ? ''
        : which.name === 'ios'
          ? t('Update it the way you installed it: from your Mac, or in AltStore or SideStore.')
          : which.name === 'android'
            ? app?.platform === 'firetv'
              ? t('Download it again with the Downloader app, the same way you installed it.')
              : t('Download the new version from GitHub and install it, the same way you installed it.')
            : t('Reinstall it from your computer, the same way you installed it.');
    text = [need!.why, how].filter(Boolean).join(' ');
  }
  const status =
    error ??
    (phase === 'downloading'
      ? progress === undefined
        ? t('Downloading the update…')
        : t('Downloading the update… {percent}', { percent: percent(progress) })
      : phase === 'confirm'
        ? t('Confirm the update on screen.')
        : phase === 'restarting'
          ? t('Restarting Netfish…')
          : undefined);

  return (
    <div className={`nudge${need?.level === 'needed' || expiring ? ' nudge--warn' : ''}`} role="status">
      {expiring ? <CalendarClock size={18} /> : <Download size={18} />}
      <span className="nudge__text">
        {!expiring && <strong>{need!.level === 'needed' ? t('This app needs an update.') : t('An update for this app is worth installing.')} </strong>}
        {text}
        {status && <span className={`nudge__status${error ? ' is-bad' : ''}`}>{status}</span>}
      </span>
      {!expiring && update && (
        <button className="btn btn--accent btn--sm" disabled={phase === 'downloading' || phase === 'restarting'} onClick={() => void install()}>
          {phase === 'downloading' || phase === 'restarting' ? <Spinner size={14} /> : waiting ? <RefreshCw size={15} /> : <Download size={15} />}{' '}
          {waiting ? t('Restart now') : t('Update')}
        </button>
      )}
      <button className="icon-btn icon-btn--sm nudge__hide" aria-label={t('Hide')} onClick={hide}>
        <X size={16} />
      </button>
    </div>
  );
}
