import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Fish, FishGradient, useSvgId } from './Logo';
import { t } from '../i18n';

/**
 * Opening animation: a net draws itself, the play-button fish swims in, the
 * net dissolves around it and the wordmark rises. Doubles as the loading
 * screen: it leaves once the animation has played AND the app is ready.
 * Click or any key skips it. Away from home, the apps open Netfish with #tunnel: their loading
 * page left only the tunnel, a breathing ring the fish swam into. It's taken over here at the same
 * place, size and breath, and kept until Netfish is ready; then the fish comes out of it as the ring
 * carries on its way, and the rest plays.
 */

/** Diagonal net lines spanning the stage, both directions. */
const NET: Array<[number, number, number, number]> = [];
for (let a = -40; a <= 70; a += 7) {
  NET.push([a, -6, a + 70, 70]);
  NET.push([a + 70, -6, a, 70]);
}

/** Read (and dropped from the address) before anything else looks at it. */
const viaTunnel = (() => {
  if (location.hash !== '#tunnel') return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  return true;
})();

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function shouldShowSplash(): boolean {
  try {
    if (sessionStorage.getItem('netfish.splash')) return false;
    sessionStorage.setItem('netfish.splash', '1');
  } catch {
    /* storage blocked: just show it */
  }
  return true;
}

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const id = useSvgId('nfs');
  const [played, setPlayed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Through WireGuard: in the tunnel until Netfish is ready, then a moment more.
  const [out, setOut] = useState(!viaTunnel);
  const root = useRef<HTMLDivElement>(null);

  // The ring's breath, on the clock like the loading page's, so it carries on in step.
  useEffect(() => {
    if (!viaTunnel || !document.timeline || !Element.prototype.getAnimations) return;
    for (const ring of root.current?.querySelectorAll('.splash__ring i') ?? []) {
      for (const a of ring.getAnimations()) {
        if ((a as CSSAnimation).animationName === 'nf-breathe') a.startTime = (document.timeline.currentTime as number) - (Date.now() % 1600);
      }
    }
  }, []);

  useEffect(() => {
    if (out || !ready) return;
    const t = setTimeout(() => setOut(true), 300);
    return () => clearTimeout(t);
  }, [out, ready]);

  useEffect(() => {
    if (!out) return;
    const t = setTimeout(() => setPlayed(true), reducedMotion() ? 350 : 2400);
    return () => clearTimeout(t);
  }, [out]);

  useEffect(() => {
    const skip = () => setPlayed(true);
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, []);

  useEffect(() => {
    if (!played || !ready || leaving) return;
    setLeaving(true);
    const t = setTimeout(onDone, 550);
    return () => clearTimeout(t);
  }, [played, ready, leaving, onDone]);

  return (
    <div
      ref={root}
      className={`splash${viaTunnel ? ' splash--tunnel' : ''}${out ? '' : ' is-waiting'}${leaving ? ' is-leaving' : ''}`}
      onClick={() => setPlayed(true)}
      role="presentation"
    >
      <div className="splash__stage">
        <div className="splash__markbox">
        {viaTunnel && (
          <span className="splash__ring is-back" aria-hidden="true">
            <i />
          </span>
        )}
        <svg className="splash__mark" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <FishGradient id={id} />
            <radialGradient id={`${id}fade`} cx="0.55" cy="0.5" r="0.55">
              <stop offset="0.55" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </radialGradient>
            <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="84" height="84">
              <rect x="-10" y="-10" width="84" height="84" fill={`url(#${id}fade)`} />
            </mask>
          </defs>
          <g className="splash__net" mask={`url(#${id}m)`}>
            {NET.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} style={{ '--i': i } as CSSProperties} />
            ))}
          </g>
          {!viaTunnel && (
            <g className="splash__fish">
              <Fish gradient={id} />
            </g>
          )}
        </svg>
        {viaTunnel && (
          // The fish, out of the tunnel only past the ring's middle.
          <div className="splash__fish-out">
            <svg className="splash__mark" viewBox="0 0 64 64" aria-hidden="true">
              <g className="splash__fish">
                <Fish gradient={id} tailClassName="splash__tail" />
              </g>
            </svg>
          </div>
        )}
        {viaTunnel && (
          <span className="splash__ring is-front" aria-hidden="true">
            <i />
          </span>
        )}
        </div>
        <div className="splash__word" aria-label="Netfish">
          <span className="wordmark">
            <span className="wordmark__net">net</span>
            <span className="wordmark__fish">fish</span>
          </span>
        </div>
      </div>
      {viaTunnel && <span className="splash__says">{t('Connected through WireGuard')}</span>}
    </div>
  );
}
