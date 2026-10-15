import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Lock, Plus } from 'lucide-react';
import type { DeviceProfile } from '@netfish/shared';
import { api } from '../api';
import { Mark, SwimmingFish } from './Logo';
import { Img, Spinner } from './ui';
import { t } from '../i18n';

/** Picked a profile in this app session (a new launch of the app asks again). */
export const PICKED = 'netfish.profilePicked';
export const markPicked = () => {
  try {
    sessionStorage.setItem(PICKED, '1');
  } catch {
    /* private window */
  }
};
export const wasPicked = () => {
  try {
    return sessionStorage.getItem(PICKED) === '1';
  } catch {
    return true;
  }
};

/** Each person gets their own colour when there's no picture. */
const COLOURS = ['#e5484d', '#2fbf8f', '#3e8bff', '#f5a524', '#a259ff', '#14b8c4', '#ff7a45', '#7ac74f'];
export const colourOf = (name: string) => COLOURS[[...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % COLOURS.length];

/** A coloured first letter, for profiles without a picture. */
export const Initial = ({ name }: { name: string }) => (
  <span className="avatar-initial" style={{ background: colourOf(name) }}>
    {name[0]?.toUpperCase()}
  </span>
);

export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: api.profiles, staleTime: 60_000 });

function PinPad({ profile, onBack, onDone }: { profile: DeviceProfile; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const go = useMutation({
    mutationFn: (code: string) => api.switchProfile(profile.userId, code),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(['me'], user);
      onDone();
    },
    onError: () => setPin(''),
  });
  // Digits add up even when pressed quickly; the fourth one tries the PIN.
  const press = (digit: string) => setPin((p) => (p.length >= 4 ? p : p + digit));
  useEffect(() => {
    if (pin.length === 4 && !go.isPending) go.mutate(pin);
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps
  // Typing works too (keyboards, and remotes with number keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pinpad">
      <Img src={profile.avatar} className="pinpad__avatar" fallback={<Initial name={profile.name} />} />
      <h2>{t("Enter {name}'s PIN", { name: profile.name })}</h2>
      <div className={`pinpad__dots${go.isError ? ' is-wrong' : ''}`} aria-label={t('{n} of 4 digits', { n: pin.length })}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'is-on' : ''} />
        ))}
      </div>
      <p className="pinpad__error" role="alert">
        {go.isError ? (go.error as Error).message : go.isPending ? <Spinner size={16} /> : ' '}
      </p>
      <div className="pinpad__keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d, i) => (
          <button key={d} type="button" className="pinpad__key" onClick={() => press(d)} autoFocus={i === 0}>
            {d}
          </button>
        ))}
        <button type="button" className="pinpad__key pinpad__key--text" onClick={onBack}>
          {t('Back')}
        </button>
        <button type="button" className="pinpad__key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pinpad__key" onClick={() => setPin((p) => p.slice(0, -1))} aria-label={t('Delete a digit')}>
          <Delete size={22} />
        </button>
      </div>
    </div>
  );
}

/**
 * "Who's watching?": the people signed in on this device. Shown when Netfish opens on
 * a device with two or more of them, when it's signed out but knows profiles, and from
 * the profile menu.
 */
export function ProfilePicker({ onAdd, onPicked }: { onAdd: () => void; onPicked: () => void }) {
  const qc = useQueryClient();
  const q = useProfiles();
  const [locked, setLocked] = useState<DeviceProfile>();
  const pick = useMutation({
    mutationFn: (p: DeviceProfile) => api.switchProfile(p.userId),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(['me'], user);
      markPicked();
      onPicked();
    },
    onError: () => void q.refetch(),
  });
  const done = () => {
    markPicked();
    onPicked();
  };

  if (!q.data) return <div className="profiles"><SwimmingFish /></div>;
  if (locked) return <div className="profiles"><PinPad profile={locked} onBack={() => setLocked(undefined)} onDone={done} /></div>;

  return (
    <div className="profiles">
      <Mark size={40} />
      <h1>{t("Who's watching?")}</h1>
      <div className="profiles__grid">
        {q.data.profiles.map((p, i) => (
          <button
            key={p.userId}
            type="button"
            className={`profile-tile${p.current ? ' is-current' : ''}`}
            disabled={pick.isPending}
            autoFocus={i === 0}
            onClick={() => (p.locked && !p.current ? setLocked(p) : p.current ? done() : pick.mutate(p))}
          >
            <Img
              src={p.avatar}
              className="profile-tile__avatar"
              fallback={<Initial name={p.name} />}
            />
            <span className="profile-tile__name">
              {p.name} {p.locked && <Lock size={14} aria-label={t('Locked with a PIN')} />}
            </span>
          </button>
        ))}
        <button type="button" className="profile-tile profile-tile--add" onClick={onAdd}>
          <span className="profile-tile__avatar">
            <Plus size={40} />
          </span>
          <span className="profile-tile__name">{t('Add profile')}</span>
        </button>
      </div>
      {pick.isError && <p className="pinpad__error">{(pick.error as Error).message}</p>}
    </div>
  );
}
