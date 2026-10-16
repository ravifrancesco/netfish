import { Link } from 'react-router';
import { RadioTower } from 'lucide-react';
import { onNow, programEnd, programTitle, useChannels, useServerNow } from '../lib/channels';
import { Img, Progress } from './ui';
import { t, tn } from '../i18n';
import { NewBadge } from './NewBadge';

/** Home: what's on each channel right now, as a row like the others (Channels on). */
export function ChannelsRow() {
  const q = useChannels();
  const now = useServerNow(30_000);
  const channels = q.data?.channels ?? [];
  if (!channels.length) return null;
  return (
    <section className="row row--wide row--channels">
      <div className="row__head">
        <h2 className="row__title">
          <Link to="/channels" className="row__title-link">
            <RadioTower size={20} aria-hidden="true" /> {t('On now')}
          </Link>
        </h2>
      </div>
      <div className="row__viewport">
        <div className="row__track">
          {channels.map((channel) => {
            const on = onNow(channel, now);
            const p = on.program ?? on.next;
            const left = on.program ? Math.max(0, Math.ceil((programEnd(on.program) - now) / 60_000)) : 0;
            return (
              <div key={channel.id} className="wide channel-card">
                <Link to={`/channels/${channel.number}`} className="wide__frame" aria-label={t('Channel {n}: {name}', { n: channel.number, name: channel.name })}>
                  <Img src={p?.image} className="wide__img" fallback={<span className="card__fallback">{channel.name}</span>} />
                  <span className="channel-card__bug">
                    <span className="channel__num">{channel.number}</span> {channel.name}
                  </span>
                  {on.program && <Progress value={(now - on.program.start) / (on.program.seconds * 1000)} className="wide__bar" />}
                </Link>
                <div className="wide__meta">
                  <div className="wide__text">
                    <span className="wide__title">
                      {p ? programTitle(p) : channel.name}
                      {p?.isNew && <> <NewBadge /></>}
                    </span>
                    <span className="wide__subtitle">{on.program ? tn(left, '{n} min left', '{n} min left') : t('Starting soon')}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
