import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The language each request wants (the interface sends `x-netfish-lang`; apps'
 * own requests fall back to Accept-Language). Everything a request produces
 * for people (errors, row titles, track names…) goes through t(), which
 * reads the request's language, so services don't pass it around.
 * English is written where it's used; IT below maps that exact text.
 */

export type Language = 'en' | 'it';

const current = new AsyncLocalStorage<Language>();

export function languageFrom(header: string | string[] | undefined): Language {
  const value = Array.isArray(header) ? header[0] : header;
  return /^\s*it\b/i.test(value ?? '') ? 'it' : 'en';
}

/** Runs the rest of a request (or any work) in a language. */
export const inLanguage = <T>(language: Language, fn: () => T): T => current.run(language, fn);

export const lang = (): Language => current.getStore() ?? 'en';

export function t(text: string, vars?: Record<string, string | number | undefined>): string {
  const translated = lang() === 'it' ? (IT[text] ?? text) : text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] === undefined ? match : String(vars[name])));
}

export function tn(count: number, one: string, other: string, vars?: Record<string, string | number | undefined>): string {
  return t(count === 1 ? one : other, { n: count, ...vars });
}

const italianNames = new Intl.DisplayNames(['it'], { type: 'language' });

/** A language's name for people: "Spanish" in English, "Spagnolo" in Italian. */
export function languageName(code: string, english: string): string {
  if (lang() !== 'it') return english;
  try {
    const name = italianNames.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name[0].toUpperCase() + name.slice(1) : english;
  } catch {
    return english;
  }
}

const IT: Record<string, string> = {
  // Sign-in and access
  'Please sign in': 'Accedi per continuare',
  'Admins only': 'Solo per gli amministratori',
  'Wrong username or password': 'Nome utente o password errati',
  'Username is required': 'Inserisci il nome utente',
  "That setup code isn't right": 'Il codice di configurazione non è corretto',
  'Netfish is already set up. Admins can change this in Settings → Connections.':
    'Netfish è già configurato. Gli amministratori possono cambiarlo in Impostazioni → Connessioni.',
  "Couldn't reach Jellyfin at that address": 'Impossibile raggiungere Jellyfin a quell’indirizzo',
  'Something went wrong on the Netfish server': 'Qualcosa è andato storto sul server Netfish',
  'Not found': 'Non trovato',
  '{service} is not configured on this Netfish server': '{service} non è configurato su questo server Netfish',
  'Jellyfin is not connected yet': 'Jellyfin non è ancora collegato',
  'Jellyfin is unreachable ({reason})': 'Jellyfin non è raggiungibile ({reason})',
  '{service} is unreachable ({reason})': '{service} non è raggiungibile ({reason})',

  // Home rows
  'Continue Watching': 'Continua a guardare',
  'Your requests': 'Le tue richieste',
  'Top picks for {name}': 'I migliori per {name}',
  'Because you watched {name}': 'Perché hai guardato {name}',
  'Recently added movies': 'Film aggiunti di recente',
  'New episodes': 'Nuovi episodi',
  'Trending now': 'Di tendenza',
  'Popular movies': 'Film popolari',
  'Popular shows': 'Serie TV popolari',
  'Waiting in your library': 'Ti aspettano nella tua libreria',
  'Coming soon to cinemas': 'Prossimamente al cinema',
  'Popular on this server': 'Popolari su questo server',
  'More from {name}': 'Altro di {name}',
  'Because you like {name}': 'Perché ti piace {name}',
  'Movies Trakt recommends': 'Film consigliati da Trakt',
  'Shows Trakt recommends': 'Serie TV consigliate da Trakt',
  'Unknown list "{kind}"': 'Elenco sconosciuto "{kind}"',

  // People (directors, actors…)
  Directed: 'Regia',
  'Acted in': 'Come interprete',
  Written: 'Sceneggiature',
  Created: 'Serie TV ideate',
  'Directed by {name}': 'Regia di {name}',
  'Starring {name}': 'Con {name}',
  'Written by {name}': 'Scritti da {name}',
  'Created by {name}': 'Ideate da {name}',
  "Couldn't find that person": 'Persona non trovata',
  Acting: 'Recitazione',
  Directing: 'Regia',
  Writing: 'Sceneggiatura',
  Production: 'Produzione',
  Sound: 'Suono',
  Camera: 'Fotografia',
  Editing: 'Montaggio',
  Art: 'Scenografia',
  Crew: 'Troupe',
  'Visual Effects': 'Effetti visivi',
  'Costume & Make-Up': 'Costumi e trucco',
  Lighting: 'Luci',

  // Titles and playback
  Play: 'Riproduci',
  Resume: 'Riprendi',
  'Play {episode}': 'Riproduci {episode}',
  'Resume {episode}': 'Riprendi {episode}',
  'Not in your library': 'Non è nella tua libreria',
  "Can't show details for a {type}": 'Impossibile mostrare i dettagli di questo elemento ({type})',
  'Bad season number': 'Numero di stagione non valido',
  "Jellyfin can't play this here ({code})": 'Jellyfin non può riprodurlo qui ({code})',
  'No playable file found': 'Nessun file riproducibile trovato',
  "This file can't be played in this app yet": 'Questo file non si può ancora riprodurre in questa app',
  "Your Jellyfin account isn't allowed to download. An admin can turn on \"Allow media downloading\" for you in Jellyfin.":
    'Il tuo account Jellyfin non può scaricare. Un amministratore può attivare "Allow media downloading" per te in Jellyfin.',
  'Only movies and episodes can be downloaded': 'Si possono scaricare solo film ed episodi',
  'No file to download': 'Nessun file da scaricare',
  Stereo: 'Stereo',
  Mono: 'Mono',
  Forced: 'Forzati',
  'Track {n}': 'Traccia {n}',
  Unknown: 'Sconosciuta',

  // Requests, versions, subtitles
  "Your account ({name}) isn't linked in Seerr yet. An admin can fix this with \"Import Jellyfin Users\" in Seerr.":
    'Il tuo account ({name}) non è ancora collegato in Seerr. Un amministratore può sistemarlo con "Import Jellyfin Users" in Seerr.',
  'On this server only admins can pick specific versions': 'Su questo server solo gli amministratori possono scegliere una versione',
  "Sonarr doesn't manage this show yet — request it first": 'Sonarr non gestisce ancora questa serie: richiedila prima',
  "Radarr doesn't manage this movie yet — request it first": 'Radarr non gestisce ancora questo film: richiedilo prima',
  'Pick a season': 'Scegli una stagione',
  'Pick a season or an episode': 'Scegli una stagione o un episodio',
  "Sonarr doesn't know that episode": 'Sonarr non conosce quell’episodio',
  'That search has expired. Search again and pick the release.': 'La ricerca è scaduta. Cerca di nuovo e scegli la versione.',
  'That release is over the {size} GB limit set by your admin': 'Questa versione supera il limite di {size} GB impostato dall’amministratore',
  'That release is over the {size} GB per episode limit set by your admin':
    'Questa versione supera il limite di {size} GB per episodio impostato dall’amministratore',
  'Unknown language "{language}"': 'Lingua sconosciuta "{language}"',
  "Radarr doesn't manage this movie, so Bazarr can't fetch subtitles for it":
    'Radarr non gestisce questo film, quindi Bazarr non può scaricarne i sottotitoli',
  'Bazarr has no episode files for that yet': 'Bazarr non ha ancora file di episodi per questo',

  // Downloads (Radarr/Sonarr queues)
  'Downloaded, but the import needs attention': 'Scaricato, ma l’importazione richiede attenzione',
  'Waiting for peers': 'In attesa di peer',
  'Unknown movie': 'Film sconosciuto',
  'Unknown show': 'Serie TV sconosciuta',

  // Settings → Connections
  'Movie downloads, versions and audio languages': 'Download dei film, versioni e lingue audio',
  'Show downloads, versions and audio languages': 'Download delle serie TV, versioni e lingue audio',
  'Subtitles in any language': 'Sottotitoli in qualsiasi lingua',
  'Live download speed (optional)': 'Velocità di download in tempo reale (facoltativo)',
  'Letterboxd and Metacritic scores (optional)': 'Voti di Letterboxd e Metacritic (facoltativo)',
  'Sign-in, library and playback': 'Accesso, libreria e riproduzione',
  'Discovery, suggestions, requests and scores': 'Scoperta, suggerimenti, richieste e voti',
  'Optional. Dashboard → API Keys → +. Lets Netfish refresh items when new subtitles arrive.':
    'Facoltativa. Dashboard → API Keys → +. Permette a Netfish di aggiornare i titoli quando arrivano nuovi sottotitoli.',
  'Your WebUI login. Leave empty if the WebUI skips authentication on your network.':
    'Le credenziali della WebUI. Lascia vuoto se la WebUI non chiede l’accesso sulla tua rete.',
  'Free: sign in at mdblist.com → Preferences → API key': 'Gratis: accedi su mdblist.com → Preferences → API key',
  'timed out': 'tempo scaduto',
  '"{value}" isn\'t a valid address': '"{value}" non è un indirizzo valido',
  'Unknown service "{id}"': 'Servizio sconosciuto "{id}"',
  'Jellyfin needs an address: Netfish signs people in through it': 'Jellyfin ha bisogno di un indirizzo: Netfish fa accedere le persone tramite Jellyfin',
  'Add an address first': 'Aggiungi prima un indirizzo',
  'Add the API key': 'Aggiungi la chiave API',
  'API key accepted': 'Chiave API accettata',
  'That address is {app}, not {name}': 'Quell’indirizzo è {app}, non {name}',
  'qBittorrent wants a username and password': 'qBittorrent richiede nome utente e password',
  'qBittorrent answered {status}': 'qBittorrent ha risposto {status}',
  '{field} must be a size in GB, or empty for no limit': '{field} deve essere una dimensione in GB, o vuoto per nessun limite',
  'Recommendations and a watch history for the server (optional)': 'Consigli e cronologia di visione per il server (facoltativo)',
  'Needs Trakt VIP: Trakt only lets VIP accounts create API apps. On trakt.tv open Settings → Your API Apps → New Application, give it any name and the redirect URI urn:ietf:wg:oauth:2.0:oob, and save. Paste its Client ID and Client Secret here, then link the account below.':
    'Serve Trakt VIP: Trakt permette di creare app API solo agli account VIP. Su trakt.tv apri Settings → Your API Apps → New Application, dalle un nome qualsiasi e il redirect URI urn:ietf:wg:oauth:2.0:oob, e salva. Incolla qui Client ID e Client Secret, poi collega l’account qui sotto.',
  'Client ID': 'Client ID',
  'Client secret': 'Client secret',
  'Add the Client ID': 'Aggiungi il Client ID',
  'Add the Client secret': 'Aggiungi il Client secret',
  'Trakt rejected the Client secret': 'Trakt ha rifiutato il Client secret',
  '{name} rejected the Client ID': '{name} ha rifiutato il Client ID',
  '{name} rejected the API key': '{name} ha rifiutato la chiave API',

  // Trakt
  'Save the Trakt Client ID and secret first': 'Prima salva Client ID e Client secret di Trakt',
  'No Trakt account is linked': 'Nessun account Trakt collegato',
  "Trakt didn't recognise the code. Start again.": 'Trakt non ha riconosciuto il codice. Ricomincia.',
  'That code was already used. Start again.': 'Quel codice è già stato usato. Ricomincia.',
  'The code expired. Start again.': 'Il codice è scaduto. Ricomincia.',
  'The link was declined on trakt.tv.': 'Il collegamento è stato rifiutato su trakt.tv.',
  'Trakt ended the link. Link the account again.': 'Trakt ha chiuso il collegamento. Collega di nuovo l’account.',

  'not out yet': 'non ancora uscito',
  "{service} won't download it yet: it isn't out. It downloads by itself once it is.":
    '{service} non lo scarica ancora perché non è ancora uscito. Si scaricherà da solo quando uscirà.',
  'Movie size limit': 'Il limite per i film',
  'Episode size limit': 'Il limite per gli episodi',
};
