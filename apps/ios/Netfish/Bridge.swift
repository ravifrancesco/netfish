import Foundation
@preconcurrency import WebKit

/// window.netfishDesktop for the iPhone/iPad app: the same calls the desktop
/// app offers (downloads, the downloads page, changing server), so the web
/// interface needs no iOS-specific code beyond knowing it's on iOS.
enum Bridge {
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

    /// Installed from a Mac (or AltStore, SideStore): when the app stops opening, from the
    /// provisioning profile inside it (every 7 days with a free Apple ID). Nil from the App Store.
    static let installExpires: Date? = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data[start.lowerBound..<end.upperBound], format: nil) as? [String: Any]
        else { return nil }
        return plist["ExpirationDate"] as? Date
    }()

    static let script = """
    (() => {
      if (window.netfishDesktop) return;
      const call = (cmd, args) => window.webkit.messageHandlers.netfish.postMessage({ cmd, args: args === undefined ? null : args });
      const listeners = new Set();
      window.__netfishOfflineChanged = (list) => listeners.forEach((cb) => { try { cb(list); } catch (e) {} });
      const video = new Set();
      window.__netfishVideo = (state) => video.forEach((cb) => { try { cb(state); } catch (e) {} });
      window.netfishDesktop = {
        platform: 'ios',
        version: '\(version)',
        download: (d) => call('download', d),
        offlineList: () => call('list'),
        onOfflineChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        removeOffline: (id) => call('remove', id),
        removeOfflineSeries: (key) => call('removeSeries', key),
        retryOffline: (id) => call('retry', id),
        offlineUsage: () => call('usage'),
        clearOffline: () => call('clear'),
        openOffline: (target) => { call('openOffline', target || {}); },
        openServer: () => { call('openServer'); },
        savePosition: (id, seconds, finished) => { call('savePosition', { id, seconds, finished }); },
        takePositions: () => call('takePositions'),
        saveSnapshot: (json) => { call('saveSnapshot', json); },
        snapshot: () => call('snapshot'),
        serverReachable: () => call('serverReachable'),
        installExpires: () => call('installExpires'),
        changeServer: () => { call('changeServer'); },
        connect: (input) => call('connect', input),
        currentServer: () => call('currentServer'),
        // Apple's player draws the film underneath the page; the page's player drives it.
        videoOverlay: {
          name: 'Apple player',
          drawsSubtitles: false,
          switchesTracks: false,
          profile: () => call('videoProfile'),
          load: (request) => call('videoLoad', request),
          command: (name, value) => { call('videoCommand', { name, value: value === undefined ? null : value }); },
          onState: (cb) => { video.add(cb); return () => video.delete(cb); },
        },
      };
    })();
    """
}

/// Answers the page's calls. Only the Netfish server's pages and the app's own
/// pages may use it, and only the setup page may change the server.
final class BridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: WebViewController?
    private let store = OfflineStore.shared

    init(controller: WebViewController) {
        self.controller = controller
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return replyHandler(nil, L("Bad request")) }
        let args = body["args"]
        let origin = message.frameInfo.securityOrigin
        let local = origin.protocol == LocalScheme.scheme
        let server = Server.url
        let fromServer = server.map { origin.protocol == $0.scheme && origin.host == $0.host && origin.port == ($0.port ?? 0) } ?? false
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
        switch cmd {
        case "list": return store.publicList()
        case "download": return try await store.start(args as? [String: Any] ?? [:])
        case "remove": return await store.remove(args as? String ?? "")
        case "removeSeries": return await store.removeSeries(args as? String ?? "")
        case "retry": return try await store.retry(args as? String ?? "")
        case "usage": return store.usage()
        case "clear": return await store.clear()
        case "openOffline":
            controller?.showOffline(args as? [String: Any] ?? [:])
            return nil
        case "savePosition":
            let p = args as? [String: Any] ?? [:]
            store.savePosition(p["id"] as? String ?? "", seconds: (p["seconds"] as? NSNumber)?.doubleValue ?? 0, finished: p["finished"] as? Bool ?? false)
            return nil
        case "takePositions": return store.takePositions()
        case "saveSnapshot":
            store.saveSnapshot(args as? String ?? "")
            return nil
        case "snapshot": return store.snapshot() ?? NSNull()
        case "serverReachable":
            guard let server = Server.url else { return false }
            return await Server.reachable(server)
        case "installExpires":
            return Bridge.installExpires.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
        case "openServer":
            controller?.showServer()
            return nil
        case "changeServer":
            controller?.showSetup(error: nil)
            return nil
        case "currentServer":
            return Server.url?.absoluteString ?? NSNull()
        case "videoProfile":
            return AppleVideo.profile
        case "videoLoad":
            try await controller?.playVideo(args as? [String: Any] ?? [:])
            return nil
        case "videoCommand":
            let command = args as? [String: Any] ?? [:]
            controller?.video.command(command["name"] as? String ?? "", command["value"])
            return nil
        case "connect":
            guard local else { throw Problem(L("Not allowed here")) }
            let url = try Server.normalize(args as? String ?? "")
            try await Server.probe(url)
            Server.url = url
            controller?.showServer(fresh: true)
            return url.absoluteString
        default:
            throw Problem(L("Unknown request"))
        }
    }
}
