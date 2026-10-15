import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { desktop, type UpdateStatus } from '../lib/desktop';
import { percent } from '../lib/format';
import { Progress, Spinner } from './ui';
import { t } from '../i18n';

const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/** Settings, in the Mac and Windows apps: is there a newer version, and install it from here. */
export function AppUpdate() {
  const update = desktop()?.update;
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [restarting, setRestarting] = useState(false);
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
      setRestarting(true);
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
        <label className="check">
          <input type="checkbox" checked={Boolean(status.auto)} onChange={(e) => void setAuto(e.target.checked)} />
          <span>
            {t('Update Netfish by itself')}
            <span className="muted small"> · {t('New versions download in the background and install when you quit Netfish.')}</span>
          </span>
        </label>
      )}
      {status?.auto && status.autoProblem && <p className="muted small">{t("Couldn't update by itself: {problem}", { problem: status.autoProblem })}</p>}
    </div>
  );
}

const CHECKED = 'netfish.updateCheck';
const DISMISSED = 'netfish.updateDismissed';
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

/** Home, in the Mac and Windows apps: a quiet note when a newer version is out (checked every few hours). */
export function UpdateNudge() {
  const app = desktop();
  const [latest, setLatest] = useState<string>();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!app?.update) return;
    const last = JSON.parse(read(CHECKED) ?? 'null') as { at: number; latest?: string } | null;
    if (last && Date.now() - last.at < 6 * 3600_000) return setLatest(last.latest);
    app.update
      .check()
      .then((s) => {
        // Updating by itself: nothing to ask.
        const latest = s.available && !s.auto ? s.latest : undefined;
        write(CHECKED, JSON.stringify({ at: Date.now(), latest }));
        setLatest(latest);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app?.update || !latest || hidden || read(DISMISSED) === latest || !newer(latest, app.version)) return null;
  return (
    <div className="nudge">
      <Download size={18} />
      <span>{t('Netfish {version} is available for this computer.', { version: latest })}</span>
      <Link to="/settings#app" className="btn btn--accent btn--sm">
        {t('Update')}
      </Link>
      <button
        className="icon-btn icon-btn--sm"
        aria-label={t('Hide')}
        onClick={() => {
          write(DISMISSED, latest);
          setHidden(true);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
