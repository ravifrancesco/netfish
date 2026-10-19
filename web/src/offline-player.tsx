import { createRoot, type Root } from 'react-dom/client';
import styles from './styles.css?inline';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';
import { DownloadPlayer, type DownloadPlayerProps } from './player/DownloadPlayer';
import { markFullscreen } from './lib/desktop';
import { startSystemVolume } from './lib/systemVolume';

/**
 * Netfish's player for the apps' downloads page (apps/common/offline.html), which works
 * without the server: built into every app as apps/common/player.js (npm run build:player),
 * so downloads play in the same player as everything else, online or not.
 *
 *   NetfishPlayer.open({ item, start, onPosition, onClose, next })
 *   NetfishPlayer.back()     what the player's Back does: saves where you got to and closes it
 *   NetfishPlayer.isOpen()
 *
 * It lives in a shadow root, so Netfish's styles and the page's stay out of each other's way.
 */

let root: Root | undefined;
let host: HTMLElement | undefined;
const backRef: { current?: () => void } = {};

function setUp() {
  if (host) return host;
  // Fonts only load from the document, not from inside a shadow root.
  const font = document.createElement('style');
  font.textContent = `@font-face{font-family:'Inter Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(${inter}) format('woff2-variations'),url(${inter}) format('woff2')}`;
  document.head.append(font);
  host = document.createElement('div');
  host.id = 'netfish-player';
  host.hidden = true;
  // What the web app marks its page with (main.tsx): room for the Mac's window buttons, no
  // volume slider on phones. Here on the player's root, where its styles can see them.
  const ua = navigator.userAgent;
  if (/NetfishDesktop/.test(ua)) {
    host.classList.add('is-desktop', /Mac/.test(navigator.platform) ? 'is-mac' : 'is-other-os');
    markFullscreen(host);
    startSystemVolume();
  }
  if (/NetfishiOS|NetfishAndroid/.test(ua)) host.classList.add('is-ios-app');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  // The app's variables, base text and page-level marks (html.is-mac …), on the player's own root.
  sheet.textContent =
    styles.replace(/:root\b/g, ':host').replace(/\bhtml((?:\.[\w-]+)+)/g, ':host($1)') +
    `:host{display:block;color:var(--text);font-family:'Inter Variable',Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}`;
  shadow.append(sheet);
  const mount = document.createElement('div');
  shadow.append(mount);
  root = createRoot(mount);
  return host;
}

function open(options: DownloadPlayerProps) {
  const el = setUp();
  el.hidden = false;
  root!.render(
    <DownloadPlayer
      key={`${options.item.itemId}:${Date.now()}`}
      {...options}
      backRef={backRef}
      onClose={() => {
        close();
        options.onClose();
      }}
    />,
  );
}

function close() {
  root?.render(null);
  if (host) host.hidden = true;
}

/** Whether a film is open (the page's Back closes it first). */
const isOpen = () => Boolean(host && !host.hidden);
const back = () => (isOpen() ? backRef.current?.() : undefined);

declare global {
  interface Window {
    NetfishPlayer?: { open: typeof open; back: typeof back; isOpen: typeof isOpen };
  }
}
window.NetfishPlayer = { open, back, isOpen };
