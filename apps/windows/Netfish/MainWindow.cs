using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace Netfish;

/// <summary>
/// The Netfish window: mpv's picture at the bottom (a child window), the
/// Netfish interface on top (WebView2, drawn by DirectComposition above the
/// child windows, transparent where the film shows), like Jellyfin Media
/// Player. Everything you see and click is the Netfish web app from your
/// server; mpv only draws the film underneath it.
/// </summary>
sealed class MainWindow : Form
{
    public static readonly string Version = typeof(MainWindow).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0";

    public MpvPlayer Player { get; private set; } = null!;
    public CoreWebView2? Web => controller?.CoreWebView2;

    readonly Panel video;
    readonly OfflineStore store = new();
    readonly Bridge bridge;
    readonly Dictionary<ulong, Uri> navigations = new();
    CoreWebView2Environment? environment;
    CoreWebView2CompositionController? controller;
    Composition? composition;
    Uri? returnUrl;
    bool trackingMouse;
    int buttonsDown; // mouse buttons pressed in the page, so a lost capture can let go of them
    Point lastMouse;
    bool fullscreen;
    bool awake;
    Native.WINDOWPLACEMENT placement;
    Rectangle normalBounds;
    long lastTimePush;

    public MainWindow()
    {
        Text = "Netfish";
        BackColor = Color.FromArgb(6, 8, 11);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        var scale = DeviceDpi / 96f;
        MinimumSize = new Size((int)(900 * scale), (int)(560 * scale));
        // The film's window. Disabled so clicks go to this window, which hands them to the page.
        video = new Panel { Dock = DockStyle.Fill, BackColor = Color.Black, Enabled = false };
        Controls.Add(video);
        PlaceWindow(scale);
        bridge = new Bridge(this, store);
        store.Changed += list => bridge.Push("offline", list);
    }

    /// <summary>Where the window was last time, if that's still on a screen; otherwise centred.</summary>
    void PlaceWindow(float scale)
    {
        StartPosition = FormStartPosition.Manual;
        var saved = AppData.Config()["bounds"] as JsonObject;
        var rect = saved == null ? Rectangle.Empty : new Rectangle(
            (int?)saved["x"] ?? 0, (int?)saved["y"] ?? 0, (int?)saved["width"] ?? 0, (int?)saved["height"] ?? 0);
        if (rect.Width < 400 || !Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect)))
        {
            var area = Screen.PrimaryScreen!.WorkingArea;
            var size = new Size(Math.Min((int)(1440 * scale), area.Width * 9 / 10), Math.Min((int)(900 * scale), area.Height * 9 / 10));
            rect = new Rectangle(area.Left + (area.Width - size.Width) / 2, area.Top + (area.Height - size.Height) / 2, size.Width, size.Height);
        }
        Bounds = normalBounds = rect;
        if ((bool?)AppData.Config()["maximized"] == true) WindowState = FormWindowState.Maximized;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.DarkTitleBar(Handle);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            Player = new MpvPlayer(video.Handle);
            Player.State += OnPlayerState;
            await CreateWebView();
            AutoUpdate.Start(TimeSpan.FromSeconds(20));
        }
        catch (Exception error)
        {
            MessageBox.Show(this, L("Netfish couldn't start: {error}", ("error", error.Message)), "Netfish", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    async Task CreateWebView()
    {
        // The interface follows navigator.language: the same language as Windows (and these messages).
        var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required") { Language = Strings.Language };
        environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppData.Root, "WebView2"), options);
        controller = await environment.CreateCoreWebView2CompositionControllerAsync(Handle);
        // See-through where the page is transparent (during playback), so mpv's picture shows.
        controller.DefaultBackgroundColor = Color.Transparent;
        composition ??= new Composition(Handle);
        controller.RootVisualTarget = composition.Root;
        composition.Device.Commit();
        controller.Bounds = ClientRectangle;
        controller.IsVisible = WindowState != FormWindowState.Minimized;
        controller.CursorChanged += (_, _) =>
        {
            if (ClientRectangle.Contains(PointToClient(Cursor.Position))) Native.SetCursor(controller.Cursor);
        };
        controller.AcceleratorKeyPressed += OnAcceleratorKey;

        var web = controller.CoreWebView2;
        var settings = web.Settings;
        // The interface checks for "NetfishDesktop" (the app's own downloads, window behaviour).
        settings.UserAgent = $"{settings.UserAgent} NetfishDesktop/{Version}";
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        await web.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.Script(Version));
        web.AddWebResourceRequestedFilter($"{LocalPages.Origin}*", CoreWebView2WebResourceContext.All);
        web.WebResourceRequested += ServeLocal;
        web.WebMessageReceived += bridge.OnMessage;
        web.NavigationStarting += OnNavigationStarting;
        web.NavigationCompleted += OnNavigationCompleted;
        web.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenInBrowser(e.Uri);
        };
        web.ScriptDialogOpening += OnScriptDialog;
        // A page asking for full screen (e.g. a trailer) gets the whole window.
        web.ContainsFullScreenElementChanged += (_, _) =>
        {
            if (web.ContainsFullScreenElement != fullscreen) ToggleFullscreen();
        };
        web.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) web.Reload();
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) BeginInvoke(RestartWebView);
        };
        controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);

        if (Server.Url is { } server) _ = Start(server);
        else ShowSetup(null);
    }

    /// <summary>
    /// Opening: the fish swims while the server is checked (a few seconds at most), then
    /// Netfish, or offline mode when it doesn't answer: the downloads (or that there are none),
    /// trying again by itself, and a way to change the server if it has moved.
    /// </summary>
    async Task Start(Uri server)
    {
        Navigate(LocalPages.Page("loading.html"));
        if (await Server.Reachable(server)) Navigate(server);
        else ShowOffline(new JsonObject { ["offline"] = true });
    }

    /// <summary>Edge's engine went away (crashed or updated): start it again where the page was.</summary>
    async void RestartWebView()
    {
        var old = controller;
        controller = null;
        try { if (old != null) old.RootVisualTarget = null; } catch { }
        try { old?.Close(); } catch { }
        Player.Stop();
        try { await CreateWebView(); }
        catch (Exception error)
        {
            MessageBox.Show(this, L("Netfish's window stopped working ({error}). Please open Netfish again.", ("error", error.Message)), "Netfish");
            Close();
        }
    }

    // ---------- Pages ----------

    void Navigate(Uri url) => Web?.Navigate(url.ToString());

    public void ShowSetup(string? error)
    {
        Player.Stop();
        Navigate(LocalPages.Page("setup.html", error == null ? null : new Dictionary<string, string> { ["error"] = error }));
    }

    public void ShowOffline(JsonObject? target)
    {
        Player.Stop();
        if (Uri.TryCreate(Web?.Source, UriKind.Absolute, out var current) && Server.Owns(current)) returnUrl = current;
        var query = new Dictionary<string, string>();
        if (target?["play"] is JsonValue play && play.TryGetValue<string>(out var p)) query["play"] = p;
        if (target?["show"] is JsonValue show && show.TryGetValue<string>(out var s)) query["show"] = s;
        if (target?["start"] is JsonValue start && start.TryGetValue<double>(out var at)) query["start"] = ((int)Math.Max(0, at)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (target?["offline"] is JsonValue offline && offline.TryGetValue<bool>(out var off) && off) query["offline"] = "1";
        Navigate(LocalPages.Page("offline.html", query));
    }

    public void ShowServer(bool fresh = false)
    {
        if (Server.Url is not { } server)
        {
            ShowSetup(null);
            return;
        }
        var target = !fresh && Server.Owns(returnUrl) ? returnUrl! : server;
        returnUrl = null;
        Navigate(target);
    }

    static void OpenInBrowser(string url)
    {
        if (!Regex.IsMatch(url, "^https?://", RegexOptions.IgnoreCase)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    /// <summary>The setup and downloads pages, their artwork and subtitles. Films aren't served: mpv reads them.</summary>
    void ServeLocal(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (environment == null || !Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var url) || !LocalPages.IsLocal(url)) return;
        var parts = url.AbsolutePath.Trim('/').Split('/').Select(Uri.UnescapeDataString).ToArray();
        (string Path, string Type)? found = null;
        if (parts.Length >= 3 && parts[0] == "media")
            found = store.Asset(parts[1], parts[2], parts.Length > 3 ? parts[3] : null);
        else if (parts.Length == 1 && Regex.IsMatch(parts[0], @"^[\w.-]+\.(html|js|css|svg)$"))
            found = (Path.Combine(LocalPages.Folder, parts[0]), parts[0].EndsWith(".html") ? "text/html; charset=utf-8" : parts[0].EndsWith(".css") ? "text/css" : parts[0].EndsWith(".svg") ? "image/svg+xml" : "text/javascript");
        if (found is not { } file || !File.Exists(file.Path))
        {
            e.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return;
        }
        e.Response = environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file.Path)), 200, "OK", $"Content-Type: {file.Type}\r\nCache-Control: no-store");
    }

    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var url))
        {
            e.Cancel = true;
            return;
        }
        if (url.Scheme is "about" or "data" || LocalPages.IsLocal(url) || Server.Owns(url))
        {
            // Leaving a page always stops a film playing underneath it.
            Player.Stop();
            KeepAwake(false);
            navigations[e.NavigationId] = url;
            return;
        }
        // Anything else (IMDb, Letterboxd…) opens in the browser.
        e.Cancel = true;
        OpenInBrowser(e.Uri);
    }

    void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        navigations.Remove(e.NavigationId, out var url);
        // Only a server that didn't answer at all counts (an error page from it is still the server).
        if (e.IsSuccess || e.HttpStatusCode != 0 || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        if (url == null || !Server.Owns(url)) return;
        // The server stopped answering (offline, or away from home): offline mode.
        ShowOffline(new JsonObject { ["offline"] = true });
    }

    // confirm() / alert() from the pages.
    void OnScriptDialog(object? sender, CoreWebView2ScriptDialogOpeningEventArgs e)
    {
        var deferral = e.GetDeferral();
        BeginInvoke(() =>
        {
            try
            {
                switch (e.Kind)
                {
                    case CoreWebView2ScriptDialogKind.Alert:
                        MessageBox.Show(this, e.Message, "Netfish");
                        break;
                    case CoreWebView2ScriptDialogKind.Confirm:
                        if (MessageBox.Show(this, e.Message, "Netfish", MessageBoxButtons.OKCancel) == DialogResult.OK) e.Accept();
                        break;
                    case CoreWebView2ScriptDialogKind.Beforeunload:
                        e.Accept();
                        break;
                }
            }
            finally
            {
                deferral.Complete();
            }
        });
    }

    void OnAcceleratorKey(object? sender, CoreWebView2AcceleratorKeyPressedEventArgs e)
    {
        if (e.KeyEventKind is not (CoreWebView2KeyEventKind.KeyDown or CoreWebView2KeyEventKind.SystemKeyDown) || e.PhysicalKeyStatus.WasKeyDown != 0) return;
        var key = (Keys)e.VirtualKey;
        var commandKeys = (ModifierKeys & (Keys.Control | Keys.Shift)) == (Keys.Control | Keys.Shift);
        if (key == Keys.F11) ToggleFullscreen();
        else if (commandKeys && key == Keys.D) ShowOffline(null); // Downloads
        else if (commandKeys && key == Keys.H && Server.Url is { } server) Navigate(server); // Home
        else return;
        e.Handled = true;
    }

    // ---------- Talking to the page ----------

    void OnPlayerState(Dictionary<string, object?> state)
    {
        // The time changes every frame; four updates a second is plenty for the seek bar.
        if (state.Count == 1 && state.ContainsKey("time-pos"))
        {
            var now = Environment.TickCount64;
            if (now - lastTimePush < 250) return;
            lastTimePush = now;
        }
        // No screensaver in the middle of a film (downloads too, which don't ask for it).
        if (state.TryGetValue("pause", out var pause) && pause is bool paused) KeepAwake(!paused);
        if (state.ContainsKey("ended")) KeepAwake(false);
        bridge.Push("video", state);
    }

    /// <summary>The signed-in session cookie from the web view, for mpv's and the downloads' requests.</summary>
    public async Task<string> CookieHeader(Uri url)
    {
        if (Web == null) return "";
        var cookies = await Web.CookieManager.GetCookiesAsync(url.GetLeftPart(UriPartial.Authority) + "/");
        return string.Join("; ", cookies.Select(c => $"{c.Name}={c.Value}"));
    }

    public void KeepAwake(bool on)
    {
        if (on == awake) return;
        awake = on;
        Native.SetThreadExecutionState(on ? Native.ES_CONTINUOUS | Native.ES_SYSTEM_REQUIRED | Native.ES_DISPLAY_REQUIRED : Native.ES_CONTINUOUS);
    }

    // ---------- Window ----------

    /// <summary>Full screen: the window without its frame, covering the whole monitor.</summary>
    public void ToggleFullscreen()
    {
        var style = (long)Native.GetWindowLongPtr(Handle, Native.GWL_STYLE);
        if (!fullscreen)
        {
            var monitor = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
            placement = new Native.WINDOWPLACEMENT { length = Marshal.SizeOf<Native.WINDOWPLACEMENT>() };
            if (!Native.GetWindowPlacement(Handle, ref placement) || !Native.GetMonitorInfo(Native.MonitorFromWindow(Handle, Native.MONITOR_DEFAULTTONEAREST), ref monitor)) return;
            fullscreen = true;
            Native.SetWindowLongPtr(Handle, Native.GWL_STYLE, (IntPtr)(style & ~Native.WS_OVERLAPPEDWINDOW));
            var r = monitor.rcMonitor;
            Native.SetWindowPos(Handle, IntPtr.Zero, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, Native.SWP_NOOWNERZORDER | Native.SWP_FRAMECHANGED);
        }
        else
        {
            fullscreen = false;
            Native.SetWindowLongPtr(Handle, Native.GWL_STYLE, (IntPtr)(style | Native.WS_OVERLAPPEDWINDOW));
            Native.SetWindowPlacement(Handle, ref placement);
            Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOOWNERZORDER | Native.SWP_FRAMECHANGED);
        }
        bridge.Push("video", new Dictionary<string, object?> { ["fullscreen"] = fullscreen });
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (controller != null)
        {
            controller.Bounds = ClientRectangle;
            controller.IsVisible = WindowState != FormWindowState.Minimized;
            composition?.Device.Commit();
        }
        if (WindowState == FormWindowState.Normal && !fullscreen) normalBounds = Bounds;
    }

    protected override void OnMove(EventArgs e)
    {
        base.OnMove(e);
        controller?.NotifyParentWindowPositionChanged();
        if (WindowState == FormWindowState.Normal && !fullscreen) normalBounds = Bounds;
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        // Typing goes to the page.
        controller?.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
    }

    // ---------- Notifications ("ready to watch") ----------

    NotifyIcon? notices;
    string? noticePath;

    /// <summary>A Windows notification; clicking it brings Netfish forward on that page.</summary>
    public void Notify(string title, string body, string path)
    {
        if (notices == null)
        {
            notices = new NotifyIcon { Icon = Icon, Text = "Netfish" };
            notices.BalloonTipClicked += (_, _) => OpenNotice();
            notices.Click += (_, _) => OpenNotice();
            // The tray icon is only there while a notification is.
            notices.BalloonTipClosed += (_, _) => notices.Visible = false;
        }
        noticePath = path;
        notices.Visible = true;
        notices.ShowBalloonTip(10_000, title, body, ToolTipIcon.None);
    }

    void OpenNotice()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        if (noticePath is { } path)
            _ = Web?.ExecuteScriptAsync($"window.__netfishOpen && window.__netfishOpen({System.Text.Json.JsonSerializer.Serialize(path)})");
        if (notices != null) notices.Visible = false;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        notices?.Dispose();
        AppData.SaveConfig(c =>
        {
            c["bounds"] = new JsonObject { ["x"] = normalBounds.X, ["y"] = normalBounds.Y, ["width"] = normalBounds.Width, ["height"] = normalBounds.Height };
            c["maximized"] = WindowState == FormWindowState.Maximized && !fullscreen;
        });
        store.Shutdown();
        KeepAwake(false);
        Hide(); // gone at once, while mpv winds down
        Player?.Dispose();
        try { controller?.Close(); } catch { }
        controller = null;
        AutoUpdate.Closing(); // a waiting update installs now
        base.OnFormClosing(e);
    }

    // ---------- Mouse: the window gets it (the film's window is disabled), the page needs it ----------

    protected override void WndProc(ref Message m)
    {
        if (controller != null)
        {
            try
            {
                if (m.Msg == Native.WM_SETCURSOR && Native.LowWord(m.LParam) == Native.HTCLIENT)
                {
                    Native.SetCursor(controller.Cursor);
                    m.Result = 1;
                    return;
                }
                if (m.Msg == Native.WM_CAPTURECHANGED && m.LParam != Handle) LetGo();
                if (ForwardMouse(ref m)) return;
            }
            catch (Exception) when (controller == null || m.Msg != Native.WM_SETCURSOR)
            {
                // The page is restarting: nothing to hand the mouse to right now.
            }
        }
        base.WndProc(ref m);
    }

    bool ForwardMouse(ref Message m)
    {
        var msg = m.Msg;
        if (msg is < Native.WM_MOUSEMOVE or > Native.WM_MOUSEHWHEEL && msg != Native.WM_MOUSELEAVE) return false;
        var point = new Native.POINT { X = Native.LowWord(m.LParam), Y = Native.HighWord(m.LParam) };
        uint data = 0;
        if (msg is Native.WM_MOUSEWHEEL or Native.WM_MOUSEHWHEEL)
        {
            // Wheel positions come in screen coordinates.
            Native.ScreenToClient(Handle, ref point);
            data = unchecked((uint)Native.HighWord(m.WParam));
        }
        else if (msg is Native.WM_XBUTTONDOWN or Native.WM_XBUTTONUP or Native.WM_XBUTTONDBLCLK)
        {
            data = unchecked((uint)Native.HighWord(m.WParam));
        }
        var keys = (CoreWebView2MouseEventVirtualKeys)(Native.LowWord(m.WParam) & 0xFFFF);
        if (msg == Native.WM_MOUSELEAVE)
        {
            trackingMouse = false;
            keys = CoreWebView2MouseEventVirtualKeys.None;
        }
        else if (!trackingMouse)
        {
            var track = new Native.TRACKMOUSEEVENT { cbSize = Marshal.SizeOf<Native.TRACKMOUSEEVENT>(), dwFlags = 0x2 /* TME_LEAVE */, hwndTrack = Handle };
            trackingMouse = Native.TrackMouseEvent(ref track);
        }
        // Keep the mouse while a button is held (dragging the seek bar out of the window).
        const int buttons = 0x0001 | 0x0002 | 0x0010 | 0x0020 | 0x0040; // MK_LBUTTON, RBUTTON, MBUTTON, XBUTTON1, XBUTTON2
        var down = msg is Native.WM_LBUTTONDOWN or Native.WM_RBUTTONDOWN or Native.WM_MBUTTONDOWN or Native.WM_XBUTTONDOWN
            or Native.WM_LBUTTONDBLCLK or Native.WM_RBUTTONDBLCLK or Native.WM_MBUTTONDBLCLK or Native.WM_XBUTTONDBLCLK;
        var up = msg is Native.WM_LBUTTONUP or Native.WM_RBUTTONUP or Native.WM_MBUTTONUP or Native.WM_XBUTTONUP;
        if (down)
        {
            Native.SetCapture(Handle);
            if (Native.GetFocus() == Handle) controller!.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
        }
        if (msg is not (Native.WM_MOUSEWHEEL or Native.WM_MOUSEHWHEEL or Native.WM_MOUSELEAVE))
        {
            lastMouse = new Point(point.X, point.Y);
            buttonsDown = (int)keys & buttons;
        }
        controller!.SendMouseInput((CoreWebView2MouseEventKind)msg, keys, data, new Point(point.X, point.Y));
        if (up && buttonsDown == 0) Native.ReleaseCapture();
        m.Result = IntPtr.Zero;
        return true;
    }

    /// <summary>Something else took the mouse mid-press (Alt+Tab, a dialog): let go of the page's buttons.</summary>
    void LetGo()
    {
        if (buttonsDown == 0 || controller == null) return;
        foreach (var (flag, kind, data) in new[]
        {
            (0x0001, CoreWebView2MouseEventKind.LeftButtonUp, 0u),
            (0x0002, CoreWebView2MouseEventKind.RightButtonUp, 0u),
            (0x0010, CoreWebView2MouseEventKind.MiddleButtonUp, 0u),
            (0x0020, CoreWebView2MouseEventKind.XButtonUp, 1u),
            (0x0040, CoreWebView2MouseEventKind.XButtonUp, 2u),
        })
        {
            if ((buttonsDown & flag) != 0) controller.SendMouseInput(kind, CoreWebView2MouseEventVirtualKeys.None, data, lastMouse);
        }
        buttonsDown = 0;
        controller.SendMouseInput(CoreWebView2MouseEventKind.Leave, CoreWebView2MouseEventVirtualKeys.None, 0, Point.Empty);
        trackingMouse = false;
    }
}
