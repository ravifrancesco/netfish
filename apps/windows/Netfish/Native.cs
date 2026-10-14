using System.Runtime.InteropServices;

namespace Netfish;

/// <summary>The few Windows calls the app needs that .NET doesn't wrap.</summary>
static class Native
{
    public const int WM_SETCURSOR = 0x0020;
    public const int WM_CAPTURECHANGED = 0x0215;
    public const int WM_MOUSEMOVE = 0x0200;
    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_LBUTTONDBLCLK = 0x0203;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_RBUTTONDBLCLK = 0x0206;
    public const int WM_MBUTTONDOWN = 0x0207;
    public const int WM_MBUTTONUP = 0x0208;
    public const int WM_MBUTTONDBLCLK = 0x0209;
    public const int WM_MOUSEWHEEL = 0x020A;
    public const int WM_XBUTTONDOWN = 0x020B;
    public const int WM_XBUTTONUP = 0x020C;
    public const int WM_XBUTTONDBLCLK = 0x020D;
    public const int WM_MOUSEHWHEEL = 0x020E;
    public const int WM_MOUSELEAVE = 0x02A3;
    public const int HTCLIENT = 1;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct TRACKMOUSEEVENT { public int cbSize; public uint dwFlags; public IntPtr hwndTrack; public uint dwHoverTime; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT { public int length; public int flags; public int showCmd; public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition; }

    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll")] public static extern IntPtr SetCapture(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr GetFocus();
    [DllImport("user32.dll")] public static extern IntPtr SetCursor(IntPtr cursor);
    [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr instance, IntPtr name);
    [DllImport("user32.dll")] public static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT track);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT placement);
    [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT placement);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public const int GWL_STYLE = -16;
    public const long WS_OVERLAPPEDWINDOW = 0x00CF0000;
    public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_FRAMECHANGED = 0x0020, SWP_NOOWNERZORDER = 0x0200;
    public const uint MONITOR_DEFAULTTONEAREST = 2;
    public const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;

    public static int LowWord(IntPtr value) => unchecked((short)(long)value);
    public static int HighWord(IntPtr value) => unchecked((short)((long)value >> 16));

    /// <summary>Dark title bar in the app's own background colour (Windows 11; dark only on Windows 10).</summary>
    public static void DarkTitleBar(IntPtr hwnd)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
        int caption = 0x000B0806; // #06080b as 0x00BBGGRR
        DwmSetWindowAttribute(hwnd, 35, ref caption, sizeof(int)); // DWMWA_CAPTION_COLOR
        int border = caption;
        DwmSetWindowAttribute(hwnd, 34, ref border, sizeof(int)); // DWMWA_BORDER_COLOR
    }
}

// ---------- DirectComposition ----------
// The web page is drawn by DirectComposition *above* the window's child windows
// (a "topmost" target), and mpv draws the film into a child window: so the film
// shows through wherever the page is transparent, and the page's controls float
// on top, like Jellyfin Media Player.

[ComImport, Guid("C37EA93A-E7AA-450D-B16F-9746CB0407F3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDCompositionDevice
{
    void Commit();
    void WaitForCommitCompletion();
    void GetFrameStatistics(IntPtr statistics);
    IDCompositionTarget CreateTargetForHwnd(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool topmost);
    IDCompositionVisual CreateVisual();
}

[ComImport, Guid("EACDD04C-117E-4E17-88F4-D1B12B0E3D89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDCompositionTarget
{
    void SetRoot(IDCompositionVisual visual);
}

// Only passed to WebView2, which connects its own visuals under it.
[ComImport, Guid("4D93059D-097B-4651-9A60-F0F25116E2F3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDCompositionVisual
{
}

sealed class Composition
{
    [DllImport("dcomp.dll")]
    static extern int DCompositionCreateDevice2(IntPtr renderingDevice, [In] ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object device);

    public IDCompositionDevice Device { get; }
    public IDCompositionVisual Root { get; }
    readonly IDCompositionTarget target; // kept alive with the window

    public Composition(IntPtr hwnd)
    {
        var iid = typeof(IDCompositionDevice).GUID;
        Marshal.ThrowExceptionForHR(DCompositionCreateDevice2(IntPtr.Zero, ref iid, out var device));
        Device = (IDCompositionDevice)device;
        target = Device.CreateTargetForHwnd(hwnd, topmost: true);
        Root = Device.CreateVisual();
        target.SetRoot(Root);
    }
}
