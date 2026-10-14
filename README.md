# Netfish

[![Latest release](https://img.shields.io/github/v/release/ravifrancesco/netfish)](https://github.com/ravifrancesco/netfish/releases/latest) [![Server image](https://img.shields.io/badge/image-ghcr.io%2Fravifrancesco%2Fnetfish-blue)](https://github.com/ravifrancesco/netfish/pkgs/container/netfish) [![Licence: MIT](https://img.shields.io/badge/licence-MIT-green)](LICENSE)

A Netflix-style front door for a home media server. One app to browse, discover, request, download and watch, on top of the stack you already run (Jellyfin, Seerr, Radarr, Sonarr, Prowlarr, Bazarr and qBittorrent), **without changing any of it**.

- **Home like a streaming service:** Continue Watching, *Top picks for you* (blended from what you watched recently), *Because you watched…*, new arrivals, trending and popular titles, coming soon.
- **Everything in one search:** your library and everything TMDB knows, with clear badges (in library, requested, downloading 45%, partly available).
- **Request in one click:** movies, or pick seasons of a show. Filed in Seerr as *your* user, so approvals and quotas still apply.
- **Live download progress:** from Radarr/Sonarr's queues, with speed and ETA from qBittorrent. Season packs show as one item, and stalls and import problems are explained.
- **Versions:** Radarr/Sonarr's Interactive Search, inside Netfish. See every release from every indexer, filter by audio language, quality or text, and download the one you want. Netfish warns when a release probably won't replace your current copy, and admins can cap how big a release people may pick.
- **Another audio language:** the same panel with a language filter, highlighting multi-audio releases that keep the original language.
- **Subtitles in any language:** fetched through Bazarr for a movie, a season or one episode; the library refreshes when they arrive.
- **Scores and trailers:** TMDB, IMDb, Rotten Tomatoes (critics and audience), Metacritic and Letterboxd, plus in-app trailers for any title.
- **A real player:** direct play when the browser can handle the file. Otherwise Jellyfin repackages it (cheap on a Pi), and only transcodes as a last resort. It supports audio and subtitle switching, resume, skip intro, next-episode autoplay and keyboard shortcuts.
- **Apps:** the web app at `http://<pi>:7777` (works on phones too), plus apps for Mac, Windows, iPhone/iPad and Android (phones, tablets, Fire TV and Android TV). The Mac, Windows, iPhone/iPad and Android phone apps can also **download movies and episodes for offline viewing**.
- **Set up from the app:** a first-run screen, then **Settings → Connections** for every service's address and API key, with a test button.

Sign-in uses your Jellyfin accounts. Jellyfin keeps doing the heavy lifting (library, streaming, users) behind the scenes; nobody needs to open it.

## Download

| For | Get it |
|---|---|
| **Server** (Raspberry Pi or any Docker host) | `ghcr.io/ravifrancesco/netfish:latest`, pulled by Portainer: see [Install on the Pi](#install-on-the-pi-portainer) |
| **Mac** (Apple silicon) | [Netfish-mac.dmg](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-mac.dmg) |
| **Windows 10/11** (64-bit) | [Netfish-windows.exe](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-windows.exe) |
| **Android**: phones, tablets, Fire TV, Android TV | [Netfish-android.apk](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-android.apk) |
| **iPhone & iPad** | Built with Xcode on a Mac: see [iPhone & iPad app](#iphone--ipad-app) |

Every version is on the [Releases](https://github.com/ravifrancesco/netfish/releases) page. These links always give the newest one.

## How it fits together

```
 Browser · Mac · Windows · iPhone/iPad · Android · Fire TV
                 │  one URL, one login
                 ▼
        ┌──────────────────┐   API keys live here, never in clients
        │  Netfish  :7777  │──────────────┐
        └──────────────────┘              │
          │ streams & images (proxied)    │ JSON APIs
          ▼                               ▼
      Jellyfin              Seerr · Radarr · Sonarr · Bazarr · qBittorrent · (MDBList)
```

### What's where

| Folder | What it is |
|---|---|
| `server/` | The Netfish server (Node + Fastify), which runs on the Pi. It aggregates the services, holds their API keys, proxies Jellyfin media read-only behind your session, and serves the web app. |
| `web/` | The interface (React + Vite) every app shows. It only talks to the Netfish server, so the engine behind it can change without touching the apps. |
| `shared/` | The API contract (TypeScript types) used by the server and the interface. |
| `apps/mac/` | The Mac app (Swift): the interface on top, mpv playing films underneath. |
| `apps/ios/` | The iPhone & iPad app (Swift). |
| `apps/android/` | The Android app (Java): phones, tablets, Fire TV and Android TV. |
| `apps/windows/` | The Windows app (C#): the interface on top, mpv playing films underneath. |
| `apps/common/` | The setup page, the downloads page and the icon shared by the apps. |
| `Dockerfile`, `docker/`, `docker-compose.yml` | Running the server on the Pi. |
| `scripts/` | Build helpers. |
| `release/` | **The only place local builds go**: `Netfish-<version>-server.tar.gz` (the Pi image), `-mac.dmg`, `-windows.exe`, `-android.apk`. Not in git; published versions are on GitHub Releases. |

The apps show the interface from your server, so most new features arrive by updating the Pi; the apps themselves rarely change.

## Install on the Pi (Portainer)

**1. Portainer → Stacks → Add stack**, name it `netfish`, paste [`docker-compose.yml`](docker-compose.yml), and **Deploy**. No variables are needed: Portainer pulls the ready-made image `ghcr.io/ravifrancesco/netfish:latest` (built by GitHub for Raspberry Pi and PCs).

**2. Updating:** Portainer → Stacks → netfish → **Update the stack** with **Re-pull image** switched on (or Containers → netfish → **Recreate** with **Pull latest image**). Your settings are kept. To stay on one version, use a version tag instead of `latest`, e.g. `ghcr.io/ravifrancesco/netfish:0.1.0`.

<details>
<summary>Or build the image on the Pi yourself</summary>

Download **Netfish-server.tar.gz** from [Releases](https://github.com/ravifrancesco/netfish/releases) (or make it with `npm run pack:pi`). In Portainer → **Images** → **Build a new image**: name it `netfish:latest`, choose **Upload**, select the file, and click **Build** (a few minutes on a Pi). Then set `NETFISH_IMAGE=netfish:latest` in the stack's environment variables. Repeat for updates.

</details>

**3. Open `http://<pi-ip>:7777`.** Netfish asks for your Jellyfin address: `http://host.docker.internal:8096` if Jellyfin runs on the same Pi. Sign in with a Jellyfin **admin** account, then open **Settings → Connections** and fill in Seerr, Radarr, Sonarr, Bazarr, qBittorrent and (optionally) MDBList. Each has a **Test** button, and changes apply immediately.

If Netfish ever points at the wrong Jellyfin and nobody can sign in, use **Change the Jellyfin address** on the sign-in screen with the *setup code* printed in Netfish's log (Portainer → Containers → netfish → Logs).

### Admin settings in the app

- **Connections:** addresses and API keys of every service, with live status. Keys are stored on the server in a file only Netfish can read and are never sent back to browsers. Stack variables, if you set any, are just starting values.
- **Downloads:** who can pick specific versions (everyone or admins), and max release size for movies and per episode. Releases over the limit are hidden in Versions and refused by the server, and season packs count per episode. Admins can still show and pick them. Automatic downloads from requests follow Radarr/Sonarr's own size settings.

Everything is kept in `/docker-data-volumes/netfish-data` on the Pi (change the path in the stack if you keep container data elsewhere), so updates don't lose it. Netfish creates that folder and gives it to `PUID`/`PGID` (1000 by default) on startup.

### Optional stack variables

You can also pre-fill connections from the stack (see [`.env.example`](.env.example)). They appear in the app as "From the stack", and anything saved in the app takes over.

| Variable | Notes |
| --- | --- |
| `NETFISH_IMAGE` | Defaults to `ghcr.io/ravifrancesco/netfish:latest`; `netfish:latest` if you built the image on the Pi. |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | API key optional: refreshes items when new subtitles arrive. |
| `SEERR_*`, `RADARR_*`, `SONARR_*`, `BAZARR_*`, `QBITTORRENT_*`, `MDBLIST_API_KEY` | Same as in Settings → Connections. |
| `MANUAL_GRABS` | Starting value for who may pick versions (`all` / `admin`). |
| `METADATA_LANGUAGE` | Language for TMDB titles and descriptions (`en`, `es`…). |
| `TRUST_PROXY` | `true` behind a reverse proxy. |

## Playback: who does the work?

Your **device** decodes the video (the computer's or phone's GPU), never the Pi. Jellyfin on the Pi does one of three things, and the player shows which:

1. **Direct play:** sends the file untouched. Netfish declares what your device can decode (H.264, HEVC, AV1, VP9; AAC, Opus, FLAC; MP4 and, in Chrome/Edge, MKV; the Mac, Windows and Android apps play nearly everything), so most Radarr/Sonarr downloads play this way.
2. **Repackaged:** rewraps the video untouched. It's used for AC3/DTS audio, which browsers can't play, so only the audio gets converted, which is light work.
3. **Transcoding:** only when your device can't decode the video at all, image-based subtitles must be burned in, or you cap the quality for remote viewing. This is the only case that's heavy on a Pi.

## Mac app

A native Mac app (`apps/mac/`) built the way Jellyfin Media Player works: **mpv plays the film inside the window, underneath Netfish's own interface**, so you get Netfish's player (controls, menus, skip intro, next episode) while mpv decodes everything itself (MKV, DTS/TrueHD/Dolby, picture subtitles, HDR) with the Mac's hardware decoder. The server just sends the file. Audio and subtitle changes are instant.

**Install:** `brew install mpv` once (the app uses its libmpv), then open [Netfish-mac.dmg](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-mac.dmg) and drag Netfish to Applications. The app isn't notarized yet, so the first time right-click it → **Open**. On first launch, enter your server address (e.g. `192.168.1.50`).

**Downloads:** the **Download** button, the Offline tabs and the downloads page (⇧⌘D) work as before; files live in `~/Library/Application Support/app.netfish.mac` and are saved as MP4.

Build it yourself: `npm run build:mac` (Xcode command-line tools + Homebrew mpv; no Xcode needed).

## Windows app

`apps/windows/` is a native Windows app built the same way as the Mac one: **mpv draws the film underneath the Netfish interface** (Edge's WebView2, transparent where the picture shows), like Jellyfin Media Player. mpv decodes with the PC's graphics hardware and plays every format and subtitle itself, so the server just sends the file.

**Install:** run [Netfish-windows.exe](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-windows.exe) on the PC (Windows 10 or 11, 64-bit). It installs for your account only, without admin rights, and adds Netfish to the Start menu and desktop. The installer isn't signed yet, so Windows SmartScreen may say *Windows protected your PC*: click **More info → Run anyway**. On first launch, enter your server address (e.g. `192.168.1.50`). Remove it from **Settings → Apps** like any app.

**Downloads:** the **Download** button, the Offline tabs and the downloads page (Ctrl+Shift+D) work like on the Mac. Files are saved **exactly as they are on the server** (mpv plays them all, with every audio and subtitle track), so downloading costs the Pi nothing. They live in `%LOCALAPPDATA%\Netfish\Offline`. Interrupted downloads continue where they stopped.

**Keys:** F11 full screen, Ctrl+Shift+H home, Ctrl+Shift+D downloads, plus the player's own keys.

Build it yourself, on a Mac or PC: `npm run build:windows`. It needs the .NET 8 SDK and, on a Mac, `brew install makensis sevenzip`. It downloads a pinned libmpv build (shinchiro's, the one mpv.io links to) and checks its checksum.

## Android app (phones, tablets, Fire TV, Android TV)

One app (`apps/android/`) for every Android device. On a **TV** (Fire TV, Android TV) it shows the Netfish interface in **TV mode**: the remote's arrows move between rows and buttons, Select opens or plays, Back closes menus and then goes back; no downloads on TV. On a **phone or tablet** it's the touch interface, with **downloads**: the Download button, Offline tabs and the downloads page work like on the Mac, files are saved as MP4 in the app's storage, and away from home the app opens your downloads.

Films play like on the Mac: **ExoPlayer draws the picture underneath Netfish's own player**, with Jellyfin's FFmpeg audio decoders (the same engine as Jellyfin's Android TV app). The device's hardware decodes the picture and the app decodes any sound format (DTS, TrueHD, Dolby), so the server sends files untouched; ExoPlayer draws every kind of subtitle, picture ones too, and lifts them above the controls when they show. The app tells the server exactly which video formats this device's decoders handle, so only what it truly can't play gets converted. On a phone a film turns to landscape full screen.

The app is [Netfish-android.apk](https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-android.apk) (the same file for every device).

**Phone or tablet:** open that link on the phone and tap the downloaded file; Android asks once to allow installing apps from your browser.

**Fire TV, with the Downloader app (no computer needed):**

1. **Settings → My Fire TV → About**: click your device's name seven times until it says you're a developer.
2. **Settings → My Fire TV → Developer Options**: turn on **ADB debugging**, and under **Install unknown apps** allow **Downloader** (install *Downloader* from the Amazon Appstore first).
3. Open Downloader and enter `https://github.com/ravifrancesco/netfish/releases/latest/download/Netfish-android.apk`, then **Install**.
4. Open **Netfish** from Your Apps & Channels and type your server address (just `192.168.1.50` is enough).

**Fire TV, from a computer:** do steps 1–2, find the TV's address in **Settings → My Fire TV → About → Network** (e.g. `192.168.1.60`), then with Android's platform-tools (`brew install --cask android-platform-tools`):

```bash
adb connect 192.168.1.60
adb install -r Netfish-android.apk
```

Accept the "Allow USB debugging?" prompt on the TV the first time. To update later, install the new APK the same way: your sign-in is kept.

Build it yourself: `npm run build:android` (JDK 17+ and the Android SDK; set `sdk.dir` in `apps/android/local.properties`). Try TV mode in any browser with `http://<server>:7777/?tv=1`.

## iPhone & iPad app

`apps/ios/` is a universal app around the same interface, with **downloads**: the Download button, Offline tabs and the downloads page work like on the Mac, files live in the app's private storage, keep downloading in the background, and play without a connection (away from home, the app opens your downloads automatically). Downloads are saved as MP4 (H.264/HEVC) since iPhones don't play MKV; Netfish asks Jellyfin to repackage when needed.

Films play with **Apple's player underneath Netfish's own player** (like the Mac app with mpv), with picture in picture and AirPlay: MP4/MOV, H.264/HEVC and Dolby sound play as-is; MKV files are rewrapped by the server (light work) and DTS/TrueHD sound is converted. Subtitles are drawn by Netfish over the picture.

**Install it on your iPhone/iPad:**

1. Install **Xcode** from the Mac App Store and open it once.
2. Open `apps/ios/Netfish.xcodeproj`. Select the **Netfish** target → **Signing & Capabilities** → **Team**: add your Apple ID (Xcode → Settings → Accounts) and pick it. If Xcode says the bundle ID is taken, change `app.netfish.ios` to something of your own, e.g. `com.yourname.netfish`.
3. Plug in the iPhone/iPad (or pick it over Wi-Fi), choose it as the run destination, press **Run** (⌘R). On the device: **Settings → General → VPN & Device Management** → trust your developer certificate. On iOS 16+ also turn on **Settings → Privacy & Security → Developer Mode**.
4. On first launch, allow **Local Network** access, then enter your server address.

With a free Apple ID the app must be re-installed from Xcode every 7 days; a paid Apple Developer account ($99/year) makes it last a year and allows TestFlight. The project is generated from `apps/ios/project.yml` with XcodeGen (`brew install xcodegen && cd apps/ios && xcodegen generate`).

## Developing

```bash
npm install
npm run dev:mock     # fake Jellyfin/Seerr/Radarr/Sonarr/Bazarr/qBit + Netfish + web UI
```

Open http://localhost:5173 and sign in as `demo` / `demo` (or `admin` / `admin`). The mock (`server/dev/mock.ts`) has a small catalog, watch history, requests and downloads that progress in real time and land in the library, plus a generated test video with two audio tracks (needs `ffmpeg`).

Against real services: copy `.env.example` to `server/.env`, swap `host.docker.internal` for your Pi's IP, then run `npm run dev`.

`npm run typecheck`, `npm run build`, and `npm start` (production bundle on :7777).

### Building the apps and releasing

| Command | Makes (in `release/`) | Needs |
|---|---|---|
| `npm run pack:pi` | `-server.tar.gz`, the Pi build bundle | Node 22 |
| `npm run build:mac` | `-mac.dmg` | a Mac with Xcode's command-line tools, `brew install mpv` |
| `npm run build:windows` | `-windows.exe` | .NET 8 SDK, `brew install makensis sevenzip` (works on a Mac) |
| `npm run build:android` | `-android.apk` | JDK 17+, Android SDK (`sdk.dir` in `apps/android/local.properties`) |

The Android and Windows builds run from a copy in `~/Library/Caches/netfish-build` (newer macOS won't let their tools copy files out of iCloud Drive). Every push to `main` makes GitHub build the server image `ghcr.io/ravifrancesco/netfish:latest`.

**To publish a version:** raise `version` in `package.json` (and `netfishVersion` in `apps/android/app/build.gradle`), commit, then run `scripts/release.sh`. It builds everything, tags `v<version>` (GitHub then builds the image `:<version>`), and creates the GitHub release with the four files under fixed names, so the download links above always point at the newest one.

## Good to know

- **Picking a version replaces the file.** Radarr/Sonarr import it over your current copy only if it isn't lower quality. Netfish flags releases that would likely be refused; those can still be imported by hand in Radarr/Sonarr.
- **Raspberry Pi and transcoding:** Netfish asks Jellyfin to direct-play or repackage whenever possible. Burned-in (image) subtitles or very high bitrates force real transcoding, which is slow on a Pi.
- **Letterboxd** has no public API; its score comes from MDBList when a key is set, otherwise Netfish links to the film's page.
- **Artwork cache:** Netfish keeps a copy of every poster it has shown (and fetches library posters ahead of time) in `/config/cache/images`, up to 1 GB by default (`IMAGE_CACHE_MB` to change). Covers load instantly after the first time, and apps keep them too.

## Licence

Netfish is MIT-licensed (see [LICENSE](LICENSE)). The apps include or use other open-source projects under their own licences, notably mpv (GPL) in the Windows app: see [THIRD-PARTY.md](THIRD-PARTY.md).

## Roadmap

- **Phase 2:** Netfish's own playback engine (library straight from Radarr/Sonarr plus ffmpeg) and **Import from Jellyfin** (users, watched state, resume points), so Jellyfin can be retired.
- Muted trailer previews on the home hero; profile pictures and per-user preferences.
