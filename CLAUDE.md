# Netfish

Notes for anyone (person or AI assistant) working on Netfish's code.

## What it is

- A Netflix-style front end for a home media stack: Jellyfin, Seerr, Radarr, Sonarr, Prowlarr, Bazarr and qBittorrent, typically in Portainer stacks on a Raspberry Pi.
- Netfish is its own container: port **7777**, image `ghcr.io/ravifrancesco/netfish`, MIT licence.
- **Netfish never changes how the other services are set up.** It only talks to their APIs. Jellyfin is a hidden engine for streaming and sign-in; nobody opens it directly.
- Every app is a thin shell around the server's web UI, with a native player underneath:
  - **Mac:** Swift/AppKit, libmpv under a transparent WKWebView.
  - **Windows:** C# WinForms, libmpv plus WebView2.
  - **iPhone/iPad:** Swift, AVPlayer under a WKWebView.
  - **Android, Fire TV, Android TV:** one Java app, ExoPlayer under a WebView.
  - **Samsung TV:** a Tizen starter page that loads the web UI.
- English and Italian everywhere. Italian uses the informal "tu"; terms in [docs/i18n-glossary.md](docs/i18n-glossary.md).

## Layout

| Folder | What's there |
|---|---|
| `server/` | Fastify + TypeScript. Routes in `server/src/routes.ts`, logic in `server/src/services/`, one client per service in `server/src/clients/`, the readable log in `server/src/lib/log.ts` |
| `web/` | The React web UI, used by the browser and inside every app |
| `shared/` | TypeScript types shared by server and web (`shared/src/index.ts`) |
| `apps/{mac,windows,ios,android,tizen,common}` | The native shells. `apps/common/player.js` is built from the web app and committed |
| `server/dev/mock.ts`, `server/dev/mock/world.ts` | A fake Jellyfin, Seerr, Radarr, Sonarr, Bazarr and qBittorrent on port 7700, for development |
| `scripts/` | Builds and the release script |
| `release/` | Build output only (not committed) |
| `CHANGELOG.md` | Every version, and what to update for it |

## Conventions

- **Text:** every string the user sees goes through `t()` / `tn()` (keyed by the English text), with the Italian in `web/src/i18n/it/*.ts` (server: `server/src/lib/i18n.ts`). Plain, short sentences; no jargon.
- **Explanations only in Settings.** Cards, pages, buttons and tooltips state facts ("On its way", "12 min left"), never how things work. Settings may explain.
- **The log is for people:** one readable line per event, in the household's time zone (`2026-10-22 21:04:05  info   new titles   Grabbed …`). Never write tokens, keys or passwords to it. `LOG_LEVEL` sets how much is written.
- Keep things minimal. Match the surrounding code's style and comment density.
- Commit messages: "Netfish X.Y.Z" followed by short bullets. No "#N" issue references in commit messages.

## Developing

- Node 22 or later. `npm install` at the root (npm workspaces).
- `npm run dev:mock` runs the mock services, the server against them and the web dev server. Mock users: demo/demo, sam/sam, admin/admin.
  - Mock switches: `MOCK_MORE_FRESH=1` (more well-liked titles nobody has), `MOCK_EMPTY_FIRST_SEARCH=1` (the first search finds nothing), `MOCK_FORCED` (forced subtitle tracks), `MOCK_EMPTY` (empty deleted shows).
  - Stop the mock with `pkill -f "tsx dev/mock.ts"`. Killing whatever listens on port 7700 also kills a Netfish server connected to it.
- `npm run typecheck` checks server and web.
- **Develop against the mock** (and each service's open-source code), never against a real household's server.
- **Never test as a real installed app or touch its data.** Use the Mac self-test build (`apps/mac/build.sh --selftest`) and the Android debug app (`app.netfish.tv.debug`). Test servers set `NETFISH_DATA_DIR` (and `NETFISH_DATA` on Windows) to a scratch folder.
- A running Netfish server only serves the web files that existed when it started: restart it after `npm run build`.
- Gradle and .NET builds don't work inside iCloud Drive folders; the build scripts copy the sources to `~/Library/Caches/netfish-build` first.

## Releasing

1. Raise the version everywhere it appears:
   - `README.md` (the image tag), `docs/install/server.md` and `docs/install/it/server.md`;
   - `apps/android/app/build.gradle` (`netfishVersion`);
   - `apps/ios/Netfish.xcodeproj/project.pbxproj` (MARKETING_VERSION, twice) and `apps/ios/project.yml`;
   - `apps/windows/Netfish.csproj`;
   - the four `package.json` files and `package-lock.json`.
2. Add `## X.Y.Z (date)` to `CHANGELOG.md`: what's new, changed and fixed, and what to update (server, apps). The release page shows this entry.
3. `npm run build:player` and commit `apps/common/player.js` if it changed.
4. Commit "Netfish X.Y.Z", push `main`.
5. `scripts/release.sh` builds every app, tags `vX.Y.Z` and uploads 7 files (server, Mac ×2, Windows, Android, Samsung, iOS). The tag makes GitHub Actions build the Docker image.
6. Check `gh release view vX.Y.Z` (7 files) and `gh run list` (the image build passed).

## Channels and New titles

- **Channels** (`server/src/services/channels.ts`): the library as old-school TV. Each channel's schedule is worked out ahead and kept, so every screen shows the same minute; a short break (the fish) sits between programmes. `PLAN` is the version of the schedule rules: raising it rebuilds every guide from 15 minutes ahead.
  - **Netfish's own channel** (kind `mix`) runs a fixed daily timetable from 06:00 to 06:00: films in the morning, dramas, a documentary at 13:00, sitcoms from 15:00, grown-up cartoons at 18:00, the film at 21:00, short late-night shows at 23:00. Shows keep their time for a week, nothing repeats in a day, new things come first, and breaks are shared out evenly.
  - Nothing made for children is on any channel unless an admin turns on the Kids channel.
- **New titles** (`server/src/services/fresh.ts`): things nobody has, picked from Seerr's discover lists for the channels marked ✨, added to Radarr/Sonarr tagged `netfish-channel`, shown in the guide before they've downloaded, and deleted after they air unless someone keeps them. "New titles a week" is one total shared by all channels.

## Keeping this file current

Update it when something here stops being true: a new folder, a new convention, a changed release step.
