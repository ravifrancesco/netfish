[English](../iphone-ipad.md)

# iPhone e iPad

Apple permette di installare su iPhone app che non vengono dall'App Store solo tramite un Mac, o con strumenti che fanno la stessa cosa. Scegli un metodo:

| | Web app nella schermata Home | Installazione con Xcode | AltStore / SideStore |
|---|---|---|---|
| Ti serve | Safari | Un Mac con Xcode e un cavo | Un computer la prima volta, poi niente |
| Costo | Gratis | Gratis (o 99 $/anno, vedi sotto) | Gratis |
| Durata | Per sempre | 7 giorni, poi ricolleghi e reinstalli | Si rinnova da sola ogni 7 giorni |
| Download per guardare offline | No | Sì | Sì |
| Picture in Picture, AirPlay | Sì | Sì | Sì |

In tutti e tre i casi i film si riproducono con il lettore di Apple. MP4 e HEVC partono così come sono; i file MKV vengono reimpacchettati al volo dal tuo server (un lavoro leggero) e l'audio DTS/TrueHD viene convertito.

<img src="../../screenshots/phone-it.jpg" alt="Netfish sul telefono" width="300">

## Opzione 1: Web app nella schermata Home (la più semplice)

1. Apri **Safari** e vai al tuo server, per esempio `http://192.168.1.50:7777`. Accedi.
2. Tocca il pulsante **Condividi** → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Apri Netfish dalla sua icona. Si apre a schermo intero, come un'app.

## Opzione 2: Installazione con Xcode (Apple ID gratuito)

Ti serve un Mac. La prima volta ci vogliono circa 30 minuti, soprattutto per scaricare Xcode. Xcode è solo in inglese, quindi i nomi dei suoi menu qui sotto restano in inglese.

1. **Scarica Xcode** dal Mac App Store. Aprilo una volta, accetta la licenza e lascia che installi i suoi componenti. Quando ti chiede quali piattaforme aggiungere, includi **iOS**.
2. **Aggiungi il tuo Apple ID:** Xcode → **Settings** → **Accounts** → **+** → **Apple ID**, e accedi.
3. **Scarica il progetto Netfish:** nella [pagina GitHub](https://github.com/ravifrancesco/netfish), clicca **Code → Download ZIP** ed estrai il file (oppure `git clone https://github.com/ravifrancesco/netfish`). Apri `apps/ios/Netfish.xcodeproj` con un doppio clic.
4. **Scegli il tuo team:**
   1. Nella barra laterale sinistra di Xcode, clicca l'icona blu **Netfish** in alto.
   2. Sotto **TARGETS**, clicca **Netfish**.
   3. Apri la scheda **Signing & Capabilities** e spunta **Automatically manage signing**.
   4. In **Team**, scegli **"Il tuo nome (Personal Team)"**.

   Se ti dice che il bundle identifier non è disponibile, cambia `app.netfish.ios` con qualcosa di tuo, tipo `com.yourname.netfish`.
5. **Collega l'iPhone** con un cavo, sbloccalo e tocca **Autorizza** quando ti chiede se autorizzare il computer.
6. **Attiva la Modalità sviluppatore sull'iPhone:** **Impostazioni → Privacy e sicurezza**, scorri fino in fondo, tocca **Modalità sviluppatore**, attivala e tocca **Riavvia**. Dopo il riavvio, sblocca l'iPhone e tocca **Attiva**.
   Se Modalità sviluppatore non c'è, lascia l'iPhone collegato e in Xcode apri **Window → Devices and Simulators** (⇧⌘2), così Xcode vede il telefono; poi riapri Impostazioni.
7. **Installa:** in alto nella finestra di Xcode, scegli il tuo iPhone come destinazione e clicca **▶ Run** (⌘R). La prima build richiede un minuto o due.
8. **Autorizza l'app:** la prima volta l'iPhone si rifiuta di aprirla. Vai in **Impostazioni → Generali → VPN e gestione dispositivi**, tocca il tuo Apple ID sotto *App sviluppatore* e tocca **Autorizza**.
9. Apri **Netfish**, permettile di trovare i dispositivi sulla tua **rete locale** e inserisci l'indirizzo del tuo server.

**Ogni 7 giorni** (con l'Apple ID gratuito) l'app smette di aprirsi. Collega l'iPhone e premi di nuovo **▶ Run** in Xcode; download e accesso restano. Un [account Apple Developer](https://developer.apple.com/programs/) a pagamento (99 $/anno) fa durare ogni installazione un anno e ti permette di usare TestFlight invece del cavo.

## Opzione 3: AltStore o SideStore

[AltStore](https://altstore.io) e [SideStore](https://sidestore.io) sono strumenti gratuiti della community che installano app con il tuo Apple ID e le rinnovano da soli, così non devi reinstallare ogni settimana. Non sono fatti da Apple né da Netfish.

1. Configura AltStore (serve un computer con AltServer sulla tua rete Wi-Fi) o SideStore (dopo la configurazione funziona solo con il telefono) seguendo le loro guide.
2. Sull'iPhone, scarica **[Netfish-ios.ipa](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-ios.ipa)**.
3. Aprilo con AltStore/SideStore (Condividi → AltStore/SideStore, oppure **+** nell'app e scegli il file). L'app firma e installa Netfish.
4. Se te lo chiede, segui i passaggi 6, 8 e 9 dell'opzione 2 (Modalità sviluppatore, Autorizza, indirizzo del server).

## Problemi

- **"Impossibile verificare l'app" / "Sviluppatore non autorizzato":** segui il passaggio 8 dell'opzione 2.
- **L'app si apre ma non raggiunge il server:** controlla che **Impostazioni → Netfish → Rete locale** sia attivo e che l'iPhone sia sulla stessa rete Wi-Fi del server.
- **L'app non si apre più dopo una settimana:** i 7 giorni dell'Apple ID gratuito sono finiti. Reinstallala (opzione 2, passaggio 7) oppure usa l'opzione 3.
