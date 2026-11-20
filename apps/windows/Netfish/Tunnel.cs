using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace Netfish;

/// <summary>
/// Away from home: WireGuard inside the app (netfish-tunnel.exe, from apps/common/tunnel, next to
/// Netfish.exe), used only by Netfish. While one is set up, the page and mpv go through its proxy
/// on 127.0.0.1, which sends the server's traffic through WireGuard only when the server doesn't
/// answer directly; nothing else on the PC goes through it. The configuration (its private key)
/// stays in this account's own app data: never shown again, never logged.
/// </summary>
static class Tunnel
{
    static readonly string File = Path.Combine(AppData.Root, "tunnel.conf");
    static readonly string Program = Path.Combine(AppContext.BaseDirectory, "netfish-tunnel.exe");
    static Process? process;

    public static bool Configured => System.IO.File.Exists(File);
    public static int? Port { get; private set; }
    public static string? Problem { get; private set; }

    /// <summary>The proxy for the page and mpv ("http://127.0.0.1:n"), while the tunnel runs.</summary>
    public static string? ProxyUrl => Port is { } port ? $"http://127.0.0.1:{port}" : null;

    public static JsonObject Status()
    {
        var status = new JsonObject { ["configured"] = Configured, ["active"] = Port != null };
        if (Problem != null) status["problem"] = Problem;
        return status;
    }

    /// <summary>Runs the tunnel with a configuration: it, and its first line ("PORT n", "OK", "ERROR …") or null.</summary>
    static async Task<(Process process, string? said)> Launch(string config, bool check)
    {
        var p = Process.Start(new ProcessStartInfo(Program, check ? "-check" : "")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
        }) ?? throw new InvalidOperationException("the tunnel didn't start");
        // (stdin stays open: closing it ends the tunnel.)
        await p.StandardInput.WriteAsync(config + "\n.\n");
        await p.StandardInput.FlushAsync();
        var line = p.StandardOutput.ReadLineAsync();
        var said = await Task.WhenAny(line, Task.Delay(TimeSpan.FromSeconds(15))) == line ? await line : null;
        return (p, said);
    }

    /// <summary>A configuration, checked by the tunnel itself and kept: null, or what's wrong with it.</summary>
    public static async Task<string?> Save(string config)
    {
        try
        {
            var (p, said) = await Launch(config, true);
            try { p.Kill(); } catch { }
            if (said == null) return "the tunnel didn't answer";
            if (said != "OK") return said.Replace("ERROR ", "");
            Stop();
            Directory.CreateDirectory(AppData.Root);
            await System.IO.File.WriteAllTextAsync(File, config.Trim());
            return null;
        }
        catch (Exception error)
        {
            return error.Message;
        }
    }

    public static void Remove()
    {
        Stop();
        try { System.IO.File.Delete(File); } catch { }
    }

    /// <summary>Up (or already up) when one is set up: true once its proxy listens.</summary>
    public static async Task<bool> Start()
    {
        if (Port != null && process is { HasExited: false }) return true;
        Stop();
        if (!Configured) return false;
        try
        {
            var (p, said) = await Launch(await System.IO.File.ReadAllTextAsync(File), false);
            if (said != null && said.StartsWith("PORT ") && int.TryParse(said[5..].Trim(), out var port))
            {
                process = p;
                Port = port;
                Problem = null;
                return true;
            }
            Problem = said?.Replace("ERROR ", "") ?? "the tunnel didn't answer";
            try { p.Kill(); } catch { }
        }
        catch (Exception error)
        {
            Problem = error.Message;
        }
        return false;
    }

    public static void Stop()
    {
        try { process?.Kill(); } catch { }
        process = null;
        Port = null;
    }

    /// <summary>Whether the server answers through the tunnel (away from home).</summary>
    public static async Task<bool> Reachable(Uri server)
    {
        if (ProxyUrl is not { } proxy) return false;
        using var http = new HttpClient(new HttpClientHandler { Proxy = new WebProxy(proxy), UseProxy = true }) { Timeout = TimeSpan.FromSeconds(8) };
        try
        {
            using var response = await http.GetAsync(new Uri(server, "/api/health"));
            return true;
        }
        catch
        {
            return false;
        }
    }
}
