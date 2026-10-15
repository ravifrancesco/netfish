[English](../mac.md)

# Mac

Per Mac con chip Apple (M1 o successivi), con macOS 15 Sequoia o versioni successive. Non serve installare altro: l'app ha il suo lettore incluso.

I film si riproducono con mpv sotto i controlli di Netfish, come in Jellyfin Media Player: ogni formato, ogni traccia audio e di sottotitoli, e il server invia i file così come sono.

1. Scarica **[Netfish-mac.dmg](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-mac.dmg)**, aprilo e trascina **Netfish** in **Applicazioni**.
2. **Primo avvio:** l'app non è ancora verificata da Apple, quindi la prima volta macOS la blocca ("Apple non può verificare…"). Clicca **Fine**, poi vai in **Impostazioni di Sistema → Privacy e sicurezza**, scorri in basso fino a *"Netfish" è stato bloccato* e clicca **Apri comunque** (di nuovo **Apri comunque** e la tua password). Sui macOS meno recenti funziona anche **clic destro** su Netfish → **Apri** → **Apri**.
3. Inserisci l'indirizzo del tuo server (per esempio `192.168.1.50`) e accedi.

L'app è in italiano quando la lingua del Mac è l'italiano.

**Download** per guardare offline: c'è il pulsante **Scarica** su ogni film ed episodio. Li trovi nel menu del profilo → **Download su questo computer** (⇧⌘D). Sono salvati in `~/Library/Application Support/app.netfish.mac`.

**Aggiornare:** dalla versione 0.3, Netfish ti avvisa nella Home quando esce una nuova versione: **Impostazioni → App desktop → Aggiorna** la scarica, la installa e riapre Netfish. Accesso e download restano. (Netfish deve essere nella cartella Applicazioni.) Versioni precedenti: scarica il nuovo DMG e sostituisci l'app. Dalla 0.4 lì puoi anche attivare **Aggiornamento automatico**: le nuove versioni si scaricano in background e si installano quando chiudi Netfish, senza interrompere quello che stai guardando.

**Problemi:**

- **"Netfish è danneggiato e non può essere aperto":** il browser ha segnato il file come non sicuro. Nel Terminale esegui `xattr -cr /Applications/Netfish.app` e riaprila.
- **"Non puoi usare questa versione dell'applicazione con questa versione di macOS":** Netfish richiede macOS 15 Sequoia o successivi.
- **L'app si chiude appena la apri:** manda il rapporto che mostra macOS (*Netfish si è chiuso inaspettatamente* → **Segnala…**, le prime 30 righe) aprendo una segnalazione su GitHub.
