import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { locale, t } from '../i18n';

/** How long each picture stays (it fades into the next). */
const EACH = 12_000;

const clockNow = () => new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/**
 * The screensaver (Android TV's, through the app): the library's backdrops one after another,
 * slowly drifting, with the title, the time, and what's on Netfish's channel. Nothing to press:
 * any key ends it.
 */
export default function Screensaver() {
  const q = useQuery({ queryKey: ['screensaver'], queryFn: api.screensaver, refetchInterval: 10 * 60_000 });
  const items = q.data?.items ?? [];
  const [n, setN] = useState(0);
  const [clock, setClock] = useState(clockNow);
  useEffect(() => {
    const timer = setInterval(() => {
      setN((x) => x + 1);
      setClock(clockNow());
    }, EACH);
    return () => clearInterval(timer);
  }, []);
  // The next one loaded ahead, so it fades in whole.
  const next = items.length ? items[(n + 1) % items.length] : undefined;
  useEffect(() => {
    if (next) new Image().src = next.backdrop;
  }, [next]);

  const item = items.length ? items[n % items.length] : undefined;
  const before = items.length > 1 ? items[(n - 1 + items.length) % items.length] : undefined;
  const onNow = q.data?.onNow && q.data.onNow.until > Date.now() ? q.data.onNow : undefined;
  return (
    <div className="saver">
      {before && n > 0 && <div className={`saver__picture saver__picture--${(n - 1) % 2 ? 'left' : 'right'} is-before`} style={{ backgroundImage: `url(${before.backdrop})` }} />}
      {item && <div key={n} className={`saver__picture saver__picture--${n % 2 ? 'left' : 'right'}`} style={{ backgroundImage: `url(${item.backdrop})` }} />}
      <div className="saver__shade" />
      {item && (
        <div key={`t${n}`} className="saver__title">
          {item.logo ? <img src={item.logo} alt={item.title} /> : <strong>{item.title}</strong>}
          {item.year && <span>{item.year}</span>}
        </div>
      )}
      <div className="saver__corner">
        <span className="saver__clock">{clock}</span>
        {onNow && (
          <span className="saver__now">
            {t('Now on {channel}', { channel: onNow.channel })} · <strong>{onNow.title}</strong>
          </span>
        )}
        <Logo size={22} />
      </div>
    </div>
  );
}
