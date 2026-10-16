import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Channel, ChannelProgram, PlaybackSession } from '@netfish/shared';
import { api } from '../api';
import { BODY, EYE, Fish, FishGradient, TAIL, useSvgId, Wordmark } from './Logo';
import { clockTime, episodeLine, programTitle } from '../lib/channels';
import { deviceId, getPrefs } from '../lib/prefs';
import { buildDeviceProfile } from '../player/profile';
import { t } from '../i18n';
import { isStandIn, NewBadge } from './NewBadge';

/**
 * The break between programmes on a channel, like TV's: a few seconds of Netfish (the fish
 * swimming through a net, bubbles rising, a little shoal), then a look at what's next, with
 * a countdown. Which scene follows from the programme, and it's timed from the server's
 * clock, so everyone on the channel sees the same moment, even tuning in halfway through.
 * `filler`: the programme ended early or couldn't play, so the sea waits for the next one.
 */

/**
 * A look at what's next: a muted moment from early in it, when this device plays the file
 * as it is (a preview never makes the server convert anything); its artwork otherwise.
 */
function Preview({ program, clip }: { program: ChannelProgram; clip: boolean }) {
  const [source, setSource] = useState<{ url: string; at: number }>();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!clip) return;
    let alive = true;
    let session: PlaybackSession | undefined;
    const end = (s: PlaybackSession) => void api.endPlayback(s.playSessionId, deviceId()).catch(() => {});
    // A little way in: past the opening titles, well before anything that matters.
    const at = Math.round(program.seconds * 0.12);
    api
      .playSession(program.itemId, { deviceProfile: buildDeviceProfile(getPrefs().maxBitrate), startSeconds: at })
      .then((s) => {
        session = s;
        if (!alive || s.method !== 'DirectPlay') return end(s);
        setSource({ url: s.url, at });
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (session) end(session);
    };
  }, [program.itemId, clip]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cbreak__preview">
      {program.image && <img src={program.image} alt="" style={playing ? { opacity: 0 } : undefined} />}
      {source && (
        <video
          src={source.url}
          muted
          autoPlay
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => (e.currentTarget.currentTime = source.at)}
          onPlaying={() => setPlaying(true)}
          onError={() => setSource(undefined)}
        />
      )}
    </div>
  );
}

export type BreakScene = 'net' | 'bubbles' | 'shoal';
const SCENES: BreakScene[] = ['net', 'bubbles', 'shoal'];
/** Which scene a break is: from the programme coming up, so it's the same on every screen, and varied. */
export function sceneFor(next?: ChannelProgram): BreakScene {
  let h = 7;
  for (const c of `${next?.itemId ?? ''}:${next?.start ?? 0}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return SCENES[Math.abs(h) % SCENES.length];
}

/** Diagonal net lines across the scene, both ways. */
const NET: Array<[number, number, number, number]> = [];
for (let a = -60; a <= 160; a += 12) {
  NET.push([a, -4, a + 94, 94]);
  NET.push([a + 94, -4, a, 94]);
}
/** Bubbles: where they rise (x), how big, how long, when. */
const BUBBLES = Array.from({ length: 22 }, (_, i) => ({ x: (i * 37) % 160, r: 0.8 + ((i * 7) % 5) * 0.45, dur: 4 + ((i * 3) % 5), delay: -((i * 1.3) % 6) }));
/** The shoal, around its leader. */
const SHOAL = [
  [0, 0, 1],
  [-14, -9, 0.6],
  [-14, 9, 0.6],
  [-27, -17, 0.45],
  [-27, 0, 0.5],
  [-27, 17, 0.45],
  [-39, -8, 0.4],
  [-39, 9, 0.4],
] as const;

export function ChannelBreak({ channel, next, breakStart, now, scene, filler, failed, gap }: {
  channel: Pick<Channel, 'number' | 'name'>;
  next?: ChannelProgram;
  /** When the break began (ms, server clock). */
  breakStart: number;
  now: number;
  scene: BreakScene;
  filler?: boolean;
  /** The programme couldn't play here. */
  failed?: boolean;
  /** A wait in the schedule (until the 9pm film): "Coming up at 21:00". */
  gap?: boolean;
}) {
  const id = useSvgId('cb');
  // Into the break already when this screen tuned in: the animation picks up from there.
  const elapsed = useMemo(() => Math.max(0, (now - breakStart) / 1000), [breakStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = { '--elapsed': `${-elapsed}s` } as CSSProperties;
  const inSeconds = next ? Math.max(0, Math.ceil((next.start - now) / 1000)) : undefined;
  const sub = next && episodeLine(next);
  const meta = next && [next.year, next.rating].filter(Boolean).join(' · ');

  return (
    <div className={`cbreak cbreak--${filler ? 'filler' : scene}`} style={style} aria-live="polite">
      <div className="cbreak__sea" />
      <svg className="cbreak__art" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <FishGradient id={id} />
        </defs>
        {(scene === 'net' && !filler) && (
          <g className="cbreak__net">
            {NET.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} style={{ '--i': i } as CSSProperties} />
            ))}
          </g>
        )}
        {/* Bubbles drift up in every break; in the bubbles one they're the show. */}
        <g className={`cbreak__bubbles${scene === 'bubbles' || filler ? ' is-many' : ''}`}>
          {BUBBLES.map((b, i) => (
            <circle key={i} cx={b.x} cy={96} r={b.r} style={{ '--dur': `${b.dur}s`, '--d': `${b.delay}s` } as CSSProperties} />
          ))}
        </g>
        {scene === 'shoal' && !filler ? (
          <g className="cbreak__shoal">
            {SHOAL.map(([dx, dy, size], i) => (
              <g key={i} transform={`translate(${dx} ${dy})`}>
                <g className="cbreak__swimmer" style={{ '--d': `${-i * 0.37}s` } as CSSProperties}>
                  <g transform={`scale(${size * 0.32}) translate(-32 -32)`}>
                    {i === 0 ? (
                      <Fish gradient={id} />
                    ) : (
                      <g fill="#36e2c6" stroke="#36e2c6" strokeLinejoin="round" opacity={0.75}>
                        <path d={TAIL} strokeWidth={4} />
                        <path d={BODY} strokeWidth={6} />
                      </g>
                    )}
                  </g>
                </g>
              </g>
            ))}
          </g>
        ) : (
          <g className="cbreak__fish">
            <g transform="scale(0.42) translate(-32 -32)">
              <path className="cbreak__tail" d={TAIL} fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth={4} strokeLinejoin="round" />
              <path d={BODY} fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth={6} strokeLinejoin="round" />
              <circle {...EYE} fill="#03140f" />
            </g>
          </g>
        )}
      </svg>

      {!filler && (
        <div className="cbreak__ident" aria-hidden="true">
          <Wordmark />
          <span>
            <span className="channel__num">{channel.number}</span> {channel.name}
          </span>
        </div>
      )}

      <div className="cbreak__card">
        {next && <Preview program={next} clip={!filler && !isStandIn(next.itemId)} />}
        <div className="cbreak__text">
          <span className="cbreak__label">
            {failed
              ? t("This programme can't play here")
              : gap
                ? t('Coming up at {time}', { time: clockTime(next?.start ?? now) })
                : filler
                ? t('Back at {time}', { time: clockTime(next?.start ?? now) })
                : t('Up next on {channel}', { channel: `${channel.number} · ${channel.name}` })}
          </span>
          {next ? (
            <>
              <strong className="cbreak__title">
                {programTitle(next)}
                {next.isNew && <> <NewBadge /></>}
              </strong>
              {(sub || meta) && <span className="cbreak__meta">{sub ?? meta}</span>}
              {!filler && inSeconds !== undefined && inSeconds <= 10 && <span className="cbreak__in">{t('in {n}', { n: inSeconds })}</span>}
            </>
          ) : (
            <strong className="cbreak__title">{t('More soon')}</strong>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Switching channels, and until the picture arrives: static, as on an old TV (tinted like the
 * sea). It lasts as long as it's shown; `onDone` says the shortest flash of it is over.
 */
export function ChannelStatic({ onDone }: { onDone?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    let frame = 0;
    let flashed = false;
    const started = performance.now();
    const draw = () => {
      if (!c || !ctx) return;
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = v * 0.75;
        img.data[i + 1] = v * 0.95;
        img.data[i + 2] = v * 0.9;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (!flashed && performance.now() - started >= 420) {
        flashed = true;
        onDone?.();
      }
      // Moving noise (a still frame for reduced motion).
      if (!reduced || !flashed) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [onDone]);
  return <canvas ref={canvas} className="cstatic" width={160} height={90} aria-hidden="true" />;
}
