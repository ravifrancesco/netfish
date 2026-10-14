import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Mark, Wordmark } from '../components/Logo';
import { Spinner } from '../components/ui';
import { useConfig } from '../lib/hooks';
import { deviceId, deviceName } from '../lib/prefs';
import Setup from './Setup';

export default function Login() {
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const login = useMutation({
    mutationFn: () => api.login({ username, password, deviceId: deviceId(), deviceName: deviceName() }),
    onSuccess: ({ user }) => {
      qc.setQueryData(['me'], user);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });

  if (changing) return <Setup change onDone={() => setChanging(false)} />;
  const unreachable = login.error && /unreachable|isn't connected|not connected/i.test((login.error as Error).message);

  return (
    <div className="login">
      <div className="login__waves" aria-hidden="true" />
      <form
        className="login__card"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="login__brand">
          <Mark size={44} />
          <Wordmark className="wordmark--lg" />
        </div>
        <p className="muted">Sign in with your Jellyfin account.</p>
        {config && !config.jellyfinConfigured && (
          <p className="login__error">This server isn't connected to Jellyfin yet. Set JELLYFIN_URL in the stack.</p>
        )}
        <label className="field">
          <span>Username</span>
          <input className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {login.isError && <p className="login__error">{(login.error as Error).message}</p>}
        {unreachable && (
          <button type="button" className="link-btn" onClick={() => setChanging(true)}>
            Change the Jellyfin address…
          </button>
        )}
        <button className="btn btn--accent btn--lg btn--block" disabled={login.isPending || !username}>
          {login.isPending ? <Spinner size={20} /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
