// Renders the app icons and the Fire TV banner from the Netfish mark.
//   npx electron@44 scripts/app-art.js        (from the repo root; Electron is only used to draw them)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const font = path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');

const mark = (size) => `
  <svg width="${size}" height="${size}" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8cf8e6"/><stop offset="1" stop-color="#13b89c"/></linearGradient></defs>
    <path d="M15 32 L6 23 L6 41 Z" fill="url(#g)" stroke="url(#g)" stroke-width="4" stroke-linejoin="round"/>
    <path d="M23 15 L52 32 L23 49 Z" fill="url(#g)" stroke="url(#g)" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="38" cy="27.5" r="2.5" fill="#03140f"/>
  </svg>`;

const page = (w, h, body, { transparent = false } = {}) => `<!doctype html><html><head><style>
  @font-face { font-family: Inter; src: url('file://${font}') format('woff2'); font-weight: 100 900; }
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${transparent ? 'transparent' : '#06080b'}; }
  body { display: grid; place-items: center; font-family: Inter, sans-serif; }
</style></head><body>${body}</body></html>`;

const bg = 'background: radial-gradient(ellipse 80% 70% at 30% 20%, #12303a 0%, #0a1418 55%, #05080b 100%);';

const art = {
  // Android launcher icon: rounded tile with the mark (same look as the Mac app).
  launcher: () =>
    page(1024, 1024, `<div style="width:824px;height:824px;border-radius:185px;${bg}display:grid;place-items:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">${mark(560)}</div>`, { transparent: true }),
  // iOS masks the corners itself: a full square, no transparency.
  ios: () => page(1024, 1024, `<div style="width:1024px;height:1024px;${bg}display:grid;place-items:center">${mark(620)}</div>`),
  // Fire TV / Android TV home-screen banner (16:9).
  banner: () =>
    page(
      1280,
      720,
      `<div style="width:1280px;height:720px;${bg}display:flex;align-items:center;justify-content:center;gap:40px">
        ${mark(250)}
        <span style="font-size:190px;letter-spacing:-0.035em;line-height:1;color:#eef3f6"><span style="font-weight:300;color:#b5c0ca">net</span><span style="font-weight:800;margin-left:0.04em">fish</span></span>
      </div>`,
    ),
};

async function render(win, html, w, h) {
  win.setContentSize(w, h);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 300));
  return win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
}

function write(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, image.toPNG());
  console.log('wrote', path.relative(root, file));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);

  const launcher = await render(win, art.launcher(), 1024, 1024);
  const res = path.join(root, 'apps/android/app/src/main/res');
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    write(path.join(res, `mipmap-${density}/ic_launcher.png`), launcher.resize({ width: size, height: size, quality: 'best' }));
  }
  const banner = await render(win, art.banner(), 1280, 720);
  write(path.join(res, 'drawable-xhdpi/banner.png'), banner.resize({ width: 320, height: 180, quality: 'best' }));

  const ios = await render(win, art.ios(), 1024, 1024);
  write(path.join(root, 'apps/ios/Netfish/Assets.xcassets/AppIcon.appiconset/icon-1024.png'), ios.resize({ width: 1024, height: 1024, quality: 'best' }));
  app.quit();
});
