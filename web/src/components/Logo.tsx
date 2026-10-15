import { useId } from 'react';
import { t } from '../i18n';

/**
 * The Netfish mark: a play button that is also a fish.
 * Geometry is shared with the opening animation (Splash) and the app icon.
 */

export const BODY = 'M23 15 L52 32 L23 49 Z';
export const TAIL = 'M15 32 L6 23 L6 41 Z';
export const EYE = { cx: 38, cy: 27.5, r: 2.5 };

export function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function FishGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#8cf8e6" />
      <stop offset="1" stopColor="#13b89c" />
    </linearGradient>
  );
}

export function Fish({ gradient, tailClassName }: { gradient: string; tailClassName?: string }) {
  const fill = `url(#${gradient})`;
  return (
    <>
      <path className={tailClassName} d={TAIL} fill={fill} stroke={fill} strokeWidth={4} strokeLinejoin="round" />
      <path d={BODY} fill={fill} stroke={fill} strokeWidth={6} strokeLinejoin="round" />
      <circle {...EYE} fill="#03140f" />
    </>
  );
}

export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useSvgId('nfm');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <FishGradient id={id} />
      </defs>
      <Fish gradient={id} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark ${className ?? ''}`}>
      <span className="wordmark__net">net</span>
      <span className="wordmark__fish">fish</span>
    </span>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="logo" aria-label="Netfish">
      <Mark size={size} />
      <Wordmark />
    </span>
  );
}

// ---------- The fish around the app, kept small and quiet ----------

/** Loading a page, or the player waiting for the film: the fish swims on the spot, bubbles rising. */
export function SwimmingFish({ size = 44, label, className = '' }: { size?: number; label?: string; className?: string }) {
  const id = useSvgId('nfl');
  return (
    <span className={`swimming-fish ${className}`} role="status" aria-label={label ?? t('Loading…')}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs>
          <FishGradient id={id} />
        </defs>
        <g className="swimming-fish__body">
          <Fish gradient={id} tailClassName="swimming-fish__tail" />
        </g>
        <circle className="swimming-fish__bubble" cx="56" cy="26" r="2" />
        <circle className="swimming-fish__bubble" cx="58" cy="24" r="1.4" />
        <circle className="swimming-fish__bubble" cx="55" cy="27" r="1.7" />
      </svg>
    </span>
  );
}

/**
 * The fish in one colour (the text's), for empty screens; `stranded` for errors:
 * a fish out of water, jumping clear of a splash.
 */
export function FishGlyph({ size = 40, stranded, className = '' }: { size?: number; stranded?: boolean; className?: string }) {
  const id = useSvgId('nfg');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`fish-glyph${stranded ? ' is-stranded' : ''} ${className}`} aria-hidden="true">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <circle {...EYE} fill="#000" />
        </mask>
      </defs>
      <g
        className="fish-glyph__fish"
        mask={`url(#${id})`}
        transform={stranded ? 'rotate(-12 32 32) translate(2 -4)' : undefined}
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      >
        <path className="fish-glyph__tail" d={TAIL} strokeWidth={4} />
        <path d={BODY} strokeWidth={6} />
      </g>
      {stranded && (
        <g className="fish-glyph__splash" fill="none" stroke="currentColor" strokeLinecap="round">
          <path d="M10 56 l-3 -4 M16 54 l0 -5 M22 56 l3 -4" strokeWidth={2.4} />
          <path d="M4 60 q6 -3 12 0 t12 0" strokeWidth={2.2} opacity={0.6} />
        </g>
      )}
    </svg>
  );
}

/** Two small fish swimming side by side: Watch together. */
export function FishPair({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 76 44" width={size} height={(size * 44) / 76} className="fish-pair" aria-hidden="true">
      {[
        { x: 0, y: -4, s: 0.58 },
        { x: 26, y: 18, s: 0.5 },
      ].map(({ x, y, s }, i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <g className="fish-pair__fish" fill="currentColor" stroke="currentColor" strokeLinejoin="round">
            <path className="fish-pair__tail" d={TAIL} strokeWidth={4} />
            <path d={BODY} strokeWidth={6} />
          </g>
        </g>
      ))}
    </svg>
  );
}
