global using static Netfish.Strings;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Netfish;

/// <summary>
/// The app's own words (message boxes, and the errors the setup and downloads pages show) in
/// Windows' display language: Italian, else English. The web interface translates itself.
/// </summary>
static class Strings
{
    /// <summary>
    /// Windows' display language, like "it-IT" (also handed to the web view). The app runs with
    /// invariant globalization, where CultureInfo always says invariant, so Windows is asked directly.
    /// </summary>
    public static readonly string Language = DisplayLanguage();

    static readonly bool InItalian = Language.Split('-')[0].Equals("it", StringComparison.OrdinalIgnoreCase);

    /// <summary>The text in the app's language. <c>{name}</c> placeholders are filled from <paramref name="values"/>.</summary>
    public static string L(string english, params (string Name, object? Value)[] values)
    {
        var text = InItalian && Italian.TryGetValue(english, out var italian) ? italian : english;
        if (values.Length == 0) return text;
        return Regex.Replace(text, @"\{(\w+)\}", m =>
        {
            foreach (var (name, value) in values)
                if (name == m.Groups[1].Value) return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
            return m.Value;
        });
    }

    static string DisplayLanguage()
    {
        if (CultureInfo.CurrentUICulture.Name is { Length: > 0 } name) return name;
        try
        {
            var buffer = new char[85]; // LOCALE_NAME_MAX_LENGTH
            var length = Native.LCIDToLocaleName(Native.GetUserDefaultUILanguage(), buffer, buffer.Length, 0);
            if (length > 1) return new string(buffer, 0, length - 1);
        }
        catch { /* not on Windows */ }
        return "en-US";
    }

    static readonly Dictionary<string, string> Italian = new()
    {
        // Updating
        ["Couldn't check for updates"] = "Non riesco a controllare gli aggiornamenti",
        ["This version can only be downloaded from its page."] = "Questa versione si può scaricare solo dalla sua pagina.",
        ["Couldn't download the update"] = "Non riesco a scaricare l'aggiornamento",
        ["The download doesn't look like Netfish {version}."] = "Il file scaricato non sembra Netfish {version}.",
        ["Netfish is up to date"] = "Netfish è aggiornato",

        // Starting up
        ["Netfish needs Microsoft Edge WebView2, which isn't on this PC yet. Open the download page?"] =
            "Netfish ha bisogno di Microsoft Edge WebView2, che non è ancora installato su questo PC. Vuoi aprire la pagina per scaricarlo?",
        ["Netfish's video player (libmpv-2.dll, with vulkan-1.dll beside it) couldn't load. Reinstalling Netfish usually fixes this.\n\n{problem}"] =
            "Impossibile caricare il lettore video di Netfish (libmpv-2.dll, con vulkan-1.dll accanto). Di solito basta reinstallare Netfish.\n\n{problem}",
        ["Netfish couldn't start: {error}"] = "Impossibile avviare Netfish: {error}",
        ["Netfish's window stopped working ({error}). Please open Netfish again."] = "La finestra di Netfish ha smesso di funzionare ({error}). Riapri Netfish.",
        ["mpv didn't start"] = "mpv non si è avviato",

        // The server
        ["Enter the address of your Netfish server"] = "Inserisci l'indirizzo del tuo server Netfish",
        ["That doesn't look like an address"] = "Non sembra un indirizzo",
        ["Can't reach {server} ({why})"] = "Impossibile raggiungere {server} ({why})",
        ["no answer"] = "nessuna risposta",
        ["{server} doesn't look like a Netfish server"] = "{server} non sembra un server Netfish",
        ["Not allowed here"] = "Non consentito qui",
        ["Not connected to a Netfish server"] = "Non sei connesso a un server Netfish",
        ["Unknown request"] = "Richiesta sconosciuta",

        // Playing
        ["Nothing to play"] = "Niente da riprodurre",
        ["This download isn't on this computer any more"] = "Questo download non è più su questo computer",
        ["mpv couldn't play this"] = "mpv non riesce a riprodurre questo file",

        // Downloads
        ["The server didn't say what to download"] = "Il server non ha indicato cosa scaricare",
        ["Nothing to retry"] = "Niente da riprovare",
        ["The download stopped. Try again when you're on your home network."] = "Il download si è interrotto. Riprova quando sei sulla rete di casa.",
        ["Couldn't save the file: {error}"] = "Impossibile salvare il file: {error}",
        ["Sign in to Netfish again, then retry."] = "Accedi di nuovo a Netfish, poi riprova.",
        ["Your account isn't allowed to download."] = "Il tuo account non può scaricare.",
        ["The server said no ({status})."] = "Il server ha rifiutato ({status}).",
        ["Subtitles"] = "Sottotitoli",
    };
}
