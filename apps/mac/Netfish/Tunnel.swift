import Foundation
import Network
@preconcurrency import WebKit

/// Away from home: WireGuard inside the app (netfish-tunnel, from apps/common/tunnel, next to the
/// app in Contents/MacOS), used only by Netfish and only when the server doesn't answer directly.
/// The page and mpv reach the server through its proxy on 127.0.0.1; nothing else on the Mac goes
/// through it. The configuration (its private key) stays in a file only you can read: never shown
/// again, never logged.
@MainActor
final class Tunnel {
    static let shared = Tunnel()

    private var process: Process?
    /// The running tunnel's input, kept open (closing it ends the tunnel).
    private var input: FileHandle?
    private(set) var port: Int?
    private(set) var problem: String?
    var active: Bool { port != nil }
    /// Told when it goes on or off (the player follows).
    var onChange: (() -> Void)?
    private let network = NWPathMonitor()

    private var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Netfish", isDirectory: true)
            .appendingPathComponent("tunnel.conf")
    }

    var configured: Bool { FileManager.default.fileExists(atPath: file.path) }

    var status: [String: Any] {
        var s: [String: Any] = ["configured": configured, "active": active]
        if let problem { s["problem"] = problem }
        return s
    }

    /// Home or away as the network changes (Wi-Fi to a phone's hotspot): the tunnel on or off, no reload.
    func watchNetwork() {
        network.pathUpdateHandler = { _ in
            Task { @MainActor in
                guard let server = Server.url, Tunnel.shared.configured else { return }
                _ = await Tunnel.shared.route(server)
            }
        }
        network.start(queue: .global(qos: .utility))
    }

    /// Runs the tunnel with a configuration: it and its first line ("PORT n", "OK", "ERROR …"), nil if none came.
    private func launch(_ config: String, check: Bool) async -> (process: Process, input: FileHandle, said: String?)? {
        let p = Process()
        p.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/netfish-tunnel")
        p.arguments = check ? ["-check"] : []
        let stdin = Pipe()
        let stdout = Pipe()
        p.standardInput = stdin
        p.standardOutput = stdout
        p.standardError = stdout
        do {
            try p.run()
        } catch {
            problem = error.localizedDescription
            return nil
        }
        stdin.fileHandleForWriting.write(Data("\(config)\n.\n".utf8))
        let reader = stdout.fileHandleForReading
        let said: String? = await withTaskGroup(of: String?.self) { group in
            group.addTask {
                var line = Data()
                while true {
                    let byte = reader.readData(ofLength: 1)
                    if byte.isEmpty || byte == Data("\n".utf8) { break }
                    line.append(byte)
                }
                return line.isEmpty ? nil : String(decoding: line, as: UTF8.self)
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        return (p, stdin.fileHandleForWriting, said)
    }

    /// A configuration, checked by the tunnel itself and kept: nil, or what's wrong with it.
    func save(_ config: String) async -> String? {
        guard let run = await launch(config, check: true) else { return problem ?? "the tunnel didn't start" }
        run.process.terminate()
        guard let said = run.said else { return "the tunnel didn't answer" }
        guard said == "OK" else { return said.replacingOccurrences(of: "ERROR ", with: "") }
        stop()
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(config.trimmingCharacters(in: .whitespacesAndNewlines).utf8).write(to: file, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
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
        if active, process?.isRunning == true { return true }
        stop()
        guard let config = try? String(contentsOf: file, encoding: .utf8) else { return false }
        guard let run = await launch(config, check: false) else { return false }
        if let said = run.said, said.hasPrefix("PORT "), let port = Int(said.dropFirst(5).trimmingCharacters(in: .whitespaces)) {
            process = run.process
            input = run.input
            self.port = port
            problem = nil
            return true
        }
        problem = run.said.map { $0.replacingOccurrences(of: "ERROR ", with: "") } ?? "the tunnel didn't answer"
        run.process.terminate()
        return false
    }

    func stop() {
        process?.terminate()
        process = nil
        input = nil
        port = nil
    }

    /// The page (and mpv) through the tunnel while it's on.
    private func apply() {
        if let port, let endpoint = NWEndpoint.Port(rawValue: UInt16(port)) {
            WKWebsiteDataStore.default().proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: endpoint))]
        } else {
            WKWebsiteDataStore.default().proxyConfigurations = []
        }
        onChange?()
    }

    /// The proxy for mpv ("http://127.0.0.1:n"), while the tunnel's on.
    var proxyURL: String? { port.map { "http://127.0.0.1:\($0)" } }

    /// Whether the server answers: directly (at home), else, away, through the tunnel when there is
    /// one, started here. A tunnel that isn't needed (or doesn't get through) stops.
    func route(_ server: URL) async -> Bool {
        if await Server.reachable(server) {
            if active {
                stop()
                apply()
            }
            return true
        }
        guard configured, await start() else {
            apply()
            return false
        }
        if await reachableThroughTunnel(server) {
            apply()
            return true
        }
        stop()
        apply()
        return false
    }

    private func reachableThroughTunnel(_ server: URL) async -> Bool {
        guard let port else { return false }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPEnable as String: 1,
            kCFNetworkProxiesHTTPProxy as String: "127.0.0.1",
            kCFNetworkProxiesHTTPPort as String: port,
            "HTTPSEnable": 1,
            "HTTPSProxy": "127.0.0.1",
            "HTTPSPort": port,
        ]
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        guard let (_, response) = try? await session.data(from: server.appendingPathComponent("api/health")) else { return false }
        return response is HTTPURLResponse
    }
}
