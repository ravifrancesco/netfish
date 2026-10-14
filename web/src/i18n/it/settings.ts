// Italian for Settings, the Connections panel and per-device preferences.
export default {
  // Streaming quality
  'Best available (home network)': 'Migliore disponibile (rete di casa)',
  '3 Mbps (mobile data)': '3 Mbps (dati mobili)',

  // Downloads in the apps
  '{n} download · {size} on {device}': '{n} download · {size} su {device}',
  '{n} downloads · {size} on {device}': '{n} download · {size} su {device}',
  'Nothing downloaded on {device}': 'Nessun download su {device}',
  'Delete every download from {device}?': 'Eliminare tutti i download da {device}?',
  'Delete all': 'Elimina tutto',

  // Download rules
  'Download rules saved.': 'Regole di download salvate.',
  'Who can pick specific versions': 'Chi può scegliere versioni specifiche',
  Everyone: 'Tutti',
  'Admins only': 'Solo amministratori',
  'Max size for a movie': 'Dimensione massima per un film',
  'Max size per episode': 'Dimensione massima per episodio',
  'No limit': 'Nessun limite',
  "Releases over these sizes are hidden in Versions and can't be downloaded from Netfish. Season packs count per episode (a 10-episode pack under a 2 GB limit can be up to 20 GB). Admins can still show and pick them. Automatic downloads from requests follow Radarr/Sonarr's own size settings.":
    'Le release più grandi di così sono nascoste in Versioni e non si possono scaricare da Netfish. I pacchetti stagione contano per episodio (un pacchetto da 10 episodi con un limite di 2 GB può arrivare a 20 GB). Gli amministratori possono comunque mostrarle e sceglierle. I download automatici delle richieste seguono le impostazioni di dimensione di Radarr/Sonarr.',

  // Page
  Account: 'Account',
  '{role} · signed in with your Jellyfin account': '{role} · accesso con il tuo account Jellyfin',
  Administrator: 'Amministratore',
  Member: 'Membro',
  "Automatic follows this device's language. Changing it reloads the page.":
    'Automatica segue la lingua di questo dispositivo. Se la cambi, la pagina si ricarica.',
  'Playback on this device': 'Riproduzione su questo dispositivo',
  'Streaming quality': 'Qualità dello streaming',
  'Lower it when watching away from home. Anything the Pi has to shrink costs it CPU.':
    'Abbassala quando guardi fuori casa. Ogni riduzione che il Pi deve fare gli costa CPU.',
  'Preferred audio language': 'Lingua audio preferita',
  'Original / file default': 'Originale / predefinita del file',
  'Turn subtitles on automatically': 'Attiva i sottotitoli automaticamente',
  'Subtitle language': 'Lingua dei sottotitoli',
  'Play the next episode automatically': 'Riproduci automaticamente il prossimo episodio',
  'Change server…': 'Cambia server…',
  Connections: 'Connessioni',
  "Where Netfish finds your other services. Saved here, these take over from the Portainer stack's variables and apply right away.":
    'Dove Netfish trova gli altri tuoi servizi. Se le salvi qui, sostituiscono le variabili dello stack Portainer e valgono subito.',

  // Connections
  'Show the key': 'Mostra la chiave',
  'Hide the key': 'Nascondi la chiave',
  '{name} saved and connected.': '{name} salvato e connesso.',
  '{name} saved, but: {error}': '{name} salvato, ma: {error}',
  "{name} is back to the stack's settings.": '{name} è tornato alle impostazioni dello stack.',
  'Not connected': 'Non connesso',
  Connected: 'Connesso',
  required: 'obbligatorio',
  Address: 'Indirizzo',
  'API key': 'Chiave API',
  'Saved ({hint}). Type to replace': 'Salvata ({hint}). Scrivi per sostituirla',
  'Paste the API key': 'Incolla la chiave API',
  Username: 'Nome utente',
  Password: 'Password',
  'Saved. Type to replace': 'Salvata. Scrivi per sostituirla',
  Test: 'Prova',
  'Remove key': 'Rimuovi chiave',
  "Forget what was saved here and use the Portainer stack's variables": 'Dimentica quanto salvato qui e usa le variabili dello stack Portainer',
  'Use stack settings': 'Usa le impostazioni dello stack',
  'Saved in Netfish': 'Salvato in Netfish',
  'From the stack': 'Dallo stack',
  'Not set': 'Non impostato',
  'Paste the {label}': 'Incolla il {label}',

  // Trakt
  'Trakt is linked to {name}.': 'Trakt è collegato a {name}.',
  'Trakt account': 'Account Trakt',
  'On any phone or computer, open trakt.tv/activate, sign in to the account Netfish should use, and enter this code:':
    'Da qualsiasi telefono o computer apri trakt.tv/activate, accedi con l’account che Netfish deve usare e inserisci questo codice:',
  'Waiting for Trakt…': 'In attesa di Trakt…',
  "Link one Trakt account for the whole server: what anyone watches is added to it, and its recommendations appear on everyone's Home.":
    'Collega un solo account Trakt per tutto il server: quello che chiunque guarda viene aggiunto lì, e i suoi consigli compaiono nella Home di tutti.',
  'New code': 'Nuovo codice',
  'Link Trakt account': 'Collega account Trakt',
  'Linked to {name}': 'Collegato a {name}',
  'Add what everyone watches to Trakt': 'Aggiungi a Trakt quello che guardano tutti',
  'Last sent: {title}, {when}': 'Ultimo invio: {title}, {when}',
  'Watch history': 'Cronologia di visione',
  'Adds everything already watched in Jellyfin, by everyone, so recommendations start from the whole history. Titles Trakt already has are skipped.':
    'Aggiunge tutto quello che è già stato guardato su Jellyfin, da chiunque, così i consigli partono da tutta la cronologia. I titoli che Trakt ha già vengono saltati.',
  'Importing…': 'Importazione…',
  'Added {n}': 'Aggiunti {n}',
  '{n} already there': '{n} già presenti',
  "{n} Trakt didn't know": '{n} sconosciuti a Trakt',
  Import: 'Importa',
  'Unlink {name}? Trakt keeps its history.': 'Scollegare {name}? Trakt conserva la sua cronologia.',
  Unlink: 'Scollega',
} as Record<string, string>;
