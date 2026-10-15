import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '../api';
import { Initial, useProfiles } from './ProfilePicker';
import { Img, Spinner, useToast } from './ui';
import { t } from '../i18n';

/** Settings: who's signed in on this device, your PIN here, and whether it asks who's watching. */
export function DeviceProfiles() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useProfiles();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const onError = (err: unknown) => toast('error', (err as Error).message);
  const update = useMutation({
    mutationFn: api.updateMyProfile,
    onSuccess: (data, patch) => {
      qc.setQueryData(['profiles'], data);
      setEditing(false);
      setPin('');
      if ('pin' in patch) toast('ok', patch.pin ? t('PIN saved.') : t('PIN removed.'));
    },
    onError,
  });
  const remove = useMutation({ mutationFn: api.removeProfile, onSuccess: () => void qc.invalidateQueries({ queryKey: ['profiles'] }), onError });

  if (!q.data) return <Spinner />;
  const mine = q.data.profiles.find((p) => p.current);
  return (
    <div className="stack">
      <ul className="device-profiles">
        {q.data.profiles.map((p) => (
          <li key={p.userId}>
            <Img
              src={p.avatar}
              className="device-profiles__avatar"
              fallback={<Initial name={p.name} />}
            />
            <span>
              {p.name}
              {p.current && <span className="muted"> · {t('you')}</span>}
            </span>
            {p.locked && <Lock size={14} className="muted" aria-label={t('Locked with a PIN')} />}
            <span className="spacer" />
            {/* A profile with a PIN can only be taken off by that person. */}
            {!p.current && !p.locked && (
              <button
                type="button"
                className="link-btn small"
                disabled={remove.isPending}
                onClick={() => confirm(t('Sign {name} out on this device?', { name: p.name })) && remove.mutate(p.userId)}
              >
                {t('Remove')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {mine &&
        (editing ? (
          <form
            className="pin-form"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ pin });
            }}
          >
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              aria-label={t('New PIN (4 digits)')}
              autoFocus
            />
            <button className="btn btn--accent btn--sm" disabled={pin.length !== 4 || update.isPending}>
              {t('Save PIN')}
            </button>
            <button type="button" className="link-btn" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </button>
          </form>
        ) : (
          <div className="account">
            <Lock size={20} />
            <div className="muted small">
              {mine.locked ? t('Your profile is locked with a PIN on this device.') : t('Lock your profile with a PIN, so nobody else here can switch to it.')}
            </div>
            <span className="spacer" />
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
              {mine.locked ? t('Change PIN') : t('Set a PIN')}
            </button>
            {mine.locked && (
              <button className="link-btn small" disabled={update.isPending} onClick={() => update.mutate({ pin: null })}>
                {t('Remove PIN')}
              </button>
            )}
          </div>
        ))}

      <label className="check">
        <input type="checkbox" checked={q.data.ask} disabled={update.isPending} onChange={(e) => update.mutate({ ask: e.target.checked })} />
        <span>{t("Ask who's watching when Netfish opens (with two or more profiles)")}</span>
      </label>
    </div>
  );
}
