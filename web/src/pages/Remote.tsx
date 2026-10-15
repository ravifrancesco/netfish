import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Cast, MonitorSmartphone, Pause, Play, RotateCcw, RotateCw, Square } from 'lucide-react';
import { api } from '../api';
import { Img } from '../components/ui';
import { SwimmingFish } from '../components/Logo';
import { rememberRemote } from '../components/PlayOn';
import { setCastTarget } from '../lib/screens';
import { clock } from '../lib/format';
import { useTick, useTogether } from '../lib/together';
import { t } from '../i18n';

/**
 * Play on TV, from the phone: the film playing on the other screen, and its controls.
 * Everything goes through the room the TV is playing in, so the TV follows at once.
 */
export default function Remote() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const together = useTogether(id, { controller: true });
  const room = together.room;
  const [scrub, setScrub] = useState<number>();
  useTick(500);

  useEffect(() => {
    if (together.ended) rememberRemote(undefined);
  }, [together.ended]);

  const screen = room?.screenName ?? t('the TV');
  if (together.ended) {
    return (
      <div className="page container remote remote--ended">
        <Cast size={36} />
        <p>{t('Stopped on {screen}.', { screen })}</p>
        <Link to="/" className="btn btn--ghost">
          {t('Home')}
        </Link>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="page container remote remote--ended">
        <SwimmingFish />
      </div>
    );
  }

  const player = room.members.find((m) => !m.controller && m.here);
  const tracks = player?.tracks;
  const playing = room.playback.playing;
  const duration = room.durationSeconds ?? 0;
  const position = Math.min(scrub ?? together.expected() ?? 0, duration || Infinity);
  const status = !player
    ? t('Opening on {screen}…', { screen })
    : player.waiting
      ? t('Loading on {screen}…', { screen })
      : playing
        ? t('Playing on {screen}', { screen })
        : t('Paused on {screen}', { screen });
  const seek = (to: number) => together.send('seek', Math.max(0, Math.min(to, duration ? duration - 1 : to)));
  const command = (action: 'audio' | 'subtitle', index: number | null) =>
    player && void api.roomCommand(room.id, { clientId: together.clientId, to: player.clientId, action, index }).catch(() => {});
  const stop = async () => {
    await api.endRoom(room.id).catch(() => {});
    rememberRemote(undefined);
  };

  return (
    <div className="page container remote">
      <div className="remote__art">
        <Img src={room.image} className="remote__img" fallback={<Cast size={40} />} />
      </div>
      <div className="remote__title">
        <h1>{room.title}</h1>
        {room.subtitle && <p className="muted">{room.subtitle}</p>}
        <p className="remote__status">
          <Cast size={16} /> {status}
        </p>
      </div>

      <div className="remote__seek">
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={1}
          value={Math.round(position)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => scrub !== undefined && (seek(scrub), setScrub(undefined))}
          onKeyUp={() => scrub !== undefined && (seek(scrub), setScrub(undefined))}
          aria-label={t('Seek')}
          disabled={!duration}
        />
        <div className="remote__times muted small">
          <span>{clock(position)}</span>
          <span>{duration ? clock(duration) : ''}</span>
        </div>
      </div>

      <div className="remote__controls">
        <button className="icon-btn icon-btn--lg" onClick={() => seek((together.expected() ?? 0) - 10)} aria-label={t('Back 10 seconds')}>
          <RotateCcw size={28} />
        </button>
        <button className="remote__play" onClick={() => together.send(playing ? 'pause' : 'play', together.expected())} aria-label={playing ? t('Pause') : t('Play')}>
          {playing ? <Pause size={36} fill="currentColor" /> : <Play size={36} fill="currentColor" />}
        </button>
        <button className="icon-btn icon-btn--lg" onClick={() => seek((together.expected() ?? 0) + 10)} aria-label={t('Forward 10 seconds')}>
          <RotateCw size={28} />
        </button>
      </div>

      {tracks && (tracks.audio.length > 1 || tracks.subtitles.length > 0) && (
        <div className="remote__tracks">
          {tracks.audio.length > 1 && (
            <label className="field">
              <span>{t('Audio')}</span>
              <select value={tracks.audioIndex ?? ''} onChange={(e) => command('audio', Number(e.target.value))}>
                {tracks.audio.map((track) => (
                  <option key={track.index} value={track.index}>
                    {track.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tracks.subtitles.length > 0 && (
            <label className="field">
              <span>{t('Subtitles')}</span>
              <select value={tracks.subtitleIndex ?? 'off'} onChange={(e) => command('subtitle', e.target.value === 'off' ? null : Number(e.target.value))}>
                <option value="off">{t('Off')}</option>
                {tracks.subtitles.map((track) => (
                  <option key={track.index} value={track.index}>
                    {track.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="remote__actions">
        <button className="btn btn--ghost" onClick={() => void stop()}>
          <Square size={16} fill="currentColor" /> {t('Stop')}
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => {
            const at = Math.floor(together.expected() ?? 0);
            void stop();
            setCastTarget(undefined); // playing here now, not on the TV
            navigate(`/watch/${room.playback.itemId}?t=${at}`, { replace: true });
          }}
        >
          <MonitorSmartphone size={18} /> {t('Watch here instead')}
        </button>
      </div>
    </div>
  );
}
