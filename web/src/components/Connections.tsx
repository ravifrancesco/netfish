import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, CircleCheck, CircleDashed, CircleX, ExternalLink, Eye, EyeOff } from 'lucide-react';
import type { ConnectionTest, ServiceConnection, ServiceConnectionUpdate, ServiceStatus, TraktStatus } from '@netfish/shared';
import { api } from '../api';
import { Spinner, useToast } from './ui';
import { ago } from '../lib/format';
import { t } from '../i18n';

const v = (version?: string) => (version ? `v${version.replace(/^v/i, '')}` : undefined);

function Secret({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="input-unit">
      <input className="input" type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} spellCheck={false} />
      <button type="button" className="icon-btn icon-btn--sm input-unit__btn" onClick={() => setShown((s) => !s)} aria-label={shown ? t('Hide the key') : t('Show the key')}>
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

function StatusIcon({ status }: { status?: ServiceStatus }) {
  if (!status || !status.configured) return <CircleDashed size={18} className="conn__dot conn__dot--off" />;
  return status.ok ? <CircleCheck size={18} className="conn__dot conn__dot--ok" /> : <CircleX size={18} className="conn__dot conn__dot--bad" />;
}

function ConnectionCard({ c, status }: { c: ServiceConnection; status?: ServiceStatus }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState(c.url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState(c.username ?? '');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<ConnectionTest>();

  const update = (): ServiceConnectionUpdate => ({
    ...(c.fixedUrl ? {} : { url }),
    ...(apiKey ? { apiKey } : {}),
    ...(c.usesLogin ? { username } : {}),
    ...((c.usesLogin || c.usesSecret) && password ? { password } : {}),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['connections'] });
    void qc.invalidateQueries({ queryKey: ['status'] });
    void qc.invalidateQueries({ queryKey: ['config'] });
  };

  const test = useMutation({ mutationFn: () => api.testConnection(c.id, update()), onSuccess: setResult });
  const save = useMutation({
    mutationFn: async () => {
      await api.saveConnection(c.id, update());
      return api.testConnection(c.id, {});
    },
    onSuccess: (r) => {
      setResult(r);
      setApiKey('');
      setPassword('');
      refresh();
      toast(r.ok ? 'ok' : 'error', r.ok ? t('{name} saved and connected.', { name: c.name }) : t('{name} saved, but: {error}', { name: c.name, error: r.error }));
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  const reset = useMutation({
    mutationFn: () => api.resetConnection(c.id),
    onSuccess: (next) => {
      setUrl(next.url ?? '');
      setUsername(next.username ?? '');
      setResult(undefined);
      refresh();
      toast('ok', t("{name} is back to the stack's settings.", { name: c.name }));
    },
  });
  const clearKey = useMutation({
    mutationFn: () => api.saveConnection(c.id, { apiKey: '', ...(c.usesSecret ? { password: '' } : {}) }),
    onSuccess: () => {
      refresh();
      setResult(undefined);
    },
  });

  const busy = test.isPending || save.isPending;
  const summary = !status?.configured ? t('Not connected') : status.ok ? [t('Connected'), v(status.version)].filter(Boolean).join(' · ') : status.error;

  return (
    <details className="conn" open={!status?.configured && c.required}>
      <summary className="conn__head">
        <StatusIcon status={status} />
        <div className="conn__title">
          <strong>
            {c.name}
            {c.required && <span className="muted small"> · {t('required')}</span>}
          </strong>
          <span className="muted small">{c.purpose}</span>
        </div>
        <span className={`conn__state${status?.configured && !status.ok ? ' is-bad' : ''}`}>{summary}</span>
        <ChevronDown size={18} className="conn__chev" />
      </summary>
      <form
        className="conn__body"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!c.fixedUrl && (
          <label className="field">
            <span>{t('Address')}</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={c.defaultUrl ?? 'http://192.168.1.50:1234'} spellCheck={false} autoComplete="off" />
          </label>
        )}
        {c.usesKey && (
          <label className="field">
            <span>{c.keyLabel ?? t('API key')}</span>
            <Secret
              value={apiKey}
              onChange={setApiKey}
              autoComplete="off"
              placeholder={c.hasKey ? t('Saved ({hint}). Type to replace', { hint: c.keyHint }) : c.keyLabel ? t('Paste the {label}', { label: c.keyLabel }) : t('Paste the API key')}
            />
          </label>
        )}
        {c.usesSecret && (
          <label className="field">
            <span>{c.secretLabel}</span>
            <Secret value={password} onChange={setPassword} autoComplete="off" placeholder={c.hasPassword ? t('Saved. Type to replace') : t('Paste the {label}', { label: c.secretLabel ?? '' })} />
          </label>
        )}
        {c.usesLogin && (
          <div className="field-row">
            <label className="field">
              <span>{t('Username')}</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>{t('Password')}</span>
              <Secret value={password} onChange={setPassword} autoComplete="new-password" placeholder={c.hasPassword ? t('Saved. Type to replace') : ''} />
            </label>
          </div>
        )}
        {c.keyHelp && <small className="muted">{c.keyHelp}</small>}
        {result && (
          <p className={`conn__result${result.ok ? ' is-ok' : ' is-bad'}`}>
            {result.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
            {result.ok ? [t('Connected'), v(result.version), result.detail].filter(Boolean).join(' · ') : result.error}
          </p>
        )}
        <div className="conn__actions">
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner size={14} /> : null} {t('Test')}
          </button>
          <button className="btn btn--accent btn--sm" disabled={busy}>
            {save.isPending ? <Spinner size={14} /> : null} {t('Save')}
          </button>
          <span className="spacer" />
          {c.hasKey && !c.required && (
            <button type="button" className="link-btn" onClick={() => clearKey.mutate()}>
              {t('Remove key')}
            </button>
          )}
          {c.source === 'app' && (
            <button type="button" className="link-btn" onClick={() => reset.mutate()} title={t("Forget what was saved here and use the Portainer stack's variables")}>
              {t('Use stack settings')}
            </button>
          )}
          <span className={`badge badge--dim`}>{c.source === 'app' ? t('Saved in Netfish') : c.source === 'stack' ? t('From the stack') : t('Not set')}</span>
        </div>
      </form>
      {c.id === 'trakt' && c.hasKey && c.hasPassword && <TraktAccount />}
    </details>
  );
}

/**
 * The one Trakt account the whole server uses: linked with a code typed at
 * trakt.tv/activate, then fed what everyone watches.
 */
function TraktAccount() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['trakt'],
    queryFn: api.trakt,
    refetchInterval: (query) => (query.state.data?.pending || query.state.data?.import?.running ? 2000 : false),
  });
  const s = q.data;
  const set = (data: TraktStatus) => qc.setQueryData(['trakt'], data);
  const onError = (err: unknown) => toast('error', (err as Error).message);
  const link = useMutation({ mutationFn: api.traktLink, onSuccess: set, onError });
  const unlink = useMutation({ mutationFn: api.traktUnlink, onSuccess: set, onError });
  const scrobble = useMutation({ mutationFn: api.traktScrobble, onSuccess: set, onError });
  const importHistory = useMutation({ mutationFn: api.traktImport, onSuccess: set, onError });

  // Trakt's rows appear on Home (or go) as the account is linked (or unlinked).
  const wasLinked = useRef(s?.linked);
  useEffect(() => {
    if (s && wasLinked.current !== undefined && wasLinked.current !== s.linked) {
      void qc.invalidateQueries({ queryKey: ['home'] });
      if (s.linked) toast('ok', t('Trakt is linked to {name}.', { name: s.username ?? 'Trakt' }));
    }
    wasLinked.current = s?.linked;
  }, [s?.linked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <div className="trakt">{q.isError ? <p className="conn__result is-bad">{(q.error as Error).message}</p> : <Spinner />}</div>;

  if (!s.linked) {
    return (
      <div className="trakt">
        <strong>{t('Trakt account')}</strong>
        {s.pending ? (
          <>
            <p className="muted small">{t('On any phone or computer, open trakt.tv/activate, sign in to the account Netfish should use, and enter this code:')}</p>
            <div className="trakt__code">
              <code>{s.pending.userCode}</code>
              <a className="btn btn--ghost btn--sm" href={s.pending.verificationUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> trakt.tv/activate
              </a>
            </div>
            <p className="muted small trakt__wait">
              <Spinner size={14} /> {t('Waiting for Trakt…')}
            </p>
          </>
        ) : (
          <p className="muted small">
            {t("Link one Trakt account for the whole server: what anyone watches is added to it, and its recommendations appear on everyone's Home.")}
          </p>
        )}
        {s.linkError && !s.pending && <p className="conn__result is-bad">{s.linkError}</p>}
        <div className="conn__actions">
          <button type="button" className={`btn btn--sm ${s.pending ? 'btn--ghost' : 'btn--accent'}`} disabled={link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? <Spinner size={14} /> : null} {s.pending ? t('New code') : t('Link Trakt account')}
          </button>
        </div>
      </div>
    );
  }

  const done = s.import && !s.import.running ? s.import : undefined;
  return (
    <div className="trakt">
      <p className="conn__result is-ok">
        <CircleCheck size={16} /> {t('Linked to {name}', { name: s.username ?? 'Trakt' })}
      </p>
      <label className="check">
        <input type="checkbox" checked={s.scrobble} disabled={scrobble.isPending} onChange={(e) => scrobble.mutate(e.target.checked)} />
        <span>{t('Add what everyone watches to Trakt')}</span>
      </label>
      {s.lastScrobble && <small className="muted">{t('Last sent: {title}, {when}', { title: s.lastScrobble.title, when: ago(s.lastScrobble.at) })}</small>}
      <div className="trakt__import">
        <div>
          <strong className="small">{t('Watch history')}</strong>
          <p className="muted small">
            {t("Adds everything already watched in Jellyfin, by everyone, so recommendations start from the whole history. Titles Trakt already has are skipped.")}
          </p>
          {s.import?.running && (
            <p className="muted small trakt__wait">
              <Spinner size={14} /> {t('Importing…')}
            </p>
          )}
          {done?.error && <p className="conn__result is-bad">{done.error}</p>}
          {done && !done.error && (
            <small className="muted">
              {[
                t('Added {n}', { n: done.added ?? 0 }),
                t('{n} already there', { n: done.alreadyThere ?? 0 }),
                done.notFound ? t("{n} Trakt didn't know", { n: done.notFound }) : undefined,
                done.at ? ago(done.at) : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={s.import?.running || importHistory.isPending} onClick={() => importHistory.mutate()}>
          {t('Import')}
        </button>
      </div>
      <div className="conn__actions">
        <span className="spacer" />
        <button type="button" className="link-btn" disabled={unlink.isPending} onClick={() => confirm(t('Unlink {name}? Trakt keeps its history.', { name: s.username ?? 'Trakt' })) && unlink.mutate()}>
          {t('Unlink')}
        </button>
      </div>
    </div>
  );
}

/** Admin: addresses and API keys of every service Netfish talks to. */
export function Connections() {
  const list = useQuery({ queryKey: ['connections'], queryFn: api.connections });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 30_000 });
  if (!list.data) return <Spinner />;
  return (
    <div className="conns">
      {list.data.items.map((c) => (
        <ConnectionCard key={`${c.id}-${c.source}-${c.url ?? ''}`} c={c} status={status.data?.items.find((s) => s.id === c.id)} />
      ))}
    </div>
  );
}
