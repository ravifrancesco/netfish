[Italiano](it/windows.md)

# Windows

For Windows 10 and 11, 64-bit.

Films play with mpv underneath Netfish's own controls, like Jellyfin Media Player: every format, every audio and subtitle track, and the server sends files untouched.

1. Download **[Netfish-windows.exe](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-windows.exe)** and run it.
2. The installer isn't signed yet, so Windows may show **Windows protected your PC**: click **More info → Run anyway**.
3. It installs for your account only (no administrator rights), adds Netfish to the Start menu and the desktop, and offers to open it.
4. Enter your server's address (e.g. `192.168.1.50`) and sign in.

**Keys:** F11 full screen, Ctrl+Shift+H home, Ctrl+Shift+D downloads, plus Space, ←/→ and F in the player.

**Downloads** for offline viewing: the **Download** button on any movie or episode. Files are saved exactly as they are on the server (no conversion), in `%LOCALAPPDATA%\Netfish\Offline`. Interrupted downloads continue where they stopped.

**Updating:** from version 0.3, Netfish tells you on Home when a new version is out: **Settings → Desktop app → Update** downloads it, installs it and reopens Netfish. Your sign-in and downloads are kept. Older versions: run the new installer; it replaces the app. From 0.4 you can also switch on **Update Netfish by itself** there: new versions download in the background and install when you close Netfish, so nothing you're watching is interrupted.

**Uninstalling:** Settings → Apps → Netfish → Uninstall. It asks whether to delete your downloads too.

**Problems:**

- **"Netfish needs Microsoft Edge WebView2":** click Yes to open Microsoft's download page and install the *Evergreen* runtime (Windows 11 and up-to-date Windows 10 already have it).
- **"Netfish's video player couldn't load":** reinstall Netfish. In a virtual machine, enable 3D acceleration or the video may not show.
