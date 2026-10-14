using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Netfish;

/// <summary>
/// Where the app keeps its things: %LOCALAPPDATA%\Netfish. NETFISH_DATA points a test run
/// somewhere else, so tests never touch a real sign-in or real downloads.
/// </summary>
static class AppData
{
    public static readonly string Root = Environment.GetEnvironmentVariable("NETFISH_DATA") is { Length: > 0 } test
        ? test
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Netfish");
    static readonly string ConfigFile = Path.Combine(Root, "config.json");

    public static JsonObject Config()
    {
        try { return JsonNode.Parse(File.ReadAllText(ConfigFile)) as JsonObject ?? new JsonObject(); }
        catch { return new JsonObject(); }
    }

    public static void SaveConfig(Action<JsonObject> change)
    {
        var config = Config();
        change(config);
        Directory.CreateDirectory(Root);
        File.WriteAllText(ConfigFile, config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
}

/// <summary>
/// Where the Netfish server is. The app remembers only this; everything else
/// comes from the server, so updating the container updates the app too.
/// </summary>
static class Server
{
    public static Uri? Url
    {
        get => AppData.Config()["serverUrl"]?.GetValue<string>() is { } s && Uri.TryCreate(s, UriKind.Absolute, out var u) ? u : null;
        set => AppData.SaveConfig(c => c["serverUrl"] = value?.GetLeftPart(UriPartial.Authority));
    }

    /// <summary>True when the address is on the saved server (same scheme, host and port).</summary>
    public static bool Owns(Uri? url)
    {
        var server = Url;
        return url != null && server != null && url.Scheme == server.Scheme && url.Host == server.Host && url.Port == server.Port;
    }

    /// <summary>"192.168.1.50" → http://192.168.1.50:7777. Real domains keep their own port.</summary>
    public static Uri Normalize(string input)
    {
        var value = (input ?? "").Trim();
        if (value.Length == 0) throw new Problem("Enter the address of your Netfish server");
        if (!Regex.IsMatch(value, "^https?://", RegexOptions.IgnoreCase)) value = "http://" + value;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) || url.Host.Length == 0) throw new Problem("That doesn't look like an address");
        var host = url.Host;
        var local = Regex.IsMatch(host, @"^\d{1,3}(\.\d{1,3}){3}$") || host.EndsWith(".local") || !host.Contains('.');
        var builder = new UriBuilder(url.Scheme.ToLowerInvariant(), host, url.IsDefaultPort && url.Scheme == "http" && local ? 7777 : url.Port);
        return new Uri(builder.Uri.GetLeftPart(UriPartial.Authority));
    }

    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(6) };

    /// <summary>
    /// Make sure the address really is a Netfish server before saving it. Returns where it
    /// really answers (a server that redirects http:// to https:// is saved as https://).
    /// </summary>
    public static async Task<Uri> Probe(Uri origin)
    {
        HttpResponseMessage response;
        try { response = await http.GetAsync(new Uri(origin, "/api/health")); }
        catch (Exception e) { throw new Problem($"Can't reach {origin.GetLeftPart(UriPartial.Authority)} ({(e is TaskCanceledException ? "no answer" : e.Message)})"); }
        JsonNode? body = null;
        try { body = JsonNode.Parse(await response.Content.ReadAsStringAsync()); } catch { }
        if (!response.IsSuccessStatusCode || body?["name"]?.GetValue<string>() != "netfish")
            throw new Problem($"{origin.GetLeftPart(UriPartial.Authority)} doesn't look like a Netfish server");
        var answered = response.RequestMessage?.RequestUri ?? origin;
        return new Uri(answered.GetLeftPart(UriPartial.Authority));
    }
}

/// <summary>An error whose message is shown to people as-is.</summary>
sealed class Problem(string message) : Exception(message);
