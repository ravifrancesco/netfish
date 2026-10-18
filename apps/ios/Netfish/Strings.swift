import Foundation

/// The apps' own words (menus, alerts, error messages): Italian when it's your
/// first language, English otherwise. Everything else on screen is the Netfish
/// web interface, which translates itself. Keys are the exact English text;
/// `{name}` placeholders are filled from `values`, after translating, so the
/// Italian can put them where Italian needs them.
/// Compiled into both the iPhone/iPad app and the Mac app (apps/mac/build.sh).
func L(_ english: String, _ values: [String: String] = [:]) -> String {
    let italian = Locale.preferredLanguages.first?.lowercased().hasPrefix("it") == true
    let text = italian ? (Strings.italian[english] ?? english) : english
    return Strings.fill(text, values)
}

enum Strings {
    /// Same terms as docs/i18n-glossary.md (informal "tu").
    static let italian: [String: String] = [
        // Updating the Mac app
        "Couldn't check for updates": "Non riesco a controllare gli aggiornamenti",
        "This version can only be downloaded from its page.": "Questa versione si può scaricare solo dalla sua pagina.",
        "Netfish can't update itself here.": "Netfish non può aggiornarsi da qui.",
        "Move Netfish to your Applications folder, open it from there, then update.": "Sposta Netfish nella cartella Applicazioni, aprilo da lì e poi aggiorna.",
        "Netfish can't replace itself in that folder. Download the new version from its page instead.": "Netfish non può sostituirsi in quella cartella. Scarica la nuova versione dalla sua pagina.",
        "The download doesn't look like Netfish {version}.": "Il file scaricato non sembra Netfish {version}.",
        "The update couldn't be checked or unpacked.": "Non sono riuscito a verificare o aprire l’aggiornamento.",
        "Couldn't download the update": "Non riesco a scaricare l’aggiornamento",
        "Netfish is up to date": "Netfish è aggiornato",

        // Mac menus (standard macOS wording)
        "About Netfish": "Informazioni su Netfish",
        "Change Server…": "Cambia server…",
        "Hide Netfish": "Nascondi Netfish",
        "Hide Others": "Nascondi altre",
        "Show All": "Mostra tutte",
        "Quit Netfish": "Esci da Netfish",
        "Edit": "Modifica",
        "Undo": "Annulla",
        "Redo": "Ripeti",
        "Cut": "Taglia",
        "Copy": "Copia",
        "Paste": "Incolla",
        "Select All": "Seleziona tutto",
        "View": "Vista",
        "Reload": "Ricarica",
        // macOS renames this one itself (Attiva/Disattiva modalità a tutto schermo) once the menu opens.
        "Toggle Full Screen": "Attiva modalità a tutto schermo",
        "Go": "Vai",
        "Home": "Home",
        "Back": "Indietro",
        "Downloads": "Download",
        "Window": "Finestra",
        "Minimize": "Contrai",
        "Zoom": "Ridimensiona",

        // Alerts from the pages
        "OK": "OK",
        "Cancel": "Annulla",

        // Server address
        "Enter the address of your Netfish server": "Inserisci l'indirizzo del tuo server Netfish",
        "That doesn't look like an address": "Questo non sembra un indirizzo",
        "Can't reach {address} ({error})": "Impossibile raggiungere {address} ({error})",
        "{address} doesn't look like a Netfish server": "{address} non sembra un server Netfish",

        // Requests from the pages
        "Bad request": "Richiesta non valida",
        "Not allowed here": "Non consentito qui",
        "Unknown request": "Richiesta sconosciuta",
        "Nothing to play": "Niente da riprodurre",
        "This video couldn't play here": "Impossibile riprodurre questo video qui",
        "Not found": "Non trovato",

        // Downloads
        "HTTP error": "Errore HTTP",
        "The server didn't say what to download": "Il server non ha indicato cosa scaricare",
        "Not connected to a Netfish server": "Non sei connesso a un server Netfish",
        "Subtitles": "Sottotitoli",
        "Bad download address": "Indirizzo di download non valido",
        "Nothing to retry": "Niente da riprovare",
        "Sign in to Netfish again, then retry.": "Accedi di nuovo a Netfish, poi riprova.",
        "The server said no ({status}).": "Il server ha rifiutato la richiesta ({status}).",
        "Couldn't save the file: {error}": "Impossibile salvare il file: {error}",
        "The download stopped. Try again when you're on your home network.":
            "Il download si è interrotto. Riprova quando sei sulla rete di casa.",
    ]

    /// Puts `values` into the `{name}` slots in one pass (a value containing braces stays as it is).
    static func fill(_ template: String, _ values: [String: String]) -> String {
        guard !values.isEmpty else { return template }
        var result = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
            result += rest[..<open]
            let name = String(rest[rest.index(after: open)..<close])
            result += values[name] ?? String(rest[open...close])
            rest = rest[rest.index(after: close)...]
        }
        return result + rest
    }
}
