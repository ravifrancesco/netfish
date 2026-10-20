/** A subtitle cue from a WebVTT file. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const time = (s: string) => {
  // "00:01:02.500", or SRT's "00:01:02,500" should a subtitle come in that format.
  const parts = s.trim().replace(',', '.').split(':').map(Number);
  return parts.reduce((total, n) => total * 60 + n, 0);
};

/**
 * Just enough WebVTT for showing subtitles in the page (when the app's player
 * can't draw them itself): timings and text, styling tags removed.
 */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [from, rest] = lines[at].split('-->');
    const to = rest.trim().split(/\s+/)[0];
    const body = lines
      .slice(at + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (body) cues.push({ start: time(from), end: time(to), text: body });
  }
  return cues;
}
