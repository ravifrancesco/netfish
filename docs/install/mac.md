[Italiano](it/mac.md)

# Mac

For Macs with Apple silicon (M1 or newer), macOS 15 Sequoia or later. Nothing else to install: the app carries its own film player.

Films play with mpv underneath Netfish's own controls, like Jellyfin Media Player: every format, every audio and subtitle track, and the server sends files untouched.

1. Download **[Netfish-mac.dmg](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-mac.dmg)**, open it and drag **Netfish** to **Applications**.
2. **First launch:** the app isn't notarized by Apple yet, so macOS blocks it the first time ("Apple could not verify…"). Click **Done**, then **System Settings → Privacy & Security**, scroll down to *"Netfish" was blocked* and click **Open Anyway** (then **Open Anyway** again and your password). On older macOS, **right-click** Netfish → **Open** → **Open** also works.
3. Enter your server's address (e.g. `192.168.1.50`) and sign in.

The app is in Italian when your Mac's language is Italian.

**Downloads** for offline viewing: the **Download** button on any movie or episode. Find them in the profile menu → **Downloads on this computer** (⇧⌘D). They're stored in `~/Library/Application Support/app.netfish.mac`.

**Updating:** from version 0.3, Netfish tells you on Home when a new version is out: **Settings → Desktop app → Update** downloads it, swaps it in and reopens Netfish. Your sign-in and downloads are kept. (Netfish must be in your Applications folder for this.) Older versions: download the new DMG and replace the app. From 0.4 you can also switch on **Update Netfish by itself** there: new versions download in the background and go in when you quit Netfish, so nothing you're watching is interrupted.

**Problems:**

- **"Netfish is damaged and can't be opened":** the download was marked as unsafe by the browser. In Terminal run `xattr -cr /Applications/Netfish.app`, then open it again.
- **"You can't use this version of the application with this version of macOS":** Netfish needs macOS 15 Sequoia or later.
- **The app quits as soon as it opens:** please send the report macOS shows (*Netfish quit unexpectedly* → **Report…**, the first 30 lines) with your issue on GitHub.
