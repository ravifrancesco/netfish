import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Mark, Wordmark } from '../components/Logo';
import { Spinner, StorageWarning } from '../components/ui';
import { useConfig } from '../lib/hooks';

/** First run: Netfish needs Jellyfin before anyone can sign in. Everything else is set up later in Settings. */
export default function Setup({ change, onDone }: { change?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const connect = useMutation({
    mutationFn: () => api.setupJellyfin(url, change ? code : undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config'] });
      onDone?.();
    },
  });

  return (
    <div className="login">
      <div className="login__waves" aria-hidden="true" />
      <form
        className="login__card"
        onSubmit={(e) => {
          e.preventDefault();
          connect.mutate();
        }}
      >
        <div className="login__brand">
          <Mark size={44} />
          <Wordmark className="wordmark--lg" />
        </div>
        <h1 className="setup__title">{change ? 'Change the Jellyfin address' : "Welcome! Where's your Jellyfin?"}</h1>
        <p className="muted">
          {change
            ? 'Use this if Netfish is pointing at the wrong address and nobody can sign in.'
            : "Everyone signs in to Netfish with their Jellyfin account. You'll connect Seerr, Radarr, Sonarr and the rest after signing in, under Settings → Connections."}
        </p>
        <StorageWarning problem={config?.storageProblem} />
        <label className="field">
          <span>Jellyfin address</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.50:8096" autoFocus spellCheck={false} autoComplete="url" />
        </label>
        <small className="muted">Netfish running in Docker on the same Pi? Try http://host.docker.internal:8096</small>
        {change && (
          <label className="field">
            <span>Setup code</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="From Netfish's log in Portainer" autoComplete="off" spellCheck={false} />
          </label>
        )}
        {connect.isError && <p className="login__error">{(connect.error as Error).message}</p>}
        <button className="btn btn--accent btn--lg btn--block" disabled={connect.isPending || !url.trim() || (change && !code.trim())}>
          {connect.isPending ? <Spinner size={20} /> : 'Connect'}
        </button>
        {change && (
          <button type="button" className="link-btn setup__back" onClick={onDone}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
