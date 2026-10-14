// Italian for the player (Watch), the reasons the server converts a video, and the Versions and Subtitles sheets.
export default {
  // Player
  'The stream stopped unexpectedly.': "Lo streaming si è interrotto all'improvviso.",
  "This video can't be played in this app.": 'Impossibile riprodurre questo video in questa app.',
  'Try again': 'Riprova',
  'Go back': 'Torna indietro',
  'Why is the server working on this video?': 'Perché il server sta lavorando su questo video?',
  Repackaged: 'Reimpacchettato',
  Transcoding: 'Conversione',
  'The server is re-encoding this video': 'Il server sta convertendo questo video',
  'The server is lightly repackaging this video': 'Il server sta solo reimpacchettando questo video',
  'Use text subtitles instead': 'Usa i sottotitoli di testo',
  'Turn subtitles off': 'Disattiva i sottotitoli',
  'Skip intro': 'Salta intro',
  'Skip recap': 'Salta riepilogo',
  'Next episode': 'Prossimo episodio',
  'Next episode in {n}': 'Prossimo episodio tra {n}',
  'Play now': 'Riproduci ora',
  Seek: 'Avanzamento',
  Pause: 'Pausa',
  'Back 10 seconds': 'Indietro di 10 secondi',
  'Forward 10 seconds': 'Avanti di 10 secondi',
  Unmute: 'Riattiva audio',
  Mute: 'Disattiva audio',
  Volume: 'Volume',
  'Audio and subtitles': 'Audio e sottotitoli',
  'Get another language…': "Aggiungi un'altra lingua…",
  Off: 'Disattivati',
  'picture subtitles, heavy for the server': 'sottotitoli in formato immagine, pesanti per il server',
  'Find more subtitles…': 'Trova altri sottotitoli…',
  'Exit full screen': 'Esci da schermo intero',
  'Full screen': 'Schermo intero',

  // Why the server converts a video
  "This device can't open the file's container, so it's rewrapped (light work).":
    'Questo dispositivo non sa aprire il contenitore del file, quindi viene reimpacchettato (lavoro leggero).',
  "This device can't decode the video format, so the server re-encodes it (heavy on a Pi).":
    'Questo dispositivo non sa decodificare il formato video, quindi il server lo converte (pesante per un Pi).',
  "The video uses a profile this device can't decode, so the server re-encodes it (heavy).":
    'Il video usa un profilo che questo dispositivo non sa decodificare, quindi il server lo converte (pesante).',
  "The video's level is too high for this device, so the server re-encodes it (heavy).":
    'Il livello del video è troppo alto per questo dispositivo, quindi il server lo converte (pesante).',
  "This device can't show 10-bit video, so the server re-encodes it (heavy).":
    'Questo dispositivo non può mostrare video a 10 bit, quindi il server lo converte (pesante).',
  "HDR or Dolby Vision isn't supported here, so the server converts the picture (very heavy).":
    "HDR e Dolby Vision non sono supportati qui, quindi il server converte l'immagine (molto pesante).",
  'The resolution is too high for this device, so the server scales it down (heavy).':
    'La risoluzione è troppo alta per questo dispositivo, quindi il server la riduce (pesante).',
  "The frame rate isn't supported here, so the server re-encodes it (heavy).":
    'La frequenza dei fotogrammi non è supportata qui, quindi il server converte il video (pesante).',
  "The video's encoding settings aren't supported here, so the server re-encodes it (heavy).":
    'Le impostazioni di codifica del video non sono supportate qui, quindi il server lo converte (pesante).',
  'The video is interlaced, so the server de-interlaces it (heavy).': 'Il video è interlacciato, quindi il server lo deinterlaccia (pesante).',
  'The video has non-square pixels, so the server re-encodes it (heavy).': 'Il video ha pixel non quadrati, quindi il server lo converte (pesante).',
  'The video is above your streaming quality setting, so the server shrinks it (heavy).':
    'Il video supera la qualità di streaming che hai impostato, quindi il server lo riduce (pesante).',
  'The file is above your streaming quality setting, so the server shrinks it (heavy).':
    'Il file supera la qualità di streaming che hai impostato, quindi il server lo riduce (pesante).',
  'The chosen subtitles are pictures, so the server draws them into the video (heavy). Text subtitles avoid this.':
    'I sottotitoli scelti sono immagini, quindi il server li imprime nel video (pesante). Con i sottotitoli di testo non succede.',
  "This device can't play the sound format (e.g. DTS, TrueHD, AC3), so only the sound is converted (light).":
    "Questo dispositivo non sa riprodurre il formato audio (ad es. DTS, TrueHD, AC3), quindi viene convertito solo l'audio (leggero).",
  'The sound has more channels than this device takes, so it is mixed down (light).':
    "L'audio ha più canali di quanti ne gestisca questo dispositivo, quindi viene mixato su meno canali (leggero).",
  'The sound bitrate is too high here, so it is converted (light).': "Il bitrate dell'audio è troppo alto qui, quindi viene convertito (leggero).",
  "The sound uses a profile this device can't play, so it is converted (light).":
    "L'audio usa un profilo che questo dispositivo non sa riprodurre, quindi viene convertito (leggero).",
  "The sound's sample rate isn't supported, so it is converted (light).":
    "La frequenza di campionamento dell'audio non è supportata, quindi l'audio viene convertito (leggero).",
  "The sound's bit depth isn't supported, so it is converted (light).":
    "La profondità di bit dell'audio non è supportata, quindi l'audio viene convertito (leggero).",
  'Another audio track was picked, so the file is rewrapped with that one (light).':
    "Hai scelto un'altra traccia audio, quindi il file viene reimpacchettato con quella (leggero).",
  'The chosen sound is a separate file, so it is mixed in (light).': "L'audio scelto è un file separato, quindi viene unito al video (leggero).",
  "This device couldn't play the file directly, so the server stepped in.":
    'Questo dispositivo non è riuscito a riprodurre il file direttamente, quindi è intervenuto il server.',
  "The server doesn't know enough about the video to send it as-is.": "Il server non ha abbastanza informazioni sul video per inviarlo così com'è.",
  "The server doesn't know enough about the sound to send it as-is.": "Il server non ha abbastanza informazioni sull'audio per inviarlo così com'è.",
  'The file has more tracks than this device handles, so it is rewrapped (light).':
    'Il file ha più tracce di quante ne gestisca questo dispositivo, quindi viene reimpacchettato (leggero).',
  'Server note: {reason}': 'Nota del server: {reason}',

  // Versions sheet
  'Any quality': 'Qualsiasi qualità',
  '{n} h': '{n} h',
  '{n} d': '{n} g',
  '{n} mo': '{n} mesi',
  'Sent to the downloader — follow it in Activity.': 'Download avviato: seguilo in Attività.',
  '{size}/ep': '{size}/ep.',
  'Over size limit': 'Oltre il limite',
  '{n} seeders': '{n} seeder',
  'Season pack': 'Pacchetto stagione',
  'MULTi · languages unknown': 'MULTi · lingue sconosciute',
  'Keeps {language}': 'Mantiene {language}',
  "Radarr/Sonarr wouldn't pick this automatically: {reasons}.": 'Radarr/Sonarr non la sceglierebbe in automatico: {reasons}.',
  rejected: 'scartata',
  'It may not replace your current {quality} (lower quality).': 'Potrebbe non sostituire la tua versione {quality} (qualità inferiore).',
  'It may not replace your current copy (lower quality).': 'Potrebbe non sostituire la tua copia attuale (qualità inferiore).',
  Sent: 'Inviato',
  Confirm: 'Conferma',
  Get: 'Scarica',
  'Whole season': 'Tutta la stagione',
  'Episode {n}': 'Episodio {n}',
  'In your library:': 'Nella tua libreria:',
  'unknown quality': 'qualità sconosciuta',
  'Audio language': 'Lingua audio',
  'Any language': 'Qualsiasi lingua',
  Quality: 'Qualità',
  Sort: 'Ordina',
  'Best match': 'Più pertinenti',
  'Most seeders': 'Più seeder',
  Largest: 'Più grandi',
  Smallest: 'Più piccole',
  Newest: 'Più recenti',
  Filter: 'Filtra',
  'e.g. remux, x265, group name': 'es. remux, x265, nome del gruppo',
  'Hide releases Radarr/Sonarr would skip': 'Nascondi le release che Radarr/Sonarr scarterebbero',
  'Include MULTi releases that might have {language}': 'Includi le release MULTi che potrebbero essere in {language}',
  'No release is tagged {language} yet.': 'Ancora nessuna release in {language}.',
  'Show releases over the size limit': 'Mostra le release oltre il limite di dimensione',
  '{n} release is hidden for being over the {limit} limit.': '{n} release è nascosta perché supera il limite di {limit}.',
  '{n} releases are hidden for being over the {limit} limit.': '{n} release sono nascoste perché superano il limite di {limit}.',
  '{n} release is hidden for being over the {limit} limit set by your admin.':
    '{n} release è nascosta perché supera il limite di {limit} impostato dal tuo amministratore.',
  '{n} releases are hidden for being over the {limit} limit set by your admin.':
    '{n} release sono nascoste perché superano il limite di {limit} impostato dal tuo amministratore.',
  '{size} per episode': '{size} per episodio',
  'Asking your indexers… this can take up to a minute.': 'Sto chiedendo ai tuoi indexer… può volerci fino a un minuto.',
  '{shown} of {total} releases': '{shown} di {total} release',
  'Search again': 'Cerca di nuovo',
  'Nothing matches these filters.': 'Nessun risultato con questi filtri.',
  'Might include {language} (MULTi)': 'Forse in {language} (MULTi)',

  // Subtitles sheet
  'Find subtitles': 'Trova sottotitoli',
  'Already available: {list}': 'Già disponibili: {list}',
  '{label} (forced)': '{label} (forzati)',
  'All in this season': 'Tutti in questa stagione',
  'Hearing-impaired (SDH) subtitles': 'Sottotitoli per non udenti (SDH)',
  'Bazarr searches your subtitle providers; Netfish refreshes the library when they arrive.':
    'Bazarr cerca tra i tuoi provider di sottotitoli; Netfish aggiorna la libreria quando arrivano.',
  '{done} of {total} searched…': '{done} di {total} cercati…',
} as Record<string, string>;
