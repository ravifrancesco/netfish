using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

namespace Netfish;

/// <summary>The setup and downloads pages (shared with the other apps), served by the app itself.</summary>
static class LocalPages
{
    public const string Origin = "https://netfish.example/";
    public static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "pages");

    public static bool IsLocal(Uri? url) => url is { Scheme: "https", Host: "netfish.example" };

    public static Uri Page(string name, IDictionary<string, string>? query = null) =>
        new(Origin + name + (query is { Count: > 0 } ? "?" + string.Join("&", query.Select(q => $"{Uri.EscapeDataString(q.Key)}={Uri.EscapeDataString(q.Value)}")) : ""));
}

/// <summary>
/// window.netfishDesktop in the Windows app: the same calls the Mac app offers
/// (server setup, downloads, the downloads page), plus <c>videoOverlay</c>: the
/// web player's controls drive mpv, which draws the film underneath the page.
/// </summary>
sealed class Bridge(MainWindow window, OfflineStore store)
{
    public static string Script(string version) => """
        (() => {
          if (window.top !== window || window.netfishDesktop || !window.chrome || !window.chrome.webview) return;
          const host = window.chrome.webview;
          let next = 0;
          const waiting = new Map();
          const offline = new Set();
          const video = new Set();
          host.addEventListener('message', (e) => {
            const m = e.data;
            if (!m || typeof m !== 'object') return;
            if ('reply' in m) {
              const call = waiting.get(m.reply);
              waiting.delete(m.reply);
              if (call) 'error' in m ? call.reject(new Error(m.error)) : call.resolve(m.value);
            } else {
              const listeners = m.push === 'offline' ? offline : m.push === 'video' ? video : null;
              listeners?.forEach((cb) => { try { cb(m.value); } catch (err) { console.error(err); } });
            }
          });
          const call = (cmd, args) => new Promise((resolve, reject) => {
            const id = ++next;
            waiting.set(id, { resolve, reject });
            host.postMessage({ id, cmd, args: args === undefined ? null : args });
          });
          const send = (cmd, args) => host.postMessage({ id: 0, cmd, args: args === undefined ? null : args });
          window.netfishDesktop = {
            platform: 'win32',
            version: '__VERSION__',
            // Downloads are kept exactly as they are; mpv plays them.
            offlineFormat: 'original',
            changeServer: () => send('changeServer'),
            connect: (input) => call('connect', input),
            currentServer: () => call('currentServer'),
            download: (d) => call('download', d),
            offlineList: () => call('list'),
            onOfflineChange: (cb) => { offline.add(cb); return () => offline.delete(cb); },
            removeOffline: (id) => call('remove', id),
            removeOfflineSeries: (key) => call('removeSeries', key),
            retryOffline: (id) => call('retry', id),
            offlineUsage: () => call('usage'),
            clearOffline: () => call('clear'),
            openOffline: (target) => send('openOffline', target || {}),
            openServer: () => send('openServer'),
            toggleFullscreen: () => send('fullscreen'),
            keepAwake: (on) => send('keepAwake', Boolean(on)),
            videoOverlay: {
              name: 'mpv',
              profile: () => call('videoProfile'),
              load: (request) => call('videoLoad', request),
              command: (name, value) => send('videoCommand', { name, value: value === undefined ? null : value }),
              onState: (cb) => { video.add(cb); return () => video.delete(cb); },
            },
          };
        })();
        """.Replace("__VERSION__", version);

    public void Push(string kind, JsonNode? value) => Post(new JsonObject { ["push"] = kind, ["value"] = value });

    void Post(JsonObject message)
    {
        try { window.Web?.PostWebMessageAsJson(message.ToJsonString()); }
        catch (Exception) { /* the page is restarting; it asks again when it's back */ }
    }

    public void Push(string kind, Dictionary<string, object?> state) => Push(kind, JsonSerializer.SerializeToNode(state));

    void Reply(double id, JsonNode? value, string? error)
    {
        if (id == 0) return;
        var message = new JsonObject { ["reply"] = id };
        if (error != null) message["error"] = error;
        else message["value"] = value;
        Post(message);
    }

    static string? Str(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    static double? Num(JsonNode? node) => node is JsonValue v && v.TryGetValue<double>(out var n) ? n : null;
    static bool Flag(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    public async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if ((JsonNode.Parse(e.WebMessageAsJson) as JsonObject) is not { } message) return;
        var id = Num(message["id"]) ?? 0;
        // Only the app's own pages and the Netfish server may use the app.
        Uri.TryCreate(e.Source, UriKind.Absolute, out var source);
        var local = LocalPages.IsLocal(source);
        if (!local && !Server.Owns(source))
        {
            Reply(id, null, L("Not allowed here"));
            return;
        }
        try
        {
            Reply(id, await Handle(Str(message["cmd"]) ?? "", message["args"], local), null);
        }
        catch (Exception error)
        {
            Reply(id, null, error.Message);
        }
    }

    async Task<JsonNode?> Handle(string cmd, JsonNode? args, bool local)
    {
        switch (cmd)
        {
            // Server
            case "currentServer":
                return Server.Url?.GetLeftPart(UriPartial.Authority);
            case "changeServer":
                window.ShowSetup(null);
                return null;
            case "connect":
            {
                if (!local) throw new Problem(L("Not allowed here"));
                var url = await Server.Probe(Server.Normalize(Str(args) ?? ""));
                Server.Url = url;
                window.ShowServer(fresh: true);
                return url.GetLeftPart(UriPartial.Authority);
            }

            // Downloads
            case "list": return store.PublicList();
            case "download":
            {
                var origin = Server.Url ?? throw new Problem(L("Not connected to a Netfish server"));
                return await store.Start(args as JsonObject ?? new JsonObject(), origin, await window.CookieHeader(origin));
            }
            case "retry":
            {
                var origin = Server.Url ?? throw new Problem(L("Not connected to a Netfish server"));
                return await store.Retry(Str(args) ?? "", origin, await window.CookieHeader(origin));
            }
            case "remove": return store.Remove(Str(args) ?? "");
            case "removeSeries": return store.RemoveSeries(Str(args) ?? "");
            case "usage": return store.Usage();
            case "clear": return store.Clear();
            case "openOffline":
                window.ShowOffline(args as JsonObject);
                return null;
            case "openServer":
                window.ShowServer();
                return null;

            // Window
            case "fullscreen":
                window.ToggleFullscreen();
                return null;
            case "keepAwake":
                window.KeepAwake(Flag(args));
                return null;

            // Playback in mpv
            case "videoProfile": return Profile();
            case "videoLoad": return await Load(args as JsonObject ?? throw new Problem(L("Nothing to play")));
            case "videoCommand":
                Command(args as JsonObject ?? new JsonObject());
                return null;
            default:
                throw new Problem(L("Unknown request"));
        }
    }

    async Task<JsonNode?> Load(JsonObject request)
    {
        if (!Uri.TryCreate(Str(request["url"]), UriKind.Absolute, out var url)) throw new Problem(L("Nothing to play"));
        var externals = (request["externalSubtitles"] as JsonArray ?? new JsonArray()).Select(s => Str(s?["url"])).OfType<string>().ToList();
        string target;
        var cookie = "";
        var files = new List<string>();
        if (LocalPages.IsLocal(url))
        {
            // A download: mpv plays the file itself, with its subtitle files.
            target = store.MediaPath(url) ?? throw new Problem(L("This download isn't on this computer any more"));
            foreach (var s in externals)
                if (Uri.TryCreate(s, UriKind.Absolute, out var u) && store.MediaPath(u) is { } file) files.Add(file);
        }
        else if (Server.Owns(url))
        {
            target = url.ToString();
            cookie = await window.CookieHeader(url);
            foreach (var s in externals)
                if (Uri.TryCreate(new Uri(url, "/"), s, out var u) && Server.Owns(u)) files.Add(u.ToString());
        }
        else
        {
            throw new Problem(L("Nothing to play"));
        }
        var audio = Num((request["audio"] as JsonObject)?["position"]);
        var subtitles = request["subtitles"] as JsonObject;
        var position = Num(subtitles?["position"]);
        var subtitle = Str(subtitles?["mode"]) == "on" ? position is { } p ? ((int)p).ToString(CultureInfo.InvariantCulture) : "auto" : "no";
        window.Player.Load(target, Num(request["startSeconds"]) ?? 0, cookie, audio is { } a ? (int)a : null, subtitle, files);
        return null;
    }

    void Command(JsonObject command)
    {
        var player = window.Player;
        var value = command["value"];
        string Text(double n) => n.ToString(CultureInfo.InvariantCulture);
        switch (Str(command["name"]))
        {
            case "play": player.Set("pause", "no"); break;
            case "pause": player.Set("pause", "yes"); break;
            case "seek": if (Num(value) is { } t) player.Command("seek", Text(Math.Max(0, t)), "absolute"); break;
            case "volume": if (Num(value) is { } v) player.Set("volume", Text(Math.Round(v * 100))); break;
            case "mute": player.Set("mute", Flag(value) ? "yes" : "no"); break;
            case "audio": if (Num(value) is { } n) player.Set("aid", Text(n)); break;
            case "subtitle": player.Set("sid", Num(value) is { } s ? Text(s) : "no"); break;
            case "controls": player.Set("sub-margin-y", Flag(value) ? "150" : "60"); break; // above Netfish's controls
            case "stop": player.Stop(); break;
        }
    }

    /// <summary>What mpv plays as-is: everything. Jellyfin then always sends the original file.</summary>
    static JsonObject Profile()
    {
        string[] subtitles = ["srt", "subrip", "ass", "ssa", "vtt", "webvtt", "sub", "smi", "microdvd", "mov_text", "ttml", "pgs", "pgssub", "dvdsub", "dvbsub", "vobsub"];
        string[] files = ["srt", "subrip", "ass", "ssa", "vtt", "webvtt"];
        return new JsonObject
        {
            ["Name"] = "Netfish for Windows (mpv)",
            ["MaxStreamingBitrate"] = 400_000_000,
            ["MaxStaticBitrate"] = 400_000_000,
            ["MusicStreamingTranscodingBitrate"] = 384_000,
            ["DirectPlayProfiles"] = new JsonArray(new JsonObject { ["Type"] = "Video" }, new JsonObject { ["Type"] = "Audio" }),
            ["TranscodingProfiles"] = new JsonArray(new JsonObject
            {
                ["Container"] = "ts", ["Type"] = "Video", ["Protocol"] = "hls", ["Context"] = "Streaming",
                ["VideoCodec"] = "h264,hevc,av1", ["AudioCodec"] = "aac,ac3,eac3,mp3,opus,flac", ["MaxAudioChannels"] = "8",
                ["MinSegments"] = 1, ["BreakOnNonKeyFrames"] = true,
            }),
            ["ContainerProfiles"] = new JsonArray(),
            ["CodecProfiles"] = new JsonArray(),
            ["SubtitleProfiles"] = new JsonArray(
                subtitles.Select(f => (JsonNode)new JsonObject { ["Format"] = f, ["Method"] = "Embed" })
                    .Concat(files.Select(f => (JsonNode)new JsonObject { ["Format"] = f, ["Method"] = "External" }))
                    .ToArray()),
        };
    }
}
