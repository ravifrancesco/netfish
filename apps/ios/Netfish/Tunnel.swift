import Foundation
import Network
@preconcurrency import WebKit

/// Away from home: WireGuard inside the app (netfish-tunnel, apps/common/tunnel, built in as a
/// library), used only by Netfish and only when the server doesn't answer directly. No VPN: the
/// page and downloads reach the server through its proxy on 127.0.0.1, Apple's player through its
/// forwarding address; nothing else on the phone goes through it. Needs iOS 17 (the page's proxy).
/// The configuration (its private key) stays in a file only the app can read: never shown again,
/// never logged.
@MainActor
final class Tunnel {
    static let shared = Tunnel()

    /// iOS 17 or later: the page can go through a proxy only from then on.
    nonisolated static var available: Bool {
        if #available(iOS 17, *) { return true }
        return false
    }

    private(set) var port: Int?
    private(set) var problem: String?
    var active: Bool { port != nil }
    /// Told when it goes on or off (downloads follow).
    var onChange: (() -> Void)?
    private let network = NWPathMonitor()

    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("tunnel.conf")
    }

    var configured: Bool { Self.available && FileManager.default.fileExists(atPath: file.path) }

    var status: [String: Any] {
        var s: [String: Any] = ["configured": configured, "active": active]
        if let problem { s["problem"] = problem }
        return s
    }

    /// How the server answers: directly (at home), through the tunnel (away), or not at all.
    enum Route { case home, away, none }

    /// Home or away as the network changes (Wi-Fi to mobile data): the tunnel on or off, no reload.
    func watchNetwork() {
        network.pathUpdateHandler = { _ in
            Task { @MainActor in
                guard let server = Server.url, Tunnel.shared.configured else { return }
                _ = await Tunnel.shared.route(server)
            }
        }
        network.start(queue: .global(qos: .utility))
    }

    /// A configuration, checked and kept: nil, or what's wrong with it.
    func save(_ config: String) async -> String? {
        let text = config.trimmingCharacters(in: .whitespacesAndNewlines)
        if let wrong = text.withCString({ NetfishTunnelCheck(UnsafeMutablePointer(mutating: $0)) }) {
            defer { NetfishTunnelFree(wrong) }
            return String(cString: wrong)
        }
        stop()
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            return error.localizedDescription
        }
        if let server = Server.url { _ = await route(server) }
        return nil
    }

    func remove() {
        stop()
        try? FileManager.default.removeItem(at: file)
        apply()
    }

    /// Up (or already up): true once its proxy listens.
    private func start() async -> Bool {
        if active { return true }
        guard let config = try? String(contentsOf: file, encoding: .utf8) else { return false }
        // Finding the endpoint's address can take a moment: off the main thread.
        let (port, said) = await Task.detached { () -> (Int, String?) in
            var wrong: UnsafeMutablePointer<CChar>?
            let port = config.withCString { NetfishTunnelStart(UnsafeMutablePointer(mutating: $0), &wrong) }
            defer { if let wrong { NetfishTunnelFree(wrong) } }
            return (Int(port), wrong.map { String(cString: $0) })
        }.value
        guard port > 0 else {
            problem = said ?? "the tunnel didn't start"
            return false
        }
        self.port = port
        problem = nil
        return true
    }

    func stop() {
        guard port != nil else { return }
        NetfishTunnelStop()
        port = nil
    }

    /// The page (and downloads) through the tunnel while it's on.
    private func apply() {
        if #available(iOS 17, *) {
            if let port, let endpoint = NWEndpoint.Port(rawValue: UInt16(port)) {
                WKWebsiteDataStore.default().proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: endpoint))]
            } else {
                WKWebsiteDataStore.default().proxyConfigurations = []
            }
        }
        onChange?()
    }

    /// The address Apple's player uses for a server address while the tunnel's on (it can't use a
    /// proxy): the tunnel forwards it. The same address otherwise.
    func playable(_ url: URL) -> URL {
        guard let port, let host = url.host, url.scheme == "http" else { return url }
        let target = url.port.map { "\(host):\($0)" } ?? host
        guard var through = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        let path = through.percentEncodedPath.isEmpty ? "/" : through.percentEncodedPath
        through.host = "127.0.0.1"
        through.port = port
        through.percentEncodedPath = "/through/\(target)" + path
        return through.url ?? url
    }

    /// The answer being worked out: asked again meanwhile (the network watcher reports as soon as it
    /// starts, as Netfish opens), the same answer, not a second tunnel stopping the first.
    private var routing: Task<Route, Never>?

    /// How the server answers: directly (at home), else, away, through the tunnel when there is one,
    /// started here (`connecting` first). A tunnel that isn't needed (or doesn't get through) stops.
    func route(_ server: URL, connecting: @escaping () -> Void = {}) async -> Route {
        if let routing { return await routing.value }
        let task = Task { await decide(server, connecting: connecting) }
        routing = task
        let answer = await task.value
        routing = nil
        return answer
    }

    private func decide(_ server: URL, connecting: () -> Void) async -> Route {
        if await Server.reachable(server) {
            if active {
                stop()
                apply()
            }
            return .home
        }
        guard configured else { return .none }
        connecting()
        guard await start() else {
            apply()
            return .none
        }
        if await reachableThroughTunnel(server) {
            apply()
            return .away
        }
        stop()
        apply()
        return .none
    }

    /// Back from the background: iOS may have closed the tunnel's connections while Netfish was
    /// asleep. Started again if it doesn't get through any more.
    func wake() async {
        guard active, let server = Server.url, !(await reachableThroughTunnel(server)) else { return }
        stop()
        _ = await route(server)
    }

    private func reachableThroughTunnel(_ server: URL) async -> Bool {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        guard let (_, response) = try? await session.data(from: playable(server.appendingPathComponent("api/health"))) else { return false }
        return response is HTTPURLResponse
    }
}
