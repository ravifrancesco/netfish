/** Placeholder artwork so the mock catalog looks like a catalog. */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function palette(seed: string) {
  const h = hash(seed);
  const hue = h % 360;
  return { a: `hsl(${hue} 65% 42%)`, b: `hsl(${(hue + 40) % 360} 70% 10%)`, c: `hsl(${(hue + 180) % 360} 80% 70%)`, h };
}

function waves(width: number, height: number, seed: number, color: string) {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const y = height * (0.45 + i * 0.12);
    const amp = 18 + ((seed >> (i * 3)) % 30);
    out.push(
      `<path d="M0 ${y} C ${width * 0.25} ${y - amp}, ${width * 0.5} ${y + amp}, ${width} ${y - amp / 2} L ${width} ${height} L 0 ${height} Z" fill="${color}" opacity="${0.05 + i * 0.03}"/>`,
    );
  }
  return out.join('');
}

export function poster(title: string, subtitle: string): string {
  const { a, b, c, h } = palette(title);
  const lines = wrap(title.toUpperCase(), 12);
  const size = lines.some((l) => l.length > 9) ? 34 : 42;
  const startY = 470 - lines.length * (size + 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513" viewBox="0 0 342 513">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="342" height="513" fill="url(#g)"/>${waves(342, 513, h, c)}
<circle cx="${60 + (h % 220)}" cy="${90 + (h % 120)}" r="${40 + (h % 50)}" fill="${c}" opacity="0.18"/>
${lines.map((l, i) => `<text x="24" y="${startY + i * (size + 4)}" font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="${size}" fill="#fff" letter-spacing="1">${esc(l)}</text>`).join('')}
<text x="24" y="492" font-family="Helvetica Neue, Arial, sans-serif" font-size="15" fill="#ffffffaa" letter-spacing="3">${esc(subtitle)}</text>
</svg>`;
}

export function backdrop(title: string, width = 1280, height = 720): string {
  const { a, b, c, h } = palette(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><radialGradient id="g" cx="0.7" cy="0.3" r="0.9"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>
<rect width="${width}" height="${height}" fill="url(#g)"/>${waves(width, height, h, c)}
<circle cx="${width * 0.72}" cy="${height * 0.32}" r="${height * 0.22}" fill="${c}" opacity="0.15"/>
<circle cx="${width * 0.82}" cy="${height * 0.22}" r="${height * 0.07}" fill="#fff" opacity="0.12"/>
</svg>`;
}

export function still(title: string, label: string): string {
  const { a, b, c, h } = palette(title + label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="400" height="225" fill="url(#g)"/>${waves(400, 225, h, c)}
<text x="16" y="208" font-family="Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="16" fill="#ffffffcc">${esc(label)}</text>
</svg>`;
}

export function avatar(name: string): string {
  const { a } = palette(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="16" fill="${a}"/><text x="64" y="84" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="700" font-size="60" fill="#fff">${esc(name[0]?.toUpperCase() ?? '?')}</text></svg>`;
}
