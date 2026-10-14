using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Netfish;

static class Program
{
    [STAThread]
    static void Main()
    {
        // One Netfish at a time: opening it again brings the open one forward.
        using var single = new Mutex(true, @"Local\Netfish.App", out var first);
        if (!first)
        {
            BringOtherToFront();
            return;
        }

        // The window behind the page stays dark while it loads (no white flash).
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // WebView2 (Edge's engine) shows the interface. It comes with Windows 11 and up-to-date Windows 10.
        try
        {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var answer = MessageBox.Show(
                "Netfish needs Microsoft Edge WebView2, which isn't on this PC yet. Open the download page?",
                "Netfish", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer == DialogResult.Yes)
                Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
            return;
        }
        if (!MpvPlayer.Available(out var problem))
        {
            MessageBox.Show($"Netfish's video player (libmpv-2.dll, with vulkan-1.dll beside it) couldn't load. Reinstalling Netfish usually fixes this.\n\n{problem}", "Netfish", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Application.Run(new MainWindow());
    }

    static void BringOtherToFront()
    {
        var me = Environment.ProcessId;
        foreach (var other in Process.GetProcessesByName("Netfish"))
        {
            if (other.Id == me || other.MainWindowHandle == IntPtr.Zero) continue;
            if (Native.IsIconic(other.MainWindowHandle)) Native.ShowWindow(other.MainWindowHandle, 9 /* SW_RESTORE */);
            Native.SetForegroundWindow(other.MainWindowHandle);
            return;
        }
    }
}
