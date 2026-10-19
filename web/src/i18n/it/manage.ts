// Italian for managing what's on disk: stopping downloads, deleting files, storage.
export default {
  // Stopping a download
  'Looking for another release of {title}.': 'Cerco un’altra versione di {title}.',
  'Stopped {title}.': '{title} fermato.',
  'Stop download': 'Ferma download',
  Stop: 'Ferma',
  'Stop downloading {title}?': 'Fermare il download di {title}?',
  'Try another release': 'Prova un’altra versione',
  'Throws this one away and looks for a different copy by itself. Good when it is stuck or looks wrong.':
    'Scarta questa e ne cerca da solo un’altra. Utile quando è bloccata o sembra sbagliata.',
  'Stop for good': 'Ferma del tutto',
  'Cancels the download and stops looking for it. It can be requested again later.':
    'Annulla il download e smette di cercarlo. Potrai richiederlo di nuovo più avanti.',
  'Cancels the download and stops looking for these episodes.': 'Annulla il download e smette di cercare questi episodi.',

  // Deleting from disk, and getting it back
  'Deleted from disk: {size} freed.': 'Eliminato dal disco: liberati {size}.',
  'Delete from disk': 'Elimina dal disco',
  'Delete {title} from disk?': 'Eliminare {title} dal disco?',
  'Delete {size}': 'Elimina {size}',
  Specials: 'Speciali',
  'Season {n}': 'Stagione {n}',
  'The episodes are deleted from your server. The show stays in your library, and you can download them again any time.':
    'Gli episodi vengono eliminati dal server. La serie resta nella tua libreria e puoi riscaricarli quando vuoi.',
  'The file is deleted from your server. The movie stays in your library as Not on disk, and you can download it again any time.':
    'Il file viene eliminato dal server. Il film resta nella tua libreria come Non sul disco e puoi riscaricarlo quando vuoi.',
  'Looking for {title} again.': 'Cerco di nuovo {title}.',
  'Download again': 'Scarica di nuovo',
  '{seasons} deleted from disk {when}': '{seasons} eliminate dal disco {when}',
  'Deleted from disk {when}': 'Eliminato dal disco {when}',
  '{size} freed': 'liberati {size}',
  'Not on disk': 'Non sul disco',
  'Request it to download it again.': 'Richiedilo per scaricarlo di nuovo.',
  'An admin can download it again.': 'Un amministratore può scaricarlo di nuovo.',
  'Deleted from disk to save space. Open one to download it again.': 'Eliminati dal disco per fare spazio. Aprine uno per scaricarlo di nuovo.',

  // Settings → Storage
  Storage: 'Spazio su disco',
  'Movies and shows': 'Film e serie TV',
  '{free} free of {total}': '{free} liberi su {total}',
  "Radarr and Sonarr didn't report any disks.": 'Radarr e Sonarr non hanno indicato nessun disco.',
  'Movies: {count} · {size}': 'Film: {count} · {size}',
  'Shows: {count} · {size}': 'Serie TV: {count} · {size}',
  'Biggest on disk': 'I più grandi sul disco',
  'Deleting frees the space but keeps the title in your library as Not on disk, ready to download again.':
    'Eliminare libera spazio ma tiene il titolo nella tua libreria come Non sul disco, pronto da riscaricare.',
  '{n} film is not on disk.': '{n} film non è sul disco.',
  '{n} films are not on disk.': '{n} film non sono sul disco.',
  '{n} show is not on disk.': '{n} serie non è sul disco.',
  '{n} shows are not on disk.': '{n} serie non sono sul disco.',

  // Clean-up suggestions
  'Everyone finished it · last watched a month ago': 'Finito da tutti · visto l’ultima volta un mese fa',
  'Everyone finished it · last watched {n} months ago': 'Finito da tutti · visto l’ultima volta {n} mesi fa',
  'Nobody has watched it · arrived a month ago': 'Nessuno l’ha guardato · arrivato un mese fa',
  'Nobody has watched it · arrived {n} months ago': 'Nessuno l’ha guardato · arrivato {n} mesi fa',
  'Could go to free space': 'Si potrebbe eliminare per fare spazio',
  Delete: 'Elimina',
  "Don't suggest it again": 'Non suggerirlo più',
  Keep: 'Tieni',
  'Delete {n} title from disk?': 'Eliminare {n} titolo dal disco?',
  'Delete {n} titles from disk?': 'Eliminare {n} titoli dal disco?',
  'They stay in your library as Not on disk, and you can download any of them again.':
    'Restano nella tua libreria come Non sul disco e puoi riscaricarli quando vuoi.',

  // Who's watching? (profiles on a device)
  'PIN saved.': 'PIN salvato.',
  'PIN removed.': 'PIN rimosso.',
  you: 'tu',
  'Watched · mark as unwatched': 'Visto · segna come non visto',

  // Taking a request back
  'Cancel request': 'Annulla richiesta',
  'Cancel the request for {title}?': 'Annullare la richiesta di {title}?',
  'Keep it': 'Mantienila',
  'Request cancelled.': 'Richiesta annullata.',
  "Radarr and Sonarr stop looking for it, and it's no longer requested. You can request it again any time.":
    'Radarr e Sonarr smettono di cercarlo e non risulta più richiesto. Puoi richiederlo di nuovo quando vuoi.',

  // The round download button on a title's page
  'Downloaded to {device}': 'Scaricato su {device}',
  'Download deleted from {device}.': 'Download eliminato da {device}.',
  'Download cancelled.': 'Download annullato.',
  'Play the download': 'Riproduci il download',
  'Delete the download': 'Elimina il download',
  'Show downloads': 'Mostra i download',
  'Delete the download of {title}?': 'Eliminare il download di {title}?',
  'Only the copy on {device} goes; the film stays on your server.': 'Viene eliminata solo la copia su {device}; il film resta sul tuo server.',
  'Locked with a PIN': 'Bloccato con un PIN',
  'Sign {name} out on this device?': 'Disconnettere {name} da questo dispositivo?',
  Remove: 'Rimuovi',
  'New PIN (4 digits)': 'Nuovo PIN (4 cifre)',
  'Save PIN': 'Salva PIN',
  'Your profile is locked with a PIN on this device.': 'Il tuo profilo è bloccato con un PIN su questo dispositivo.',
  'Lock your profile with a PIN, so nobody else here can switch to it.': 'Blocca il tuo profilo con un PIN, così nessun altro qui può passarci.',
  'Change PIN': 'Cambia PIN',
  'Set a PIN': 'Imposta un PIN',
  'Remove PIN': 'Rimuovi PIN',
  "Ask who's watching when Netfish opens (with two or more profiles)": 'Chiedi chi guarda quando si apre Netfish (con due o più profili)',
  'Switch profile': 'Cambia profilo',
  "Enter {name}'s PIN": 'Inserisci il PIN di {name}',
  '{n} of 4 digits': '{n} di 4 cifre',
  'Delete a digit': 'Cancella una cifra',
  "Who's watching?": 'Chi guarda?',
  'Add profile': 'Aggiungi profilo',
  'Add a profile: sign in with another Jellyfin account.': 'Aggiungi un profilo: accedi con un altro account Jellyfin.',
  '{name}, sign in again: this device’s sign-in has run out.': '{name}, accedi di nuovo: l’accesso su questo dispositivo è scaduto.',
  "Back to who's watching": 'Torna a chi guarda',
  'Profiles on this device': 'Profili su questo dispositivo',

  // Ready to watch
  'Ready to watch': 'Pronti da guardare',
  '{title} is ready to watch.': '{title} è pronto da guardare.',
  'Notify me when something I asked for is ready to watch': 'Avvisami quando qualcosa che ho richiesto è pronto da guardare',

  // Updating the Mac and Windows apps
  'Restarting Netfish…': 'Riavvio Netfish…',
  'Downloading the update… {percent}': 'Scarico l’aggiornamento… {percent}',
  'Checking for updates…': 'Controllo gli aggiornamenti…',
  'Netfish {version} is available': 'È disponibile Netfish {version}',
  'Netfish is up to date': 'Netfish è aggiornato',
  "What's new": 'Novità',
  Update: 'Aggiorna',
  'Download page': 'Pagina di download',
  'Check again': 'Controlla di nuovo',
  'Netfish {version} is available for this computer.': 'È disponibile Netfish {version} per questo computer.',
  'Netfish {version} is ready and installs when you quit Netfish.': 'Netfish {version} è pronto e si installa quando chiudi Netfish.',
  'Restart now': 'Riavvia ora',
  'Auto-update': 'Aggiornamento automatico',
  'New versions download in the background and install when you quit Netfish.':
    'Le nuove versioni si scaricano in background e si installano quando chiudi Netfish.',
  'Auto-update failed: {problem}': 'Aggiornamento automatico non riuscito: {problem}',
} as Record<string, string>;
