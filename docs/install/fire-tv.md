[Italiano](it/fire-tv.md)

# Fire TV, Fire Stick, Android TV & Google TV

One app, **[Netfish-android.apk](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-android.apk)**, works on every Android device. On a TV it opens in TV mode: the remote's arrows move between rows and buttons, **OK** opens or plays, **Back** closes menus and goes back.

Films play with ExoPlayer, the same engine as Jellyfin's TV app. The TV's hardware decodes the picture and the app decodes every sound format (DTS, TrueHD, Dolby), so your server sends files untouched.

![Netfish in TV mode](../screenshots/tv.jpg)

## Fire TV / Fire Stick (with the Downloader app, no computer)

1. **Turn on developer options** (you do this once):
   1. **Settings → My Fire TV → About**.
   2. Select your device's name (e.g. *Fire TV Stick 4K*) and press **OK** seven times, until it says *You are now a developer*. On older Fire TVs, *Developer Options* is already there and you can skip this.
2. **Settings → My Fire TV → Developer Options**:
   - turn on **ADB debugging**;
   - turn on **Apps from Unknown Sources**. On newer Fire OS this is **Install unknown apps**: open it and allow **Downloader** (after step 3).
3. **Install Downloader:** on the Home screen, search for **Downloader** (orange icon, by AFTVnews) and install it. Open it and allow access to files if asked.
4. In Downloader's address box, type:
   ```
   https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-android.apk
   ```
   Select **Go**. When the download finishes, select **Install**, then **Open**.
5. Enter your server's address (e.g. `192.168.1.50`) and sign in.
6. Netfish is now under **Your Apps & Channels**. To put it on the Home screen, highlight it, press the **☰ menu** button and choose **Move to front**.

You can delete the downloaded file when Downloader offers to, to save space.

## Android TV / Google TV (Sony, TCL, Philips, Chromecast with Google TV…)

1. **Settings → System → About**: select **Android TV OS build** (or **Build**) seven times until it says you're a developer.
2. Install **Downloader** from the **Google Play Store** on the TV.
3. **Settings → Apps → Security & restrictions → Unknown sources** (wording varies): allow **Downloader**.
4. Do steps 4 and 5 of the Fire TV section.

## From a computer instead (adb)

1. Do steps 1 and 2 of your TV's section above.
2. Find the TV's address: **Settings → My Fire TV → About → Network** (Android TV: Settings → Network).
3. Install Android's platform-tools on the computer (Mac: `brew install --cask android-platform-tools`; Windows: [download](https://developer.android.com/tools/releases/platform-tools)), download the APK, then:
   ```bash
   adb connect 192.168.1.60
   adb install -r Netfish-android.apk
   ```
   On the TV, accept **Allow USB debugging?** the first time (tick *Always allow*).

## Using it

- **Arrows, OK, Back** everywhere; **Play/Pause**, **⏪ ⏩** in the player.
- Subtitles lift above the controls while they show.
- No downloads on TVs (that's for phones and tablets).

## Updating

Most new features arrive through your server. For a new app version, repeat step 4 (the link always gives the newest one) and choose **Install**: your sign-in and settings are kept.

## Problems

- **"App not installed":** uninstall any older Netfish first (Settings → Applications → Manage Installed Applications), then install again.
- **Downloader says the file can't be opened:** check the address was typed exactly, including `https://`.
- **"Can't reach …":** check the address in a browser on your phone, and that the TV is on the same network as the server.
