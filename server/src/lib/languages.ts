import type { Language } from '@netfish/shared';

/**
 * One table to translate between the language "dialects" of each service:
 * Jellyfin streams (ISO 639-2), Radarr/Sonarr (English names), Bazarr
 * (ISO 639-1 plus a few variants) and release titles (keywords).
 */
export interface LangDef extends Language {
  iso3: string[];
  arrNames: string[];
  /** Tokens that mark this language in a release title, e.g. "VFF", "GERMAN". */
  keywords: string[];
  bazarr: string;
}

const L = (
  code: string,
  name: string,
  native: string,
  iso3: string[],
  keywords: string[],
  extra: { arrNames?: string[]; bazarr?: string } = {},
): LangDef => ({
  code,
  name,
  native,
  iso3,
  keywords,
  arrNames: extra.arrNames ?? [name],
  bazarr: extra.bazarr ?? code,
});

export const LANGUAGES: LangDef[] = [
  L('en', 'English', 'English', ['eng'], ['english', 'eng']),
  L('es', 'Spanish', 'Español', ['spa'], ['spanish', 'spa', 'esp', 'castellano', 'español', 'espanol']),
  L('es-419', 'Spanish (Latin America)', 'Español (Latinoamérica)', ['spa'], ['latino', 'lat', 'latam'], {
    arrNames: ['Spanish (Latino)'],
    bazarr: 'es',
  }),
  L('fr', 'French', 'Français', ['fre', 'fra'], ['french', 'fre', 'vff', 'vf', 'vf2', 'vfq', 'vfi', 'truefrench', 'francais']),
  L('de', 'German', 'Deutsch', ['ger', 'deu'], ['german', 'ger', 'deutsch']),
  L('it', 'Italian', 'Italiano', ['ita'], ['italian', 'ita']),
  L('pt', 'Portuguese', 'Português', ['por'], ['portuguese', 'por']),
  L('pt-BR', 'Portuguese (Brazil)', 'Português (Brasil)', ['por'], ['brazilian', 'ptbr', 'pt-br', 'dublado', 'nacional'], {
    arrNames: ['Portuguese (Brazil)'],
    bazarr: 'pb',
  }),
  L('nl', 'Dutch', 'Nederlands', ['dut', 'nld'], ['dutch', 'nl', 'nlsubs']),
  L('ja', 'Japanese', '日本語', ['jpn'], ['japanese', 'jpn', 'jap']),
  L('ko', 'Korean', '한국어', ['kor'], ['korean', 'kor']),
  L('zh', 'Chinese', '中文', ['chi', 'zho'], ['chinese', 'chi', 'mandarin', 'cantonese', 'chs', 'cht']),
  L('hi', 'Hindi', 'हिन्दी', ['hin'], ['hindi', 'hin']),
  L('ta', 'Tamil', 'தமிழ்', ['tam'], ['tamil', 'tam']),
  L('te', 'Telugu', 'తెలుగు', ['tel'], ['telugu']),
  L('ml', 'Malayalam', 'മലയാളം', ['mal'], ['malayalam', 'mal']),
  L('kn', 'Kannada', 'ಕನ್ನಡ', ['kan'], ['kannada', 'kan']),
  L('mr', 'Marathi', 'मराठी', ['mar'], ['marathi']),
  L('bn', 'Bengali', 'বাংলা', ['ben'], ['bengali', 'ben']),
  L('ur', 'Urdu', 'اردو', ['urd'], ['urdu']),
  L('ru', 'Russian', 'Русский', ['rus'], ['russian', 'rus']),
  L('uk', 'Ukrainian', 'Українська', ['ukr'], ['ukrainian', 'ukr']),
  L('pl', 'Polish', 'Polski', ['pol'], ['polish', 'pol', 'pldub', 'plsub']),
  L('cs', 'Czech', 'Čeština', ['cze', 'ces'], ['czech', 'cze']),
  L('sk', 'Slovak', 'Slovenčina', ['slo', 'slk'], ['slovak']),
  L('hu', 'Hungarian', 'Magyar', ['hun'], ['hungarian', 'hun']),
  L('ro', 'Romanian', 'Română', ['rum', 'ron'], ['romanian', 'rum', 'rom']),
  L('bg', 'Bulgarian', 'Български', ['bul'], ['bulgarian', 'bul']),
  L('hr', 'Croatian', 'Hrvatski', ['hrv'], ['croatian', 'hrv']),
  L('sr', 'Serbian', 'Српски', ['srp'], ['serbian', 'srp']),
  L('sl', 'Slovenian', 'Slovenščina', ['slv'], ['slovenian', 'slv']),
  L('el', 'Greek', 'Ελληνικά', ['gre', 'ell'], ['greek', 'gre']),
  L('tr', 'Turkish', 'Türkçe', ['tur'], ['turkish', 'tur']),
  L('ar', 'Arabic', 'العربية', ['ara'], ['arabic', 'ara']),
  L('he', 'Hebrew', 'עברית', ['heb'], ['hebrew', 'heb']),
  L('fa', 'Persian', 'فارسی', ['per', 'fas'], ['persian', 'farsi']),
  L('sv', 'Swedish', 'Svenska', ['swe'], ['swedish', 'swe']),
  L('no', 'Norwegian', 'Norsk', ['nor', 'nob', 'nno'], ['norwegian', 'nor']),
  L('da', 'Danish', 'Dansk', ['dan'], ['danish', 'dan']),
  L('fi', 'Finnish', 'Suomi', ['fin'], ['finnish', 'fin']),
  L('is', 'Icelandic', 'Íslenska', ['ice', 'isl'], ['icelandic']),
  L('et', 'Estonian', 'Eesti', ['est'], ['estonian']),
  L('lv', 'Latvian', 'Latviešu', ['lav'], ['latvian']),
  L('lt', 'Lithuanian', 'Lietuvių', ['lit'], ['lithuanian']),
  L('ca', 'Catalan', 'Català', ['cat'], ['catalan', 'catala']),
  L('th', 'Thai', 'ไทย', ['tha'], ['thai']),
  L('vi', 'Vietnamese', 'Tiếng Việt', ['vie'], ['vietnamese', 'vie']),
  L('id', 'Indonesian', 'Bahasa Indonesia', ['ind'], ['indonesian']),
  L('ms', 'Malay', 'Bahasa Melayu', ['may', 'msa'], ['malay']),
  L('tl', 'Tagalog', 'Tagalog', ['tgl', 'fil'], ['tagalog', 'filipino']),
];

const byCode = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

export function findLanguage(code: string | undefined): LangDef | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase();
  return byCode.get(c) ?? LANGUAGES.find((l) => l.iso3.includes(c) || l.bazarr === c || l.name.toLowerCase() === c);
}

/** "spa" → "Spanish", "eng" → "English"; unknown codes are returned as-is. */
export function languageLabel(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return findLanguage(code)?.name ?? code;
}

export const publicLanguages = (): Language[] =>
  LANGUAGES.map(({ code, name, native }) => ({ code, name, native }));

// ---------- Release title parsing ----------

const MULTI_TOKENS = new Set(['multi', 'multi-audio', 'multiaudio', 'dual', 'dual-audio', 'dualaudio']);

/** Split a release name and return only the tokens after the year/episode/resolution marker. */
export function releaseTokens(title: string): string[] {
  const tokens = title.toLowerCase().split(/[\s._\-[\]()+]+/).filter(Boolean);
  // Language tags come after the title; skip the title itself so "The.Cat.in.the.Hat"
  // isn't read as Catalan.
  const marker = tokens.findIndex(
    (t, i) => i > 0 && (/^(19|20)\d{2}$/.test(t) || /^s\d{1,2}(e\d{1,3})*$/.test(t) || /^\d{3,4}p$/.test(t)),
  );
  return marker >= 0 ? tokens.slice(marker) : tokens;
}

export function titleHasLanguage(tokens: string[], lang: LangDef): boolean {
  return tokens.some((t) => lang.keywords.includes(t));
}

/** MULTi / DUAL releases may carry extra audio tracks. ("German.DL" is German + original only.) */
export function titleIsMulti(tokens: string[]): boolean {
  return tokens.some((t) => MULTI_TOKENS.has(t));
}
