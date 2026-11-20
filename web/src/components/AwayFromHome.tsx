import { useEffect, useRef, useState } from 'react';
import { FileCheck, FileUp, TriangleAlert } from 'lucide-react';
import { desktop, type TunnelStatus } from '../lib/desktop';
import { Spinner, useToast } from './ui';
import { t } from '../i18n';

/** What a WireGuard configuration says, never its keys: where it connects, and what it reaches. */
function readConfig(text: string) {
  const value = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'im').exec(text)?.[1].trim();
  const reaches = (value('AllowedIPs') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { endpoint: value('Endpoint'), reaches, complete: /\[Interface\]/i.test(text) && /\[Peer\]/i.test(text) && Boolean(value('PrivateKey')) };
}

/** Whether these networks take in an IPv4 address; undefined when that can't be told (a name, IPv6). */
function covers(networks: string[], address: string): boolean | undefined {
  const toNumber = (ip: string) => {
    const parts = ip.split('.').map(Number);
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts.reduce((a, n) => a * 256 + n, 0) : undefined;
  };
  const ip = toNumber(address);
  if (ip === undefined) return undefined;
  return networks.some((network) => {
    const [base, bits = '32'] = network.split('/');
    const start = toNumber(base);
    const size = 2 ** (32 - Number(bits));
    return start !== undefined && Math.floor(ip / size) === Math.floor(start / size);
  });
}

/** Kept on this device at saving, to show again (the app never gives the configuration back). */
const SUMMARY = 'netfish.tunnel';
type Summary = { name?: string; endpoint?: string; reaches: string[] };
function summary(): Summary | undefined {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Settings → Away from home (the Android, Mac and Windows apps): WireGuard inside Netfish, so the
 * server can be reached from anywhere without a VPN on the whole device. A configuration chosen
 * (the .conf file) or pasted is checked here and by the app, then kept by the app: never shown again.
 */
export function AwayFromHome() {
  const tunnel = desktop()?.tunnel;
  const toast = useToast();
  const [status, setStatus] = useState<TunnelStatus>();
  const [editing, setEditing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [config, setConfig] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const refresh = () => void tunnel?.status().then(setStatus).catch(() => {});
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tunnel || !status) return null;

  const take = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 64_000) return setProblem(t('That isn’t a WireGuard file.'));
    setConfig(await file.text());
    setFileName(file.name);
    setProblem(undefined);
  };
  const reset = () => {
    setConfig('');
    setFileName(undefined);
    setProblem(undefined);
    setPasting(false);
  };
  const read = readConfig(config);
  const reachesServer = covers(read.reaches, location.hostname);
  const save = async () => {
    setBusy(true);
    const wrong = await tunnel.save(config).catch((e: Error) => e.message);
    setBusy(false);
    if (wrong) return setProblem(wrong);
    try {
      localStorage.setItem(SUMMARY, JSON.stringify({ name: fileName, endpoint: read.endpoint, reaches: read.reaches } satisfies Summary));
    } catch {
      /* storage blocked */
    }
    reset();
    setEditing(false);
    toast('ok', t('Saved. Netfish uses it whenever the server doesn’t answer directly.'));
    setTimeout(refresh, 1500);
  };
  const remove = async () => {
    await tunnel.remove().catch(() => {});
    try {
      localStorage.removeItem(SUMMARY);
    } catch {
      /* storage blocked */
    }
    refresh();
  };
  const kept = summary();

  return (
    <section className="panel">
      <h2>{t('Away from home')}</h2>
      <p className="muted">
        {t('Netfish can reach your server through WireGuard when you’re out, just for itself: no VPN to switch on, and nothing else on this device goes through it. At home it goes straight to the server.')}
      </p>

      {status.configured && !editing ? (
        <div className="away-card">
          <span className={`away-card__dot${status.active ? ' is-on' : status.problem ? ' is-wrong' : ''}`} aria-hidden="true" />
          <span className="away-card__text">
            <strong>{status.active ? t('Connected through WireGuard') : status.problem ? t('Couldn’t connect') : t('Ready for when you’re out')}</strong>
            <span className="muted small">
              {status.problem && !status.active
                ? status.problem
                : kept?.endpoint
                  ? [kept.endpoint, kept.reaches.join(', ')].filter(Boolean).join(' · ')
                  : t('Used when the server doesn’t answer directly.')}
            </span>
          </span>
          <span className="row-gap">
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
              {t('Replace')}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => void remove()}>
              {t('Remove')}
            </button>
          </span>
        </div>
      ) : config && !pasting ? (
        // Chosen: what it says, before keeping it.
        <div className="away-card away-card--check">
          <FileCheck size={22} className="away-card__icon" aria-hidden="true" />
          <span className="away-card__text">
            <strong>{fileName ?? t('WireGuard configuration')}</strong>
            <dl className="away-facts">
              <dt>{t('Connects to')}</dt>
              <dd>{read.endpoint ?? '—'}</dd>
              <dt>{t('Reaches')}</dt>
              <dd>{read.reaches.join(', ') || '—'}</dd>
            </dl>
            {!read.complete && (
              <span className="away-warn">
                <TriangleAlert size={15} aria-hidden="true" /> {t('That isn’t a WireGuard file.')}
              </span>
            )}
            {read.complete && reachesServer === false && (
              <span className="away-warn">
                <TriangleAlert size={15} aria-hidden="true" /> {t('Your server ({server}) isn’t among what it reaches, so Netfish couldn’t use it away from home.', { server: location.hostname })}
              </span>
            )}
            {problem && <span className="error-text small">{t('That configuration doesn’t work: {reason}', { reason: problem })}</span>}
          </span>
          <span className="row-gap">
            <button className="btn btn--primary btn--sm" disabled={!read.complete || busy} onClick={() => void save()}>
              {busy ? <Spinner size={16} /> : null} {t('Save')}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={reset}>
              {t('Choose another')}
            </button>
          </span>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`away-drop${over ? ' is-over' : ''}`}
            onClick={() => picker.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void take(e.dataTransfer.files[0]);
            }}
          >
            <FileUp size={28} aria-hidden="true" />
            <strong>{t('Choose the WireGuard file')}</strong>
            <span className="muted small">{t('The .conf file your router or WireGuard server made for this device.')}</span>
          </button>
          <input ref={picker} type="file" accept=".conf,.txt,text/plain" hidden onChange={(e) => void take(e.target.files?.[0])} />
          {problem && <p className="error-text small">{problem}</p>}
          {pasting ? (
            <label className="field away-paste">
              <span>{t('WireGuard configuration')}</span>
              <textarea
                className="input tunnel-config"
                rows={9}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = …'}
              />
            </label>
          ) : null}
          <div className="row-gap away-actions">
            {pasting ? (
              <button className="btn btn--primary btn--sm" disabled={!readConfig(config).complete} onClick={() => setPasting(false)}>
                {t('Check it')}
              </button>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => setPasting(true)}>
                {t('Paste it instead')}
              </button>
            )}
            {(status.configured || pasting) && (
              <button className="btn btn--ghost btn--sm" onClick={() => (reset(), setEditing(false))}>
                {t('Cancel')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
