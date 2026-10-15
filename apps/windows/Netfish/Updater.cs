using System.Diagnostics;
using System.Text.Json;

namespace Netfish;

/// <summary>
/// Updates the Windows app from GitHub Releases: the newest release's installer is
/// downloaded and started silently with /UPDATE, and Netfish quits. The installer closes
/// anything still running, installs over the old version (settings and downloads stay) and
/// opens Netfish again. Files an app downloads itself carry no "from the internet" mark, so
/// SmartScreen doesn't stop the installer.
/// </summary>
static class Updater
{
    const string Repository = "ravifrancesco/netfish";

    public sealed record Release(string Version, string? Download, string? Page);

    static readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(10) };

    static Updater()
    {
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"Netfish/{MainWindow.Version}");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
    }

    /// <summary>The newest release when it's newer than this app, null when this is the newest.</summary>
    public static async Task<Release?> Check()
    {
        using var response = await http.GetAsync($"https://api.github.com/repos/{Repository}/releases/latest");
        if (!response.IsSuccessStatusCode) throw new Problem(L("Couldn't check for updates"));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        var version = (root.GetProperty("tag_name").GetString() ?? "").TrimStart('v', 'V');
        if (!Newer(version, MainWindow.Version)) return null;
        string? installer = null;
        if (root.TryGetProperty("assets", out var assets))
            foreach (var asset in assets.EnumerateArray())
                if (asset.GetProperty("name").GetString() == "Netfish-windows.exe")
                    installer = asset.GetProperty("browser_download_url").GetString();
        var page = root.TryGetProperty("html_url", out var url) ? url.GetString() : null;
        return new Release(version, installer, page);
    }

    public static bool Newer(string a, string b)
    {
        static int[] Parts(string v) => v.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        var (x, y) = (Parts(a), Parts(b));
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var (l, r) = (i < x.Length ? x[i] : 0, i < y.Length ? y[i] : 0);
            if (l != r) return l > r;
        }
        return false;
    }

    /// <summary>Downloads the installer and checks it's a Windows program; returns where it is.</summary>
    public static async Task<string> Prepare(Release release, Action<long, long> progress)
    {
        if (release.Download is not { } download) throw new Problem(L("This version can only be downloaded from its page."));
        var folder = Path.Combine(Path.GetTempPath(), "netfish-update");
        Directory.CreateDirectory(folder);
        var installer = Path.Combine(folder, $"Netfish-{release.Version}-setup.exe");

        using (var response = await http.GetAsync(download, HttpCompletionOption.ResponseHeadersRead))
        {
            if (!response.IsSuccessStatusCode) throw new Problem(L("Couldn't download the update"));
            var total = response.Content.Headers.ContentLength ?? 0;
            await using var source = await response.Content.ReadAsStreamAsync();
            await using var file = File.Create(installer);
            var buffer = new byte[1 << 16];
            long received = 0, reported = 0;
            int read;
            while ((read = await source.ReadAsync(buffer)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, read));
                received += read;
                if (received - reported > 512 * 1024 || received == total)
                {
                    reported = received;
                    progress(received, total);
                }
            }
        }

        // A Windows program starts with "MZ"; anything else (an error page…) isn't run.
        await using (var check = File.OpenRead(installer))
        {
            var head = new byte[2];
            if (check.Length < 1_000_000 || await check.ReadAsync(head) != 2 || head[0] != 'M' || head[1] != 'Z')
                throw new Problem(L("The download doesn't look like Netfish {version}.", ("version", release.Version)));
        }
        return installer;
    }

    /// <summary>
    /// Starts the installer silently. With reopen it opens Netfish again when done (/UPDATE);
    /// the caller quits either way, and the installer waits for Netfish to close.
    /// </summary>
    public static void Start(string installer, bool reopen) =>
        Process.Start(new ProcessStartInfo(installer, reopen ? "/S /UPDATE" : "/S") { UseShellExecute = true });

    /// <summary>Updates now: uses the copy that's already waiting, or downloads it; then the caller quits.</summary>
    public static async Task Install(Release release, Action<long, long> progress)
    {
        var installer = AutoUpdate.Take(release.Version) ?? await Prepare(release, progress);
        Start(installer, reopen: true);
    }
}

/// <summary>
/// "Update Netfish by itself": a check soon after opening and every six hours; a newer
/// version is downloaded in the background and installed when Netfish closes (it's there
/// the next time Netfish opens), so nothing is ever interrupted.
/// </summary>
static class AutoUpdate
{
    static readonly System.Windows.Forms.Timer timer = new() { Interval = 6 * 3600 * 1000 };
    static bool busy;

    /// <summary>The version waiting for Netfish to close, and its installer.</summary>
    public static (string Version, string Installer)? Staged { get; private set; }
    /// <summary>Why the last try didn't work (shown in Settings).</summary>
    public static string? Problem { get; private set; }

    static AutoUpdate() => timer.Tick += async (_, _) => await Run();

    public static bool On
    {
        get => (bool?)AppData.Config()["autoUpdate"] == true;
        set
        {
            AppData.SaveConfig(c => c["autoUpdate"] = value);
            if (value) Start(TimeSpan.FromSeconds(1));
            else Stop();
        }
    }

    /// <summary>Call on the window's thread.</summary>
    public static async void Start(TimeSpan delay)
    {
        if (!On || timer.Enabled) return;
        timer.Start();
        await Task.Delay(delay);
        await Run();
    }

    static void Stop()
    {
        timer.Stop();
        Problem = null;
        Discard();
    }

    static void Discard()
    {
        if (Staged is { } old) try { File.Delete(old.Installer); } catch { }
        Staged = null;
    }

    static async Task Run()
    {
        if (!On || busy) return;
        busy = true;
        try
        {
            if (await Updater.Check() is not { Download: not null } release || release.Version == Staged?.Version) return;
            var installer = await Updater.Prepare(release, (_, _) => { });
            if (!On) return; // turned off while it downloaded
            Staged = (release.Version, installer);
            Problem = null;
        }
        catch (Exception e)
        {
            Problem = e.Message;
        }
        finally
        {
            busy = false;
        }
    }

    /// <summary>Updating now instead: the waiting installer when it's that version (an older one goes), so closing doesn't run another.</summary>
    public static string? Take(string version)
    {
        var waiting = Staged;
        if (waiting?.Version == version)
        {
            Staged = null;
            return waiting.Value.Installer;
        }
        Discard();
        return null;
    }

    /// <summary>Netfish is closing: install the waiting version now.</summary>
    public static void Closing()
    {
        if (!On || Staged is not { } waiting) return;
        Staged = null;
        try { Updater.Start(waiting.Installer, reopen: false); } catch { }
    }
}
