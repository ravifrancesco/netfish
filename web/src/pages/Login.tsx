import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api';
import { Mark, Wordmark } from '../components/Logo';
import { Spinner } from '../components/ui';
import { useConfig } from '../lib/hooks';
import { deviceId, deviceName } from '../lib/prefs';
import Setup from './Setup';
import { markPicked } from '../components/ProfilePicker';
import { t } from '../i18n';

/** `adding`: another person signing in on this device ("Add profile"); `onCancel` goes back to the picker. */
export default function Login({ adding, onCancel, onDone }: { adding?: boolean; onCancel?: () => void; onDone?: () => void } = {}) {
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const login = useMutation({
    mutationFn: () => api.login({ username, password, deviceId: deviceId(), deviceName: deviceName() }),
    onSuccess: ({ user }) => {
      // A different person: nothing cached for the previous one carries over.
      qc.clear();
      qc.setQueryData(['me'], user);
      markPicked();
      onDone?.();
    },
  });

  if (changing) return <Setup change onDone={() => setChanging(false)} />;
  // Jellyfin missing or down (502/503 from the server): the message itself may be in Italian.
  const unreachable =
    login.error &&
    ((login.error instanceof ApiError && login.error.service === 'Jellyfin' && login.error.status >= 502) ||
      /unreachable|isn't connected|not connected/i.test((login.error as Error).message));

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
        <p className="muted">{adding ? t('Add a profile: sign in with another Jellyfin account.') : t('Sign in with your Jellyfin account.')}</p>
        {config && !config.jellyfinConfigured && (
          <p className="login__error">{t("This server isn't connected to Jellyfin yet. Set {variable} in the stack.", { variable: 'JELLYFIN_URL' })}</p>
        )}
        <label className="field">
          <span>{t('Username')}</span>
          <input className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span>{t('Password')}</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {login.isError && <p className="login__error">{(login.error as Error).message}</p>}
        {unreachable && (
          <button type="button" className="link-btn" onClick={() => setChanging(true)}>
            {t('Change the Jellyfin address…')}
          </button>
        )}
        <button className="btn btn--accent btn--lg btn--block" disabled={login.isPending || !username}>
          {login.isPending ? <Spinner size={20} /> : t('Sign in')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>
            {t("Back to who's watching")}
          </button>
        )}
      </form>
    </div>
  );
}
