import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, CircleCheck, CircleDashed, CircleX, Eye, EyeOff } from 'lucide-react';
import type { ConnectionTest, ServiceConnection, ServiceConnectionUpdate, ServiceStatus } from '@netfish/shared';
import { api } from '../api';
import { Spinner, useToast } from './ui';

const v = (version?: string) => (version ? `v${version.replace(/^v/i, '')}` : undefined);

function Secret({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="input-unit">
      <input className="input" type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} spellCheck={false} />
      <button type="button" className="icon-btn icon-btn--sm input-unit__btn" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide' : 'Show'}>
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
    ...(c.usesLogin ? { username, ...(password ? { password } : {}) } : {}),
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
      toast(r.ok ? 'ok' : 'error', r.ok ? `${c.name} saved and connected.` : `${c.name} saved, but: ${r.error}`);
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
      toast('ok', `${c.name} is back to the stack's settings.`);
    },
  });
  const clearKey = useMutation({
    mutationFn: () => api.saveConnection(c.id, { apiKey: '' }),
    onSuccess: () => {
      refresh();
      setResult(undefined);
    },
  });

  const busy = test.isPending || save.isPending;
  const summary = !status?.configured ? 'Not connected' : status.ok ? ['Connected', v(status.version)].filter(Boolean).join(' · ') : status.error;

  return (
    <details className="conn" open={!status?.configured && c.required}>
      <summary className="conn__head">
        <StatusIcon status={status} />
        <div className="conn__title">
          <strong>
            {c.name}
            {c.required && <span className="muted small"> · required</span>}
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
            <span>Address</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={c.defaultUrl ?? 'http://192.168.1.50:1234'} spellCheck={false} autoComplete="off" />
          </label>
        )}
        {c.usesKey && (
          <label className="field">
            <span>API key</span>
            <Secret value={apiKey} onChange={setApiKey} autoComplete="off" placeholder={c.hasKey ? `Saved (${c.keyHint}). Type to replace` : 'Paste the API key'} />
          </label>
        )}
        {c.usesLogin && (
          <div className="field-row">
            <label className="field">
              <span>Username</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>Password</span>
              <Secret value={password} onChange={setPassword} autoComplete="new-password" placeholder={c.hasPassword ? 'Saved. Type to replace' : ''} />
            </label>
          </div>
        )}
        {c.keyHelp && <small className="muted">{c.keyHelp}</small>}
        {result && (
          <p className={`conn__result${result.ok ? ' is-ok' : ' is-bad'}`}>
            {result.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
            {result.ok ? ['Connected', v(result.version), result.detail].filter(Boolean).join(' · ') : result.error}
          </p>
        )}
        <div className="conn__actions">
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => test.mutate()}>
            {test.isPending ? <Spinner size={14} /> : null} Test
          </button>
          <button className="btn btn--accent btn--sm" disabled={busy}>
            {save.isPending ? <Spinner size={14} /> : null} Save
          </button>
          <span className="spacer" />
          {c.hasKey && !c.required && (
            <button type="button" className="link-btn" onClick={() => clearKey.mutate()}>
              Remove key
            </button>
          )}
          {c.source === 'app' && (
            <button type="button" className="link-btn" onClick={() => reset.mutate()} title="Forget what was saved here and use the Portainer stack's variables">
              Use stack settings
            </button>
          )}
          <span className={`badge badge--dim`}>{c.source === 'app' ? 'Saved in Netfish' : c.source === 'stack' ? 'From the stack' : 'Not set'}</span>
        </div>
      </form>
    </details>
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
