[English](../samsung-tv.md)

# TV Samsung

Netfish funziona sulle TV Samsung del **2022 o più recenti** (Tizen 6.5 e successivi). Sulle TV più vecchie l'app si apre, ma ti avvisa che il browser della TV è troppo vecchio.

Samsung permette di installare app che non vengono dal suo store solo in **Modalità sviluppatore**, con un computer sulla stessa rete. Basta farlo una volta: dopo, Netfish si aggiorna da solo tramite il tuo server, tranne nei rari casi in cui esce una nuova versione dell'app.

Come funziona: l'app Netfish sulla TV è un piccolo programma di avvio. Ti chiede una volta l'indirizzo del tuo server, poi apre Netfish in modalità TV. I film si riproducono con il lettore della TV, che gestisce da solo MKV, HEVC e l'audio Dolby, quindi il tuo server invia semplicemente il file.

**Ti servono:** la TV e un computer (Mac, Windows o Linux) sulla stessa rete, e il file **[Netfish-samsung.wgt](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-samsung.wgt)** scaricato sul computer.

![Netfish in modalità TV](../../screenshots/tv-it.jpg)

## Passaggio 1: Modalità sviluppatore sulla TV (per tutti e due i metodi)

1. Trova l'indirizzo del computer:
   - **Mac:** Impostazioni di Sistema → Wi-Fi (o Rete) → Dettagli → Indirizzo IP.
   - **Windows:** Impostazioni → Rete e Internet → la tua connessione → Indirizzo IPv4.
2. Sulla TV, apri **App** (il pannello App dal menu Home).
3. Con il telecomando, digita **1 2 3 4 5**. Sui telecomandi senza numeri, usa il tastierino che compare sullo schermo. Si apre la finestra *Modalità sviluppatore*.
4. Imposta **Modalità sviluppatore** su **On**, inserisci l'indirizzo del computer come IP del PC host (**Host PC IP**) e premi **OK**.
5. Riavvia la TV: tieni premuto il tasto di accensione finché non ricompare il logo Samsung.

Se la finestra non si apre, controlla di aver fatto l'accesso a un account Samsung sulla TV e di essere proprio nel pannello App (non nella barra Home).

## Passaggio 2, metodo A: TizenBrew Installer (più facile)

[TizenBrew](https://github.com/reisxd/TizenBrew) è uno strumento gratuito della community che installa app sulle TV Samsung senza il software per sviluppatori di Samsung. Non è fatto da Samsung né da Netfish.

1. Scarica **TizenBrew Installer Desktop** per il tuo computer dalla sua [pagina delle release](https://github.com/reisxd/TizenBrewInstaller/releases). Su Mac o Linux potresti dover dare il permesso per avviarlo (Mac: clic destro → Apri).
2. Aprilo. Trova la TV da solo (la TV deve essere in Modalità sviluppatore con l'indirizzo del tuo computer, passaggio 1).
3. Sulle TV con Tizen 7 o successivo (dal 2023 in poi) ti chiede di accedere con un account Samsung, che usa per creare il certificato richiesto da Samsung. È normale.
4. Scegli di installare un'app da file (WGT), seleziona **Netfish-samsung.wgt** e installa.
5. Netfish compare in **App** sulla TV. Aprilo e inserisci l'indirizzo del tuo server.

Se l'installer non riesce a installare il file, usa il metodo B: funziona sempre.

## Passaggio 2, metodo B: Tizen Studio (gli strumenti ufficiali di Samsung)

Tizen Studio è solo in inglese, quindi i nomi dei suoi menu qui sotto restano in inglese.

1. Installa **[Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)** (la versione con l'IDE è la più semplice).
2. Apri **Package Manager** (dal menu Tools di Tizen Studio o dalla sua cartella di installazione). In **Extension SDK**, installa **Samsung Certificate Extension** e **TV Extensions** (una versione qualsiasi).
3. **Collegati alla TV:** Tools → **Device Manager** → **Remote Device Manager** → **+**, inserisci l'indirizzo della TV (sulla TV: Impostazioni → Generale → Rete → Stato della rete → Impostazioni IP) e attiva **Connection**. La TV compare in Device Manager.
4. **Crea un certificato Samsung** (Samsung ne vuole uno per ogni TV): Tools → **Certificate Manager** → **+** → **Samsung** → **TV** → chiamalo `Netfish`.
   - Author certificate: creane uno nuovo (nome e password a piacere) e accedi con il tuo account Samsung quando te lo chiede.
   - Distributor certificate: privilegio **Public**. Il **DUID** della tua TV viene inserito in automatico perché la TV è collegata; se non c'è, aggiungilo da Device Manager.
5. **Firma e installa** da un terminale (Mac: Terminale; Windows: Prompt dei comandi). Il comando `tizen` si trova nella cartella `tools/ide/bin` di Tizen Studio:
   ```bash
   mkdir netfish && cd netfish
   unzip ../Netfish-samsung.wgt
   tizen package -t wgt -s Netfish -- .
   sdb devices
   tizen install -n Netfish.wgt -t <TV name shown by sdb devices> -- .
   ```
   Al posto di `<TV name shown by sdb devices>` metti il nome della TV mostrato da `sdb devices`. Su Windows, per estrarre il `.wgt` rinominalo prima in `.zip`.
6. Netfish compare in **App** sulla TV. Aprilo e inserisci l'indirizzo del tuo server.

## Come si usa

- Con le **frecce** ti sposti, **OK** seleziona, **Indietro** chiude i menu e torna indietro; Indietro nella Home di Netfish chiude l'app.
- **Riproduci/Pausa** e gli altri tasti multimediali funzionano nel lettore.
- Per passare a un altro server, premi **▲** mentre all'avvio compare "Apertura di Netfish su …".
- Dopo puoi disattivare di nuovo la Modalità sviluppatore: Netfish resta installato.

## Aggiornare

La maggior parte degli aggiornamenti arriva tramite il tuo server. Quando una nuova release indica un nuovo **Netfish-samsung.wgt**, installalo di nuovo allo stesso modo (passaggio 2). L'indirizzo del server resta salvato.

## Problemi

- **"Impossibile raggiungere …":** controlla l'indirizzo (provalo in un browser sul telefono) e che la TV e il server siano sulla stessa rete.
- **Installazione rifiutata / errore di certificato:** il certificato deve essere creato per *questa* TV (il suo DUID). Ricrea il distributor certificate con la TV collegata.
- **"Il browser di questa TV è più vecchio di quanto serve a Netfish":** la TV è precedente al 2022. **Prova comunque** può funzionare in parte; per quella TV è meglio usare un computer o una Fire TV Stick.
