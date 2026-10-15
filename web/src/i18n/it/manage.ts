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
  'Everything in your library is on disk.': 'Tutto quello che c’è nella tua libreria è sul disco.',
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
  '{n} title is not on disk.': '{n} titolo non è sul disco.',
  '{n} titles are not on disk.': '{n} titoli non sono sul disco.',

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
} as Record<string, string>;
