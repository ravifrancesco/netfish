using System.Runtime.InteropServices;

namespace Netfish;

/// <summary>
/// mpv, embedded the way Jellyfin Media Player does it: libmpv decodes (with the
/// PC's hardware decoder) and draws the film into a child window that sits
/// *under* the transparent web page, so Netfish's own player controls float on
/// top of the picture. It plays practically every format, so the server just
/// sends the file.
/// </summary>
sealed class MpvPlayer : IDisposable
{
    /// <summary>Raised on the UI thread with what changed: time, duration, pause, buffering, tracks…</summary>
    public event Action<Dictionary<string, object?>>? State;

    readonly IntPtr mpv;
    readonly SynchronizationContext ui;
    readonly Thread events;
    List<string> pendingExternal = new();
    string pendingSubtitle = "no";
    bool disposed;
    volatile bool destroyed; // the handle is freed: no more calls into mpv

    public MpvPlayer(IntPtr window)
    {
        ui = SynchronizationContext.Current ?? throw new InvalidOperationException("Create the player on the UI thread");
        mpv = Lib.mpv_create();
        if (mpv == IntPtr.Zero) throw new InvalidOperationException("mpv didn't start");
        long wid = window.ToInt64();
        Lib.mpv_set_option(mpv, "wid", Lib.FORMAT_INT64, ref wid);
        // A player inside an app: no mpv window of its own, no config files, no mpv controls, keys or mouse.
        foreach (var (name, value) in new[]
        {
            ("hwdec", "auto-safe"), ("config", "no"), ("load-scripts", "no"), ("osc", "no"), ("ytdl", "no"),
            ("input-default-bindings", "no"), ("input-vo-keyboard", "no"), ("input-cursor", "no"), ("input-cursor-passthrough", "yes"),
            ("cursor-autohide", "no"), ("terminal", "no"), ("msg-level", "all=warn"), ("taskbar-progress", "no"), ("media-controls", "no"),
            ("idle", "yes"), ("keep-open", "no"), ("force-window", "no"), ("cache", "yes"), ("demuxer-max-bytes", "150MiB"),
            ("audio-client-name", "Netfish"), ("sub-font-size", "46"), ("sub-border-size", "2.4"), ("sub-margin-y", "60"),
        })
        {
            Lib.mpv_set_option_string(mpv, name, value); // options this mpv doesn't know are simply skipped
        }
        Check(Lib.mpv_initialize(mpv), "mpv didn't start");
        ulong id = 0;
        foreach (var (name, format) in new[]
        {
            ("time-pos", Lib.FORMAT_DOUBLE), ("duration", Lib.FORMAT_DOUBLE), ("pause", Lib.FORMAT_FLAG), ("paused-for-cache", Lib.FORMAT_FLAG),
            ("volume", Lib.FORMAT_DOUBLE), ("mute", Lib.FORMAT_FLAG), ("demuxer-cache-time", Lib.FORMAT_DOUBLE), ("seeking", Lib.FORMAT_FLAG),
            ("aid", Lib.FORMAT_INT64), ("sid", Lib.FORMAT_INT64), ("audio-codec-name", Lib.FORMAT_STRING), ("track-list/count", Lib.FORMAT_INT64),
        })
        {
            Lib.mpv_observe_property(mpv, ++id, name, format);
        }
        events = new Thread(EventLoop) { IsBackground = true, Name = "mpv events" };
        events.Start();
    }

    /// <summary>Whether libmpv-2.dll is next to the app and loads.</summary>
    public static bool Available(out string problem)
    {
        try
        {
            Lib.mpv_client_api_version();
            problem = "";
            return true;
        }
        catch (Exception e)
        {
            problem = e.Message;
            return false;
        }
    }

    static void Check(int error, string what)
    {
        if (error < 0) throw new InvalidOperationException($"{what} ({Marshal.PtrToStringUTF8(Lib.mpv_error_string(error))})");
    }

    // ---------- Commands ----------

    public void Command(params string[] args)
    {
        if (!disposed) Run(args, async: false);
    }

    void Run(string[] args, bool async)
    {
        if (destroyed) return;
        var pointers = new IntPtr[args.Length + 1];
        try
        {
            for (var i = 0; i < args.Length; i++) pointers[i] = Marshal.StringToCoTaskMemUTF8(args[i]);
            if (async) Lib.mpv_command_async(mpv, 0, pointers);
            else Lib.mpv_command(mpv, pointers);
        }
        finally
        {
            foreach (var p in pointers) if (p != IntPtr.Zero) Marshal.FreeCoTaskMem(p);
        }
    }

    public void Set(string name, string value)
    {
        if (!disposed && !destroyed) Lib.mpv_set_property_string(mpv, name, value);
    }

    /// <summary>
    /// Open a file or stream. <paramref name="cookie"/>: the Netfish session, sent with every request (video
    /// and subtitle files). <paramref name="subtitle"/>: "no", "auto" or a track number.
    /// </summary>
    public void Load(string url, double start, string cookie, int? audio, string subtitle, List<string> external)
    {
        // One header, added as a single list item (a plain set would split it at commas).
        Command("change-list", "http-header-fields", "clr", "");
        if (cookie.Length > 0) Command("change-list", "http-header-fields", "append", $"Cookie: {cookie}");
        Set("pause", "no");
        pendingExternal = external;
        pendingSubtitle = subtitle;
        var options = new List<string> { $"start={Math.Max(0, start).ToString(System.Globalization.CultureInfo.InvariantCulture)}" };
        if (audio is { } a) options.Add($"aid={a}");
        options.Add(subtitle == "no" || external.Count > 0 ? "sid=no" : $"sid={subtitle}");
        Command("loadfile", url, "replace", "-1", string.Join(",", options));
    }

    public void Stop() => Command("stop");

    // ---------- Events (on the events thread) ----------

    void Post(Dictionary<string, object?> state)
    {
        try { ui.Post(_ => { if (!disposed) State?.Invoke(state); }, null); }
        catch (InvalidOperationException) { } // the window is already gone
    }

    void EventLoop()
    {
        while (true)
        {
            var e = Marshal.PtrToStructure<Lib.Event>(Lib.mpv_wait_event(mpv, -1));
            switch (e.event_id)
            {
                case Lib.EVENT_SHUTDOWN:
                    // Only this thread uses the handle by now, so it's the one to free it.
                    destroyed = true;
                    Lib.mpv_terminate_destroy(mpv);
                    return;
                case Lib.EVENT_PROPERTY_CHANGE:
                {
                    var property = Marshal.PtrToStructure<Lib.EventProperty>(e.data);
                    var name = Marshal.PtrToStringUTF8(property.name) ?? "";
                    if (name == "track-list/count")
                    {
                        Post(new() { ["tracks"] = Tracks() });
                        continue;
                    }
                    object? value = null;
                    if (property.data != IntPtr.Zero)
                    {
                        value = property.format switch
                        {
                            Lib.FORMAT_DOUBLE => Marshal.PtrToStructure<double>(property.data),
                            Lib.FORMAT_FLAG => Marshal.ReadInt32(property.data) != 0,
                            Lib.FORMAT_INT64 => Marshal.ReadInt64(property.data),
                            Lib.FORMAT_STRING => Marshal.PtrToStringUTF8(Marshal.ReadIntPtr(property.data)),
                            _ => null,
                        };
                    }
                    Post(new() { [name] = value });
                    break;
                }
                case Lib.EVENT_FILE_LOADED:
                {
                    // Subtitle files that go with the video, then the chosen subtitle.
                    foreach (var url in pendingExternal) Run(new[] { "sub-add", url, "auto" }, async: true);
                    if (pendingExternal.Count > 0) Run(new[] { "set", "sid", pendingSubtitle }, async: true);
                    pendingExternal = new();
                    // The page may have started listening after mpv's first updates: tell it where things stand.
                    int paused = 0;
                    Lib.mpv_get_property(mpv, "pause", Lib.FORMAT_FLAG, ref paused);
                    Post(new() { ["loaded"] = true, ["pause"] = paused != 0, ["tracks"] = Tracks() });
                    break;
                }
                case Lib.EVENT_END_FILE:
                {
                    var end = Marshal.PtrToStructure<Lib.EventEndFile>(e.data);
                    if (end.reason == Lib.END_EOF) Post(new() { ["ended"] = true, ["finished"] = true });
                    else if (end.reason == Lib.END_ERROR)
                        Post(new() { ["ended"] = true, ["finished"] = false, ["error"] = Marshal.PtrToStringUTF8(Lib.mpv_error_string(end.error)) ?? "mpv couldn't play this" });
                    break;
                }
            }
        }
    }

    /// <summary>The file's audio and subtitle tracks, for pages that offer their own track menus.</summary>
    List<Dictionary<string, object?>> Tracks()
    {
        var list = new List<Dictionary<string, object?>>();
        long count = 0;
        Lib.mpv_get_property(mpv, "track-list/count", Lib.FORMAT_INT64, ref count);
        for (var i = 0; i < count; i++)
        {
            var type = String($"track-list/{i}/type");
            if (type != "audio" && type != "sub") continue;
            long trackId = 0;
            Lib.mpv_get_property(mpv, $"track-list/{i}/id", Lib.FORMAT_INT64, ref trackId);
            list.Add(new()
            {
                ["id"] = trackId,
                ["type"] = type,
                ["lang"] = String($"track-list/{i}/lang"),
                ["title"] = String($"track-list/{i}/title"),
                ["codec"] = String($"track-list/{i}/codec"),
                ["external"] = String($"track-list/{i}/external") == "yes",
                ["selected"] = String($"track-list/{i}/selected") == "yes",
            });
        }
        return list;
    }

    string? String(string name)
    {
        var p = Lib.mpv_get_property_string(mpv, name);
        if (p == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUTF8(p); }
        finally { Lib.mpv_free(p); }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        Run(new[] { "quit" }, async: false); // the events thread sees mpv shut down, frees it and ends
        events.Join(5000);
    }

    // ---------- libmpv (libmpv-2.dll, next to Netfish.exe) ----------

    static class Lib
    {
        const string Dll = "libmpv-2.dll";
        public const int FORMAT_STRING = 1, FORMAT_FLAG = 3, FORMAT_INT64 = 4, FORMAT_DOUBLE = 5;
        public const int EVENT_SHUTDOWN = 1, EVENT_END_FILE = 7, EVENT_FILE_LOADED = 8, EVENT_PROPERTY_CHANGE = 22;
        public const int END_EOF = 0, END_ERROR = 4;

        [StructLayout(LayoutKind.Sequential)]
        public struct Event { public int event_id; public int error; public ulong reply_userdata; public IntPtr data; }

        [StructLayout(LayoutKind.Sequential)]
        public struct EventProperty { public IntPtr name; public int format; public IntPtr data; }

        [StructLayout(LayoutKind.Sequential)]
        public struct EventEndFile { public int reason; public int error; public long playlist_entry_id; public long playlist_insert_id; public int playlist_insert_num_entries; }

        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern uint mpv_client_api_version();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr mpv_create();
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern int mpv_initialize(IntPtr ctx);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void mpv_terminate_destroy(IntPtr ctx);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr mpv_error_string(int error);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void mpv_free(IntPtr data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_set_option(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int format, ref long data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_set_option_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string value);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_set_property_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string value);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr mpv_get_property_string(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_get_property(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int format, ref long data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_get_property(IntPtr ctx, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int format, ref int data);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)]
        public static extern int mpv_observe_property(IntPtr ctx, ulong id, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int format);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern int mpv_command(IntPtr ctx, IntPtr[] args);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern int mpv_command_async(IntPtr ctx, ulong id, IntPtr[] args);
        [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr mpv_wait_event(IntPtr ctx, double timeout);
    }
}
