import AppKit
@preconcurrency import WebKit

/// window.netfishDesktop in the Mac app: the same calls the previous desktop
/// app offered (server setup, downloads, the downloads page), plus
/// `videoOverlay`: the web player's controls drive mpv, which draws the film
/// underneath the page.
final class MacBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

    static let script = """
    (() => {
      if (window.netfishDesktop) return;
      const call = (cmd, args) => window.webkit.messageHandlers.netfish.postMessage({ cmd, args: args === undefined ? null : args });
      const offline = new Set();
      window.__netfishOfflineChanged = (list) => offline.forEach((cb) => { try { cb(list); } catch (e) {} });
      const video = new Set();
      window.__netfishVideo = (state) => video.forEach((cb) => { try { cb(state); } catch (e) {} });
      const updates = new Set();
      window.__netfishUpdate = (p) => updates.forEach((cb) => { try { cb(p); } catch (e) {} });
      window.netfishDesktop = {
        platform: 'darwin',
        version: '\(version)',
        // Downloads are played by the downloads page (Safari's engine): MP4.
        offlineFormat: 'apple',
        changeServer: () => { call('changeServer'); },
        connect: (input) => call('connect', input),
        currentServer: () => call('currentServer'),
        download: (d) => call('download', d),
        offlineList: () => call('list'),
        onOfflineChange: (cb) => { offline.add(cb); return () => offline.delete(cb); },
        removeOffline: (id) => call('remove', id),
        removeOfflineSeries: (key) => call('removeSeries', key),
        retryOffline: (id) => call('retry', id),
        offlineUsage: () => call('usage'),
        clearOffline: () => call('clear'),
        openOffline: (target) => { call('openOffline', target || {}); },
        openServer: () => { call('openServer'); },
        toggleFullscreen: () => { call('fullscreen'); },
        update: {
          check: () => call('updateCheck'),
          install: () => call('updateInstall'),
          onProgress: (cb) => { updates.add(cb); return () => updates.delete(cb); },
        },
        videoOverlay: {
          name: 'mpv',
          profile: () => call('videoProfile'),
          load: (request) => call('videoLoad', request),
          command: (name, value) => { call('videoCommand', { name, value: value === undefined ? null : value }); },
          onState: (cb) => { video.add(cb); return () => video.delete(cb); },
        },
      };
      // The page's header works as the title bar: drag it to move the window, double-click to zoom.
      const DRAG = '.nav, .page__head, .player__top, .player, .login, header.bar, .native-watch, [data-window-drag]';
      const INTERACTIVE = 'a, button, input, select, textarea, label, video, [role="button"], [role="slider"], [contenteditable], .login__card, .menu, .player__bottom, .player__menu, .player__why, .player__skip, .player__next';
      const draggable = (el) => {
        if (!(el instanceof Element) || el.closest(INTERACTIVE)) return false;
        if (location.protocol === 'netfish-offline:' && location.pathname.endsWith('setup.html')) return !el.closest('form') || el.matches('form');
        const region = el.closest(DRAG);
        // The player only drags from its top strip, so clicks on the picture still pause/play.
        if (region && region.classList.contains('player') && !el.closest('.player__top')) return false;
        return Boolean(region);
      };
      addEventListener('mousedown', (e) => { if (e.button === 0 && e.detail === 1 && draggable(e.target)) call('drag'); }, true);
      addEventListener('dblclick', (e) => { if (draggable(e.target)) call('zoom'); }, true);
    })();
    """

    private weak var window: MainWindow?
    private let store = OfflineStore.shared
    /// The newer release the last check found.
    private var release: Updater.Release?

    init(window: MainWindow) {
        self.window = window
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return replyHandler(nil, L("Bad request")) }
        let args = body["args"]
        let origin = message.frameInfo.securityOrigin
        let local = origin.protocol == LocalScheme.scheme
        let fromServer = Server.url.map { origin.protocol == $0.scheme && origin.host == $0.host && origin.port == ($0.port ?? 0) } ?? false
        guard message.frameInfo.isMainFrame, local || fromServer else { return replyHandler(nil, L("Not allowed here")) }

        Task { @MainActor in
            do {
                replyHandler(try await self.handle(cmd, args, local: local), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    @MainActor
    private func handle(_ cmd: String, _ args: Any?, local: Bool) async throws -> Any? {
        guard let window else { return nil }
        switch cmd {
        // Server
        case "currentServer": return Server.url?.absoluteString ?? NSNull()
        case "changeServer":
            window.showSetup(error: nil)
            return nil
        case "connect":
            guard local else { throw Problem(L("Not allowed here")) }
            let url = try Server.normalize(args as? String ?? "")
            try await Server.probe(url)
            Server.url = url
            window.showServer(fresh: true)
            return url.absoluteString

        // Downloads
        case "list": return store.publicList()
        case "download": return try await store.start(args as? [String: Any] ?? [:])
        case "remove": return await store.remove(args as? String ?? "")
        case "removeSeries": return await store.removeSeries(args as? String ?? "")
        case "retry": return try await store.retry(args as? String ?? "")
        case "usage": return store.usage()
        case "clear": return await store.clear()
        case "openOffline":
            window.showOffline(args as? [String: Any] ?? [:])
            return nil
        case "openServer":
            window.showServer()
            return nil

        // Updates from GitHub Releases
        case "updateCheck":
            release = try await Updater.check()
            return [
                "current": MacBridge.version,
                "latest": release?.version ?? NSNull(),
                "available": release != nil,
                "canInstall": release?.download != nil,
                "page": release?.page?.absoluteString ?? NSNull(),
            ] as [String: Any]
        case "updateInstall":
            if release == nil { release = try await Updater.check() }
            guard let found = release else { throw Problem(L("Netfish is up to date")) }
            try await Updater.install(found) { [weak window] received, total in
                Task { @MainActor in window?.push("__netfishUpdate", ["received": received, "total": total]) }
            }
            return nil

        // Window
        case "fullscreen":
            window.window?.toggleFullScreen(nil)
            return nil
        case "drag":
            window.web.dragWindow()
            return nil
        case "zoom":
            window.window?.performZoom(nil)
            return nil

        // Playback in mpv
        case "videoProfile": return MacBridge.profile
        case "videoLoad":
            guard let request = args as? [String: Any], let urlString = request["url"] as? String, let url = URL(string: urlString), Server.owns(url) else {
                throw Problem(L("Nothing to play"))
            }
            let cookie = await window.cookieHeader(for: url)
            let audio = (request["audio"] as? [String: Any])?["position"] as? Int
            let subtitles = request["subtitles"] as? [String: Any]
            let subtitle = (subtitles?["mode"] as? String) == "on" ? ((subtitles?["position"] as? Int).map(String.init) ?? "auto") : "no"
            let external = (request["externalSubtitles"] as? [[String: Any]] ?? []).compactMap { $0["url"] as? String }
            window.player.load(url: urlString, start: request["startSeconds"] as? Double ?? 0, cookie: cookie, audio: audio, subtitle: subtitle, external: external)
            return nil
        case "videoCommand":
            let command = args as? [String: Any] ?? [:]
            let value = command["value"]
            let player = window.player
            switch command["name"] as? String {
            case "play": player.set("pause", "no")
            case "pause": player.set("pause", "yes")
            case "seek": if let t = value as? Double { player.command(["seek", String(max(0, t)), "absolute"]) }
            case "volume": if let v = value as? Double { player.set("volume", String(Int((v * 100).rounded()))) }
            case "mute": player.set("mute", (value as? Bool) == true ? "yes" : "no")
            case "audio": if let n = value as? Int { player.set("aid", String(n)) }
            case "subtitle": player.set("sid", (value as? Int).map(String.init) ?? "no")
            case "controls": player.set("sub-margin-y", (value as? Bool) == true ? "150" : "60") // above Netfish's controls
            case "stop": player.stop()
            default: break
            }
            return nil
        case "debugHitTest" where Bundle.main.bundleIdentifier?.hasSuffix(".selftest") == true:
            // Self-tests: which view would get a click at (x, y-from-top) in the window.
            guard let point = args as? [Double], point.count == 2, let frame = window.window?.contentView?.superview else { return nil }
            let hit = frame.hitTest(NSPoint(x: point[0], y: frame.bounds.height - point[1]))
            return hit.map { String(describing: type(of: $0)) } ?? "nothing"
        default:
            throw Problem(L("Unknown request"))
        }
    }

    /// What mpv plays as-is: everything. Jellyfin then always sends the original file.
    static let profile: [String: Any] = {
        let subtitles = ["srt", "subrip", "ass", "ssa", "vtt", "webvtt", "sub", "smi", "microdvd", "mov_text", "ttml", "pgs", "pgssub", "dvdsub", "dvbsub", "vobsub"]
        return [
            "Name": "Netfish for Mac (mpv)",
            "MaxStreamingBitrate": 400_000_000,
            "MaxStaticBitrate": 400_000_000,
            "MusicStreamingTranscodingBitrate": 384_000,
            "DirectPlayProfiles": [["Type": "Video"], ["Type": "Audio"]],
            "TranscodingProfiles": [[
                "Container": "ts", "Type": "Video", "Protocol": "hls", "Context": "Streaming",
                "VideoCodec": "h264,hevc,av1", "AudioCodec": "aac,ac3,eac3,mp3,opus,flac", "MaxAudioChannels": "8",
                "MinSegments": 1, "BreakOnNonKeyFrames": true,
            ]],
            "ContainerProfiles": [],
            "CodecProfiles": [],
            "SubtitleProfiles": subtitles.map { ["Format": $0, "Method": "Embed"] }
                + ["srt", "subrip", "ass", "ssa", "vtt", "webvtt"].map { ["Format": $0, "Method": "External"] },
        ]
    }()
}
