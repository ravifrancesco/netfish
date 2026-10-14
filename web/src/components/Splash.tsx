import { useEffect, useState, type CSSProperties } from 'react';
import { Fish, FishGradient, useSvgId } from './Logo';

/**
 * Opening animation: a net draws itself, the play-button fish swims in, the
 * net dissolves around it and the wordmark rises. Doubles as the loading
 * screen: it leaves once the animation has played AND the app is ready.
 * Click or any key skips it.
 */

/** Diagonal net lines spanning the stage, both directions. */
const NET: Array<[number, number, number, number]> = [];
for (let a = -40; a <= 70; a += 7) {
  NET.push([a, -6, a + 70, 70]);
  NET.push([a + 70, -6, a, 70]);
}

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

  useEffect(() => {
    const t = setTimeout(() => setPlayed(true), reducedMotion() ? 350 : 2400);
    const skip = () => setPlayed(true);
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  useEffect(() => {
    if (!played || !ready || leaving) return;
    setLeaving(true);
    const t = setTimeout(onDone, 550);
    return () => clearTimeout(t);
  }, [played, ready, leaving, onDone]);

  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}`} onClick={() => setPlayed(true)} role="presentation">
      <div className="splash__stage">
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
          <g className="splash__fish">
            <Fish gradient={id} />
          </g>
        </svg>
        <div className="splash__word" aria-label="Netfish">
          <span className="wordmark">
            <span className="wordmark__net">net</span>
            <span className="wordmark__fish">fish</span>
          </span>
        </div>
      </div>
    </div>
  );
}
