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

    /// <summary>Downloads the installer, starts it silently, and tells the caller to quit.</summary>
    public static async Task Install(Release release, Action<long, long> progress)
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

        Process.Start(new ProcessStartInfo(installer, "/S /UPDATE") { UseShellExecute = true });
    }
}
