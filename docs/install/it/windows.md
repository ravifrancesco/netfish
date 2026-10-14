[English](../windows.md)

# Windows

Per Windows 10 e 11 a 64 bit.

I film si riproducono con mpv sotto i controlli di Netfish, come in Jellyfin Media Player: ogni formato, ogni traccia audio e di sottotitoli, e il server invia i file così come sono.

1. Scarica **[Netfish-windows.exe](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-windows.exe)** e avvialo.
2. Il programma di installazione non è ancora firmato, quindi Windows potrebbe mostrare **Windows ha protetto il PC**: clicca **Ulteriori informazioni → Esegui comunque**.
3. Netfish si installa solo per il tuo account (senza diritti di amministratore), si aggiunge al menu Start e al desktop, e ti propone di aprirlo.
4. Inserisci l'indirizzo del tuo server (per esempio `192.168.1.50`) e accedi.

**Tasti:** F11 schermo intero, Ctrl+Shift+H Home, Ctrl+Shift+D Download, e nel lettore Space, ←/→ e F.

**Download** per guardare offline: c'è il pulsante **Scarica** su ogni film ed episodio. I file vengono salvati esattamente come sono sul server (nessuna conversione), in `%LOCALAPPDATA%\Netfish\Offline`. I download interrotti ripartono da dove si erano fermati.

**Aggiornare:** avvia il nuovo programma di installazione; sostituisce l'app e mantiene accesso e download.

**Disinstallare:** Impostazioni → App → Netfish → Disinstalla. Ti chiede se eliminare anche i download.

**Problemi:**

- **"Netfish ha bisogno di Microsoft Edge WebView2":** clicca Sì per aprire la pagina di download di Microsoft e installa il runtime *Evergreen* (Windows 11 e Windows 10 aggiornato ce l'hanno già).
- **"Impossibile caricare il lettore video di Netfish":** reinstalla Netfish. In una macchina virtuale, attiva l'accelerazione 3D, altrimenti il video potrebbe non vedersi.
