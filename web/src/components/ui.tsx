import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert, CircleCheck, Download, LoaderCircle, Plus, X } from 'lucide-react';
import type { Availability } from '@netfish/shared';
import { percent } from '../lib/format';
import { t } from '../i18n';

// ---------- Image with fade-in and a graceful fallback ----------

export function Img({ src, alt = '', className = '', fallback }: { src?: string; alt?: string; className?: string; fallback?: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  // A new picture starts over, straight away (resetting in an effect could land after a cached
  // picture had already loaded, leaving it invisible).
  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setState(src ? 'loading' : 'error');
  }
  // Loaded before React was listening (from the cache): show it.
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth) setState('ok');
  }, [src]);
  if (!src || state === 'error') return <div className={`img-fallback ${className}`}>{fallback}</div>;
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`img ${className}${state === 'ok' ? ' is-loaded' : ''}`}
      onLoad={() => setState('ok')}
      onError={() => setState('error')}
    />
  );
}

// ---------- Progress ----------

/** An on/off switch (a checkbox that looks like one). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="switch__knob" />
    </button>
  );
}

export function Progress({ value, className = '', tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'watch' | 'warn' }) {
  return (
    <div className={`progress progress--${tone} ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="progress__fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={size} className="spin" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

// ---------- Status chip ----------

export function StatusChip({ status, progress, compact }: { status: Availability; progress?: number; compact?: boolean }) {
  if (progress !== undefined && status !== 'available') {
    return (
      <span className="chip chip--dl">
        <Download size={12} aria-hidden="true" />
        {percent(progress)}
      </span>
    );
  }
  switch (status) {
    case 'processing':
      return <span className="chip chip--processing">{t('On its way')}</span>;
    case 'pending':
      return <span className="chip chip--pending">{t('Requested')}</span>;
    case 'partial':
      return <span className="chip chip--partial">{t('Partial')}</span>;
    case 'none':
      return compact ? null : (
        <span className="chip chip--none">
          <Plus size={12} aria-hidden="true" />
          {t('Request')}
        </span>
      );
    default:
      return null;
  }
}

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      previous?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <div className={`modal__panel${wide ? ' modal__panel--wide' : ''}`} ref={panel} tabIndex={-1}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toasts ----------

type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const ToastContext = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.kind}`}>
              {toast.kind === 'ok' ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
              <span>{toast.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Shown when the server can't save its settings (usually folder permissions). */
export function StorageWarning({ problem }: { problem?: string }) {
  if (!problem) return null;
  return (
    <div className="storage-warning" role="alert">
      <TriangleAlert size={18} />
      <span>{problem}</span>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="empty">
      <TriangleAlert size={28} />
      <p>{error instanceof Error ? error.message : t('Something went wrong')}</p>
      {retry && (
        <button className="btn btn--ghost" onClick={retry}>
          {t('Try again')}
        </button>
      )}
    </div>
  );
}
