/**
 * TV mode (the Fire TV app, Samsung and LG TVs, or any browser with ?tv=1): the
 * remote's arrow keys move focus to the nearest thing in that direction,
 * Select presses it, and Back closes whatever is open, then goes back a page.
 */
import { t } from '../i18n';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
const OVERLAYS = '.modal, .trailer, .menu, .player__menu';

type Direction = 'up' | 'down' | 'left' | 'right';
const KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export function isTV(): boolean {
  try {
    const param = new URLSearchParams(location.search).get('tv');
    if (param !== null) sessionStorage.setItem('netfish.tv', param === '0' ? '0' : '1');
    const stored = sessionStorage.getItem('netfish.tv');
    if (stored !== null) return stored === '1';
  } catch {
    /* storage blocked */
  }
  return /NetfishTV/.test(navigator.userAgent) || browserTV() !== null;
}

/** A TV whose own browser shows Netfish (Samsung's Tizen, LG's webOS), with no Netfish app around it. */
export function browserTV(): 'tizen' | 'webos' | null {
  const ua = navigator.userAgent;
  if (/Tizen|SMART-TV/.test(ua)) return 'tizen';
  if (/Web0S|webOS/.test(ua)) return 'webos';
  return null;
}

/** Samsung's Tizen version (6.5 on 2022 TVs), or 0 elsewhere. */
export function tizenVersion(): number {
  const match = /Tizen\s?(\d+(?:\.\d+)?)/.exec(navigator.userAgent);
  return match ? parseFloat(match[1]) : 0;
}

// Samsung and LG remotes: their Back and media keys, by key code (older TV browsers don't name them).
const REMOTE_KEYS: Record<number, string> = {
  10009: 'Back', // Samsung
  461: 'Back', // LG
  415: 'MediaPlay',
  19: 'MediaPause',
  10252: 'MediaPlayPause',
  413: 'MediaStop',
  417: 'MediaFastForward',
  412: 'MediaRewind',
};

/**
 * On a TV browser nobody else handles Back: close what's open, else go back a
 * page. From Netfish's first page that returns to the TV app's start page,
 * which closes the app, like any TV app.
 */
/** Newer TV browsers name the Back key instead (or as well). */
const BACK_NAMES = new Set(['XF86Back', 'GoBack', 'BrowserBack']);

function onRemoteKey(e: KeyboardEvent) {
  const name = REMOTE_KEYS[e.keyCode] ?? (BACK_NAMES.has(e.key) ? 'Back' : undefined);
  if (!name) return;
  if (name === 'Back') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (back()) return;
    // Netfish's first page: going back closes the app, so the first press only says so.
    if (((history.state as { idx?: number } | null)?.idx ?? 0) === 0 && !confirmedExit()) return;
    history.back();
    return;
  }
  // Media keys: hand them on under their standard names, which the player understands.
  if (e.key === name) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
}

/** "Press Back again to close Netfish", for a moment; true when that's the second press. */
let exitArmedUntil = 0;
function confirmedExit(): boolean {
  if (Date.now() < exitArmedUntil) return true;
  exitArmedUntil = Date.now() + 3000;
  let note = document.querySelector<HTMLElement>('.tv-exit');
  if (!note) {
    note = document.createElement('div');
    note.className = 'tv-exit';
    note.setAttribute('role', 'status');
    document.body.append(note);
  }
  note.textContent = t('Press Back again to close Netfish');
  note.classList.add('is-on');
  window.setTimeout(() => note!.classList.remove('is-on'), 3000);
  return false;
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.opacity !== '0' && !el.closest('[inert], [aria-hidden="true"]');
}

/** Everything focusable in the layer on top (an open dialog wins over the page). */
function candidates(): HTMLElement[] {
  const layers = document.querySelectorAll<HTMLElement>('.modal, .trailer');
  const scope: ParentNode = layers.length ? layers[layers.length - 1] : document;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/**
 * Where something sits, for moving between things: a guide programme opened out (over its
 * neighbours) counts at its own size, so left and right step through the programmes in order.
 */
function rectOf(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const own = el instanceof HTMLElement && el.classList.contains('guide__prog') ? parseFloat(el.style.width) : NaN;
  return Number.isFinite(own) && own < r.width ? new DOMRect(r.left, r.top, own, r.height) : r;
}

/** The part of a guide programme that's on screen: a film can run far past the edge. */
function onScreen(el: Element, r: DOMRect): DOMRect {
  const guide = el.closest<HTMLElement>('.guide__scroller');
  if (!guide) return r;
  const g = guide.getBoundingClientRect();
  const left = Math.max(r.left, g.left + Number(guide.dataset.revealInset ?? 0));
  const right = Math.min(r.right, g.right);
  return right > left ? new DOMRect(left, r.top, right - left, r.height) : r;
}

function best(from: DOMRect, dir: Direction, list: HTMLElement[], current: Element | null) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let winner: HTMLElement | undefined;
  let score = Infinity;
  for (const el of list) {
    if (el === current || el.contains(current) || current?.contains(el)) continue;
    const r = rectOf(el);
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let along: number;
    let across: number;
    if (dir === 'left' || dir === 'right') {
      along = dir === 'right' ? r.left - from.right : from.left - r.right;
      if ((dir === 'right' ? ex <= cx : ex >= cx) || along < -from.width / 2) continue;
      across = r.bottom < from.top ? from.top - r.bottom : r.top > from.bottom ? r.top - from.bottom : 0;
      across = across * 4 + Math.abs(ey - cy) * 0.2;
    } else {
      along = dir === 'down' ? r.top - from.bottom : from.top - r.bottom;
      if ((dir === 'down' ? ey <= cy : ey >= cy) || along < -from.height / 2) continue;
      across = r.right < from.left ? from.left - r.right : r.left > from.right ? r.left - from.right : 0;
      across = across * 2 + Math.abs(ex - cx) * 0.2;
    }
    const s = Math.max(0, along) + across;
    if (s < score) {
      score = s;
      winner = el;
    }
  }
  return winner;
}

export function focusEl(el: HTMLElement, dir?: Direction) {
  el.focus({ preventScroll: true });
  revealSideways(el);
  if (el.closest('.modal, .trailer')) return el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const r = el.getBoundingClientRect();
  // Anything that fits on the first screen: show the page from the top (the whole hero).
  if (r.bottom + window.scrollY < window.innerHeight - 24) return window.scrollTo({ top: 0, behavior: 'smooth' });
  // Already fully on screen: stay put. Otherwise bring it to the middle.
  const onScreen = r.top >= 72 && r.bottom <= window.innerHeight - 16;
  if (!onScreen && dir !== 'left' && dir !== 'right') window.scrollBy({ top: r.top + r.height / 2 - window.innerHeight / 2, behavior: 'smooth' });
  else if (!onScreen) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Scroll a sideways row just enough to show the focused card with a little room. A guide
 * (data-reveal="far") moves on a good way instead, so the next few programmes come into view;
 * data-reveal-inset is what its fixed column covers on the left.
 */
function revealSideways(el: HTMLElement) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollWidth > p.clientWidth) {
      const pr = p.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const far = p.dataset.reveal === 'far';
      const left = pr.left + (Number(p.dataset.revealInset) || 0);
      const width = pr.right - left;
      const room = 48;
      if (r.left < left + room) p.scrollBy({ left: far ? Math.min(r.left - left - room, r.right - (left + width * 0.75)) : r.left - left - room, behavior: 'smooth' });
      else if (r.right > pr.right - room) p.scrollBy({ left: far ? r.left - (left + width * 0.25) : r.right - pr.right + room, behavior: 'smooth' });
      return;
    }
  }
}

/** Put focus somewhere sensible on a fresh page: the main content's first control. */
export function focusFirst() {
  const list = candidates();
  const inMain = list.find((el) => el.closest('main') && !el.closest('.nav'));
  const el = inMain ?? list[0];
  if (el) focusEl(el);
}

function onKey(e: KeyboardEvent) {
  const dir = KEYS[e.key];
  if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement as HTMLElement | null;

  // The player handles its own arrows (seek) unless its controls are showing and one has focus.
  const player = document.querySelector('.player');
  if (player && !(player.classList.contains('show-ui') && active && player.contains(active) && active.matches(FOCUSABLE))) return;

  // A slider (the player's timeline): left/right move along it.
  if ((dir === 'left' || dir === 'right') && active?.getAttribute('role') === 'slider') return;
  // Text fields: left/right move the cursor until it reaches the edge.
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const atStart = active.selectionStart === 0 && active.selectionEnd === 0;
    const atEnd = active.selectionStart === active.value.length;
    if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
  }
  e.preventDefault();
  const list = candidates();
  if (!active || active === document.body || !list.includes(active)) return focusFirst();
  const from = dir === 'up' || dir === 'down' ? onScreen(active, rectOf(active)) : rectOf(active);
  let next = best(from, dir, list, active);
  // Leaving a part upwards that says where up goes (the guide: its day tabs, not whatever's
  // nearest above, like the search button).
  const part = active.closest<HTMLElement>('[data-tv-up]');
  if (dir === 'up' && part && next && !part.contains(next)) {
    next = document.querySelector<HTMLElement>(part.dataset.tvUp!) ?? next;
  }
  if (next) focusEl(next, dir);
}

/**
 * Called by the TV app when Back is pressed. True: handled here (closed
 * something). False: the app should go back a page, or leave on the home screen.
 */
function back(): boolean {
  // Only what's open: some menus stay in the page, hidden, while closed (a title's "⋯").
  if ([...document.querySelectorAll<HTMLElement>(OVERLAYS)].some(visible)) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  return false;
}

declare global {
  interface Window {
    netfishBack?: () => boolean;
  }
}

export function startTV() {
  document.documentElement.classList.add('is-tv');
  document.addEventListener('keydown', onKey);
  if (browserTV()) window.addEventListener('keydown', onRemoteKey, true);
  window.netfishBack = back;
}

// ---------- Focus across pages ----------

// Which control had focus on each page: what it is, and which copy (one title can be in several rows).
const remembered = new Map<string, { id: string; nth: number }>();
const copies = (id: string) => [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => describe(el) === id);
const describe = (el: Element) => `${el.tagName}|${el.getAttribute('href') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 60) ?? ''}`;

/**
 * On each page: put focus back where it was when you return to a page, or on
 * the page's first control once it has loaded. Returns a cleanup function.
 */
export function manageFocus(pageKey: string): () => void {
  const wanted = remembered.get(pageKey);
  const settled = () => {
    const a = document.activeElement;
    return a && a !== document.body && document.contains(a) && a.closest('main, .nav, .modal');
  };
  const attempts = [80, 300, 700, 1500, 3000].map((ms, n, all) =>
    setTimeout(() => {
      if (settled()) return;
      const list = candidates();
      const again = wanted && copies(wanted.id)[wanted.nth];
      if (again) return focusEl(again);
      // Wait for the page's content (not just the header) unless this is the last try.
      const inMain = list.find((el) => el.closest('main') && !el.closest('.nav'));
      if (inMain && (!wanted || n >= 2)) focusEl(inMain);
      else if (n === all.length - 1) focusFirst();
    }, ms),
  );
  const save = () => {
    const a = document.activeElement;
    if (!a || a === document.body) return;
    const id = describe(a);
    remembered.set(pageKey, { id, nth: Math.max(0, copies(id).indexOf(a as HTMLElement)) });
  };
  document.addEventListener('focusin', save);
  return () => {
    attempts.forEach(clearTimeout);
    document.removeEventListener('focusin', save);
  };
}
