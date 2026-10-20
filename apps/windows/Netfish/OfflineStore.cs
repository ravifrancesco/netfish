using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Netfish;

/// <summary>
/// Downloads for watching without a connection, like Netflix downloads: kept in
/// the app's own folder (%LOCALAPPDATA%\Netfish\Offline), managed only from the
/// app. Files are saved exactly as they are on the server (mpv plays them all),
/// so downloading costs the server nothing. The pages see the same list as in
/// the other Netfish apps.
/// </summary>
sealed class OfflineStore
{
    sealed class Subtitle
    {
        public string Label { get; set; } = "";
        public string? Code { get; set; }
        public string File { get; set; } = ""; // relative to the root folder
    }

    /// <summary>Scrubbing previews (Jellyfin's trickplay pictures): frames of Width×Height, Columns×Rows to a picture, one every Interval seconds.</summary>
    sealed class Trickplay
    {
        public double Width { get; set; }
        public double Height { get; set; }
        public int Columns { get; set; }
        public int Rows { get; set; }
        public int Count { get; set; }
        public double Interval { get; set; }
        public List<string> Files { get; set; } = new(); // relative to the root folder
    }

    sealed class Entry
    {
        public string ItemId { get; set; } = "";
        public string Kind { get; set; } = "Movie";
        public string Title { get; set; } = "";
        public string? SeriesId { get; set; }
        public string? SeriesTitle { get; set; }
        public int? SeasonNumber { get; set; }
        public int? EpisodeNumber { get; set; }
        public string? Subtitle { get; set; }
        public string FileName { get; set; } = "";
        public string Folder { get; set; } = ""; // relative to the root folder
        public long Size { get; set; }
        public long Received { get; set; }
        public bool Converted { get; set; }
        public double? DurationSeconds { get; set; }
        public string? DetailHref { get; set; }
        public string Server { get; set; } = "";
        public string State { get; set; } = "downloading"; // downloading, done, failed, interrupted
        public string? Error { get; set; }
        public string AddedAt { get; set; } = "";
        public string? PosterFile { get; set; }
        public string? PosterType { get; set; }
        public List<Subtitle> Subtitles { get; set; } = new();
        public Trickplay? Trickplay { get; set; }
        /// <summary>What the server described, kept so an interrupted download can be retried.</summary>
        public string Source { get; set; } = "{}";
    }

    sealed class Transfer
    {
        public readonly CancellationTokenSource Cancel = new();
        public long Received;
        public long Total;
    }

    /// <summary>Raised on the UI thread with the public list whenever something changes.</summary>
    public event Action<JsonArray>? Changed;

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    static readonly HttpClient http = new(new SocketsHttpHandler { UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(15) }) { Timeout = Timeout.InfiniteTimeSpan };

    readonly string root = Path.Combine(AppData.Root, "Offline");
    readonly string manifest = Path.Combine(AppData.Root, "offline.json");
    readonly Dictionary<string, Transfer> active = new();
    readonly System.Windows.Forms.Timer progress = new() { Interval = 500 };
    readonly System.Windows.Forms.Timer pending = new() { Interval = 400 };
    List<Entry> entries;

    public OfflineStore()
    {
        try { entries = JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(manifest), Json) ?? new(); }
        catch { entries = new(); }
        // Downloads stop when the app closes; they can be retried.
        foreach (var e in entries.Where(e => e.State == "downloading")) e.State = "interrupted";
        entries.RemoveAll(e => e.State == "done" && !File.Exists(VideoFile(e)));
        progress.Tick += (_, _) => ShowProgress();
        pending.Tick += (_, _) =>
        {
            pending.Stop();
            Changed?.Invoke(PublicList());
        };
    }

    void Save()
    {
        Directory.CreateDirectory(AppData.Root);
        File.WriteAllText(manifest, JsonSerializer.Serialize(entries, Json));
    }

    void Broadcast(bool now = false)
    {
        if (now)
        {
            pending.Stop();
            Changed?.Invoke(PublicList());
        }
        else if (!pending.Enabled) pending.Start();
    }

    Entry? Find(string itemId) => entries.FirstOrDefault(e => e.ItemId == itemId);
    string VideoFile(Entry e) => Path.Combine(root, e.Folder, e.FileName);
    public bool HasDownloads => entries.Any(e => e.State == "done");

    // ---------- Where people got to, and Home as it last looked (offline mode) ----------

    readonly string positionsFile = Path.Combine(AppData.Root, "offline-positions.json");
    readonly string snapshotFile = Path.Combine(AppData.Root, "home-snapshot.json");

    /// <summary>Where someone got to in a download, kept until Netfish is online to tell the server.</summary>
    public void SavePosition(string itemId, double seconds, bool finished)
    {
        if (string.IsNullOrEmpty(itemId)) return;
        var list = ReadPositions();
        foreach (var old in list.Where(p => p?["itemId"]?.GetValue<string>() == itemId).ToList()) list.Remove(old);
        list.Add(new JsonObject { ["itemId"] = itemId, ["seconds"] = Math.Max(0, seconds), ["finished"] = finished, ["at"] = DateTime.UtcNow.ToString("o") });
        while (list.Count > 300) list.RemoveAt(0);
        Directory.CreateDirectory(AppData.Root);
        File.WriteAllText(positionsFile, list.ToJsonString());
    }

    /// <summary>The positions not yet sent, handed over (and forgotten here).</summary>
    public JsonArray TakePositions()
    {
        var list = ReadPositions();
        try { File.Delete(positionsFile); } catch { }
        return list;
    }

    JsonArray ReadPositions()
    {
        try { return JsonNode.Parse(File.ReadAllText(positionsFile)) as JsonArray ?? new JsonArray(); }
        catch { return new JsonArray(); }
    }

    public void SaveSnapshot(string json)
    {
        if (json.Length > 512_000) return;
        Directory.CreateDirectory(AppData.Root);
        File.WriteAllText(snapshotFile, json);
    }

    public string? Snapshot()
    {
        try { return File.ReadAllText(snapshotFile); }
        catch { return null; }
    }

    /// <summary>What the pages see (no file paths): the same shape as the other apps' lists.</summary>
    public JsonArray PublicList()
    {
        var list = new JsonArray();
        foreach (var e in entries)
        {
            var media = $"{LocalPages.Origin}media/{Uri.EscapeDataString(e.ItemId)}";
            var item = new JsonObject
            {
                ["itemId"] = e.ItemId, ["kind"] = e.Kind, ["title"] = e.Title, ["fileName"] = e.FileName,
                ["size"] = e.Size, ["received"] = e.Received, ["converted"] = e.Converted, ["server"] = e.Server,
                ["state"] = e.State, ["addedAt"] = e.AddedAt, ["video"] = $"{media}/video",
                ["subtitles"] = new JsonArray(e.Subtitles.Select((s, n) => (JsonNode)new JsonObject
                {
                    ["label"] = s.Label, ["code"] = s.Code ?? "", ["url"] = $"{media}/sub/{n}",
                }).ToArray()),
            };
            if (e.PosterFile != null) item["poster"] = $"{media}/poster";
            if (e.Trickplay is { } t)
                item["trickplay"] = new JsonObject
                {
                    ["url"] = $"{media}/trick/{{index}}", ["width"] = t.Width, ["height"] = t.Height,
                    ["columns"] = t.Columns, ["rows"] = t.Rows, ["count"] = t.Count, ["interval"] = t.Interval,
                };
            if (e.SeriesId != null) item["seriesId"] = e.SeriesId;
            if (e.SeriesTitle != null) item["seriesTitle"] = e.SeriesTitle;
            if (e.Subtitle != null) item["subtitle"] = e.Subtitle;
            if (e.DetailHref != null) item["detailHref"] = e.DetailHref;
            if (e.Error != null) item["error"] = e.Error;
            if (e.SeasonNumber != null) item["seasonNumber"] = e.SeasonNumber;
            if (e.EpisodeNumber != null) item["episodeNumber"] = e.EpisodeNumber;
            if (e.DurationSeconds != null) item["durationSeconds"] = e.DurationSeconds;
            list.Add(item);
        }
        return list;
    }

    // ---------- Files for the pages and the player ----------

    /// <summary>A downloaded film or subtitle file for mpv, from the address the page knows it by.</summary>
    public string? MediaPath(Uri url)
    {
        var parts = url.AbsolutePath.Trim('/').Split('/').Select(Uri.UnescapeDataString).ToArray();
        if (!LocalPages.IsLocal(url) || parts.Length < 3 || parts[0] != "media" || Find(parts[1]) is not { } e) return null;
        if (parts[2] == "video" && e.State == "done") return VideoFile(e);
        if (parts[2] == "sub" && parts.Length == 4 && int.TryParse(parts[3], out var n) && n >= 0 && n < e.Subtitles.Count) return Path.Combine(root, e.Subtitles[n].File);
        return null;
    }

    /// <summary>Artwork, subtitles and scrubbing previews for the downloads page.</summary>
    public (string Path, string Type)? Asset(string itemId, string kind, string? n)
    {
        if (Find(itemId) is not { } e) return null;
        if (kind == "poster" && e.PosterFile != null) return (Path.Combine(root, e.PosterFile), e.PosterType is { Length: > 0 } t ? t : "image/jpeg");
        if (kind == "sub" && int.TryParse(n, out var i) && i >= 0 && i < e.Subtitles.Count) return (Path.Combine(root, e.Subtitles[i].File), "text/vtt; charset=utf-8");
        if (kind == "trick" && e.Trickplay is { } trick && int.TryParse(n, out var k) && k >= 0 && k < trick.Files.Count) return (Path.Combine(root, trick.Files[k]), "image/jpeg");
        return null;
    }

    // ---------- Downloading ----------

    static string Safe(string? s)
    {
        var cleaned = Regex.Replace(Regex.Replace(s ?? "", @"[\\/:*?""<>|]+", " "), @"\s+", " ").Trim().TrimEnd('.');
        cleaned = cleaned.Length == 0 ? "Netfish" : cleaned;
        return cleaned.Length > 100 ? cleaned[..100].Trim() : cleaned;
    }

    static string? Str(JsonObject d, string key) => d[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    static T? Num<T>(JsonObject d, string key) where T : struct => d[key] is JsonValue v && v.TryGetValue<T>(out var n) ? n : null;

    /// <summary>The scrubbing previews beside the film, when the server lists them: all of them or none (a gap would show the wrong frames).</summary>
    async Task<Trickplay?> KeepTrickplay(JsonObject? t, string itemId, string folder, string dir, Uri origin, string cookie)
    {
        if (t?["sheets"] is not JsonArray sheets || sheets.Count == 0) return null;
        try
        {
            var kept = new Trickplay
            {
                Width = t["width"]!.GetValue<double>(), Height = t["height"]!.GetValue<double>(),
                Columns = t["columns"]!.GetValue<int>(), Rows = t["rows"]!.GetValue<int>(),
                Count = t["count"]!.GetValue<int>(), Interval = t["interval"]!.GetValue<double>(),
            };
            for (var n = 0; n < sheets.Count; n++)
            {
                var name = $".{itemId}.trick.{n}.jpg";
                kept.Files.Add(Path.Combine(folder, name));
                await Fetch(new Uri(origin, sheets[n]!.GetValue<string>()), cookie, Path.Combine(dir, name));
            }
            return kept;
        }
        catch
        {
            for (var n = 0; n < sheets.Count; n++) Delete(Path.Combine(dir, $".{itemId}.trick.{n}.jpg"));
            return null;
        }
    }

    static async Task<string> Fetch(Uri url, string cookie, string file)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Cookie", cookie);
        using var response = await http.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        await File.WriteAllBytesAsync(file, await response.Content.ReadAsByteArrayAsync(timeout.Token), timeout.Token);
        return response.Content.Headers.ContentType?.ToString() ?? "";
    }

    /// <summary>Start (or restart) downloading one movie/episode as described by the server.</summary>
    public async Task<JsonArray> Start(JsonObject d, Uri origin, string cookie)
    {
        var itemId = Str(d, "itemId");
        var fileName = Str(d, "fileName") is { } f ? Safe(Path.GetFileName(f)) : null;
        var path = Str(d, "url");
        if (itemId == null || fileName == null || path == null) throw new Problem(Str(d, "error") ?? L("The server didn't say what to download"));
        if (Find(itemId) is { State: "done" or "downloading" }) return PublicList();
        if (active.Remove(itemId, out var previous)) previous.Cancel.Cancel();

        var kind = Str(d, "kind") ?? "Movie";
        var title = Str(d, "title") ?? "Netfish";
        var folder = Safe(kind == "Episode" ? Str(d, "seriesTitle") : title);
        var dir = Path.Combine(root, folder);
        Directory.CreateDirectory(dir);
        var entry = new Entry
        {
            ItemId = itemId, Kind = kind, Title = title,
            SeriesId = Str(d, "seriesId"), SeriesTitle = Str(d, "seriesTitle"),
            SeasonNumber = Num<int>(d, "seasonNumber"), EpisodeNumber = Num<int>(d, "episodeNumber"),
            Subtitle = Str(d, "subtitle"), FileName = fileName, Folder = folder,
            Size = Num<long>(d, "size") ?? 0, Converted = d["converted"] is JsonValue c && c.TryGetValue<bool>(out var b) && b,
            DurationSeconds = Num<double>(d, "durationSeconds"), DetailHref = Str(d, "detailHref"),
            Server = origin.GetLeftPart(UriPartial.Authority), AddedAt = DateTime.UtcNow.ToString("o"),
            Source = d.ToJsonString(),
        };
        entries.RemoveAll(e => e.ItemId == itemId);
        entries.Insert(0, entry);
        Save();
        Broadcast(now: true);

        // Small things first (artwork, subtitles), then the film itself.
        if (Str(d, "poster") is { } poster)
        {
            try
            {
                entry.PosterType = await Fetch(new Uri(origin, poster), cookie, Path.Combine(dir, $".{itemId}.poster"));
                entry.PosterFile = Path.Combine(folder, $".{itemId}.poster");
            }
            catch { /* artwork is optional */ }
        }
        var name = Path.GetFileNameWithoutExtension(fileName);
        var n = 0;
        foreach (var sub in (d["subtitles"] as JsonArray ?? new()).OfType<JsonObject>())
        {
            var index = n++;
            if (Str(sub, "url") is not { } subPath) continue;
            var code = Str(sub, "code");
            var file = $"{name}.{Safe(code ?? $"track{index}")}.{index}.vtt";
            try
            {
                await Fetch(new Uri(origin, subPath), cookie, Path.Combine(dir, file));
                entry.Subtitles.Add(new Subtitle { Label = Str(sub, "label") ?? L("Subtitles"), Code = code, File = Path.Combine(folder, file) });
            }
            catch { /* skip a broken subtitle track */ }
        }
        entry.Trickplay = await KeepTrickplay(d["trickplay"] as JsonObject, itemId, folder, dir, origin, cookie);
        if (!entries.Contains(entry)) return PublicList(); // cancelled meanwhile
        Begin(entry, new Uri(origin, path), cookie);
        Save();
        Broadcast(now: true);
        return PublicList();
    }

    public async Task<JsonArray> Retry(string itemId, Uri origin, string cookie)
    {
        if (Find(itemId) is not { } e || JsonNode.Parse(e.Source) is not JsonObject d) throw new Problem(L("Nothing to retry"));
        e.State = "failed"; // let Start() replace it
        return await Start(d, origin, cookie);
    }

    /// <summary>Download the film in the background, picking up where an interrupted download stopped.</summary>
    async void Begin(Entry entry, Uri url, string cookie)
    {
        var transfer = new Transfer();
        active[entry.ItemId] = transfer;
        progress.Start();
        var file = VideoFile(entry);
        var part = file + ".part";
        // Converted files differ every time; only the original file can continue where it stopped.
        var resumeFrom = !entry.Converted && File.Exists(part) ? new FileInfo(part).Length : 0;
        string? error = null;
        try
        {
            await Task.Run(() => Download(url, cookie, part, resumeFrom, transfer));
        }
        catch (OperationCanceledException) when (transfer.Cancel.IsCancellationRequested)
        {
            return; // deleted, or the app is closing
        }
        catch (Exception e)
        {
            error = e is Problem ? e.Message : L("The download stopped. Try again when you're on your home network.");
        }
        finally
        {
            if (active.TryGetValue(entry.ItemId, out var t) && t == transfer) active.Remove(entry.ItemId);
        }
        if (!entries.Contains(entry)) return;
        entry.Received = Interlocked.Read(ref transfer.Received);
        if (error == null)
        {
            try
            {
                File.Move(part, file, overwrite: true);
                entry.State = "done";
                entry.Size = entry.Received = new FileInfo(file).Length;
                entry.Error = null;
            }
            catch (Exception e)
            {
                entry.State = "failed";
                entry.Error = L("Couldn't save the file: {error}", ("error", e.Message));
            }
        }
        else
        {
            entry.State = "failed";
            entry.Error = error;
        }
        try
        {
            Save();
            Broadcast(now: true);
        }
        catch { /* the disk is full or busy; the list is saved next time */ }
    }

    static async Task Download(Uri url, string cookie, string part, long resumeFrom, Transfer transfer)
    {
        var token = transfer.Cancel.Token;
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Cookie", cookie);
        if (resumeFrom > 0) request.Headers.Range = new RangeHeaderValue(resumeFrom, null);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new Problem(L("Sign in to Netfish again, then retry."));
        if (response.StatusCode == HttpStatusCode.Forbidden) throw new Problem(L("Your account isn't allowed to download."));
        if (!response.IsSuccessStatusCode) throw new Problem(L("The server said no ({status}).", ("status", (int)response.StatusCode)));
        var append = resumeFrom > 0 && response.StatusCode == HttpStatusCode.PartialContent;
        var start = append ? resumeFrom : 0;
        transfer.Total = response.Content.Headers.ContentLength is long length ? start + length : 0;
        Interlocked.Exchange(ref transfer.Received, start);
        await using var input = await response.Content.ReadAsStreamAsync(token);
        // Deletable while open, so "Delete" works mid-download.
        await using var output = new FileStream(part, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read | FileShare.Delete, 1 << 20, useAsync: true);
        var buffer = new byte[1 << 20];
        while (true)
        {
            // A connection that goes quiet for a minute counts as dropped.
            using var quiet = CancellationTokenSource.CreateLinkedTokenSource(token);
            quiet.CancelAfter(TimeSpan.FromSeconds(60));
            var read = await input.ReadAsync(buffer, quiet.Token);
            if (read == 0) break;
            await output.WriteAsync(buffer.AsMemory(0, read), token);
            Interlocked.Add(ref transfer.Received, read);
        }
        if (transfer.Total > 0 && Interlocked.Read(ref transfer.Received) < transfer.Total) throw new IOException("The connection closed early");
    }

    void ShowProgress()
    {
        if (active.Count == 0)
        {
            progress.Stop();
            return;
        }
        foreach (var (itemId, transfer) in active)
        {
            if (Find(itemId) is not { } e) continue;
            e.Received = Interlocked.Read(ref transfer.Received);
            if (transfer.Total > 0) e.Size = transfer.Total;
            e.State = "downloading";
        }
        Broadcast();
    }

    // ---------- Deleting ----------

    static void Delete(string file)
    {
        try { File.Delete(file); } catch { /* gone already, or still closing */ }
    }

    public JsonArray Remove(string itemId)
    {
        if (active.Remove(itemId, out var transfer)) transfer.Cancel.Cancel();
        if (Find(itemId) is { } e)
        {
            Delete(VideoFile(e));
            Delete(VideoFile(e) + ".part");
            if (e.PosterFile != null) Delete(Path.Combine(root, e.PosterFile));
            foreach (var s in e.Subtitles) Delete(Path.Combine(root, s.File));
            foreach (var f in e.Trickplay?.Files ?? new()) Delete(Path.Combine(root, f));
            // Tidy the title's folder if it's now empty.
            try
            {
                var dir = Path.Combine(root, e.Folder);
                if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
            }
            catch { }
        }
        entries.RemoveAll(x => x.ItemId == itemId);
        Save();
        Broadcast(now: true);
        return PublicList();
    }

    /// <summary>Delete every downloaded episode of one show (key: seriesId, else seriesTitle).</summary>
    public JsonArray RemoveSeries(string key)
    {
        foreach (var e in entries.Where(e => e.Kind == "Episode" && (e.SeriesId ?? e.SeriesTitle) == key).ToList()) Remove(e.ItemId);
        return PublicList();
    }

    public JsonArray Clear()
    {
        foreach (var transfer in active.Values) transfer.Cancel.Cancel();
        active.Clear();
        if (Directory.Exists(root))
        {
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)) Delete(file);
            try { Directory.Delete(root, recursive: true); } catch { /* a file still closing; it goes when it closes */ }
        }
        entries.Clear();
        Save();
        Broadcast(now: true);
        return PublicList();
    }

    /// <summary>Space used by downloads, in bytes.</summary>
    public long Usage()
    {
        if (!Directory.Exists(root)) return 0;
        long total = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            try { total += new FileInfo(file).Length; } catch { }
        }
        return total;
    }

    /// <summary>The app is closing: stop downloading, and remember what can be retried.</summary>
    public void Shutdown()
    {
        foreach (var (itemId, transfer) in active)
        {
            transfer.Cancel.Cancel();
            if (Find(itemId) is { } e)
            {
                e.State = "interrupted";
                e.Received = Interlocked.Read(ref transfer.Received);
            }
        }
        active.Clear();
        Save();
    }
}
