# Third-party software

Netfish's own code is MIT-licensed (see [LICENSE](LICENSE)). The apps use or ship
these projects, each under its own licence:

| Project | Used by | Licence |
|---|---|---|
| [mpv / libmpv](https://mpv.io) | Mac app (Homebrew's libmpv, not bundled); Windows app (bundled `libmpv-2.dll`, built by [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), where its source and build scripts are published) | GPL-2.0-or-later (the Windows build includes FFmpeg and other GPL libraries) |
| [Vulkan Runtime](https://vulkan.lunarg.com) (`vulkan-1.dll`) | Windows app (bundled) | MIT and Apache-2.0 |
| [.NET](https://dotnet.microsoft.com) | Windows app (bundled runtime) | MIT |
| [Microsoft Edge WebView2 SDK](https://www.nuget.org/packages/Microsoft.Web.WebView2) | Windows app | BSD-style (Microsoft) |
| [AndroidX Media3 / ExoPlayer](https://github.com/androidx/media) | Android app | Apache-2.0 |
| [Jellyfin's Media3 FFmpeg decoder](https://github.com/jellyfin/jellyfin-androidx-media) | Android app (audio decoding) | GPL-3.0 (with FFmpeg) |
| [React](https://react.dev), [React Router](https://reactrouter.com), [TanStack Query](https://tanstack.com/query), [hls.js](https://github.com/video-dev/hls.js), [lucide](https://lucide.dev) | Web interface | MIT / Apache-2.0 / ISC |
| [Fastify](https://fastify.dev) and its plugins | Server | MIT |
| [Inter](https://rsms.me/inter/) | Web interface font | OFL-1.1 |

Netfish talks to [Jellyfin](https://jellyfin.org), [Seerr](https://github.com/seerr-team/seerr), [Radarr](https://radarr.video), [Sonarr](https://sonarr.tv), [Bazarr](https://www.bazarr.media), [qBittorrent](https://www.qbittorrent.org), [TMDB](https://www.themoviedb.org) and [MDBList](https://mdblist.com) through their public APIs; it includes none of their code. This product uses the TMDB API but is not endorsed or certified by TMDB.
