/**
 * The interface's languages: English (the text in the code) and Italian.
 *
 * Text is written in English where it's used and wrapped in t(): t('Sign in').
 * The Italian dictionaries (./it/*.ts, one per area of the app) map that exact
 * English text to Italian; anything missing simply shows in English.
 *
 *   t('Downloading {pct}%', { pct: 45 })        placeholders in {braces}
 *   tn(count, '{n} episode', '{n} episodes')    singular/plural ({n} is the count)
 *
 * The language follows the browser (or the app's system language) unless it's
 * chosen in Settings; changing it reloads the page.
 */

export type Language = 'en' | 'it';
export const LANGUAGES: { value: 'auto' | Language; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italiano' },
];

const KEY = 'netfish.language';

/** What's chosen in Settings: a language, or "auto" (follow the browser). */
export function languageSetting(): 'auto' | Language {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'en' || value === 'it') return value;
  } catch {
    /* storage blocked */
  }
  return 'auto';
}

export function setLanguage(value: 'auto' | Language) {
  try {
    if (value === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked */
  }
  location.reload();
}

function resolve(): Language {
  const chosen = languageSetting();
  if (chosen !== 'auto') return chosen;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return /^it\b/i.test(preferred[0] ?? '') ? 'it' : 'en';
}

export const language: Language = resolve();
/** For dates and numbers (Intl, toLocaleString). */
export const locale = language === 'it' ? 'it-IT' : 'en-US';

const parts = import.meta.glob<{ default: Record<string, string> }>('./it/*.ts', { eager: true });
const italian: Record<string, string> = Object.assign({}, ...Object.values(parts).map((part) => part.default));
const dictionary: Record<string, string> = language === 'it' ? italian : {};

export function t(text: string, vars?: Record<string, string | number | undefined>): string {
  const translated = dictionary[text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] === undefined ? match : String(vars[name])));
}

/** Text that depends on a count: tn(3, '{n} episode', '{n} episodes') → "3 episodi". */
export function tn(count: number, one: string, other: string, vars?: Record<string, string | number | undefined>): string {
  return t(count === 1 ? one : other, { n: count, ...vars });
}
