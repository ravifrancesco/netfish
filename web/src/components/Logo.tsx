import { useId } from 'react';

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

export function Fish({ gradient }: { gradient: string }) {
  const fill = `url(#${gradient})`;
  return (
    <>
      <path d={TAIL} fill={fill} stroke={fill} strokeWidth={4} strokeLinejoin="round" />
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
