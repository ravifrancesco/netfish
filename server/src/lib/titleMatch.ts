/**
 * How close a title is to what someone typed, forgiving the usual slips: spaces ("goodwill
 * hunting"), punctuation ("spiderman", "wall e"), accents, "&" for "and", a leading "The", and a
 * typo or two ("intersteller"). Jellyfin and TMDB both match words as typed, so they miss these.
 */

/** Lower case, no accents or punctuation, single spaces: "Léon: The Professional" → "leon the professional". */
export const searchWords = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Fewest edits (a letter added, dropped, changed, or two swapped) from `q` to `t` (`whole`), or
 * to the closest stretch of `t` (starting and ending anywhere in it).
 */
function edits(q: string, t: string, whole: boolean): number {
  let before = new Array<number>(t.length + 1).fill(0);
  let prev = Array.from({ length: t.length + 1 }, (_, j) => (whole ? j : 0));
  let row = new Array<number>(t.length + 1).fill(0);
  for (let i = 1; i <= q.length; i++) {
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (q[i - 1] === t[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && q[i - 1] === t[j - 2] && q[i - 2] === t[j - 1]) v = Math.min(v, before[j - 2] + 1);
      row[j] = v;
    }
    [before, prev, row] = [prev, row, before];
  }
  return whole ? prev[t.length] : Math.min(...prev);
}

/**
 * 1 for the title itself, less the looser the match, 0 for none: started typing it (0.9), part
 * of it (0.85), its words in any order (0.8), a typo or two in all of it (about 0.75) or in part
 * of a longer one (about 0.65).
 */
export function titleScore(query: string, title: string): number {
  const typed = searchWords(query);
  const words = searchWords(title);
  const q = typed.replace(/ /g, '');
  const t = words.replace(/ /g, '');
  const bare = words.replace(/^(the|a|an) /, '').replace(/ /g, '');
  if (!q || !t) return 0;
  if (q === t || q === bare) return 1;
  if (t.startsWith(q) || bare.startsWith(q)) return 0.9;
  if (q.length >= 3 && t.includes(q)) return 0.85;
  const titleWords = words.split(' ');
  if (typed.split(' ').every((w) => titleWords.some((x) => x.startsWith(w)))) return 0.8;
  // Typos: more allowed the longer it is, none in a short word (too many titles are one letter off "night").
  const allowed = q.length >= 13 ? 3 : q.length >= 8 ? 2 : q.length >= 5 ? 1 : 0;
  if (!allowed) return 0;
  const all = Math.min(edits(q, t, true), edits(q, bare, true));
  if (all <= allowed) return 0.78 - 0.02 * all;
  if (q.length >= 7) {
    const part = edits(q, t, false);
    if (part <= (q.length >= 12 ? 2 : 1)) return 0.68 - 0.02 * part;
  }
  return 0;
}

/** The best of a title's names (its own, its original one). */
export const bestScore = (query: string, names: Array<string | undefined>) => Math.max(0, ...names.map((n) => (n ? titleScore(query, n) : 0)));
