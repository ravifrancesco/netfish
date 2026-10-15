import Foundation
@preconcurrency import WebKit

/// Downloads for watching without a connection, like Netflix downloads: kept in
/// the app's private storage (not backed up, not visible in Files), managed
/// only from the app. Big files download in the background, so they keep going
/// when the app is closed. Works like the desktop app's offline.js, and the
/// pages see exactly the same list.
final class OfflineStore: NSObject, URLSessionDownloadDelegate {
    static let shared = OfflineStore()
    static let sessionId = "app.netfish.downloads"

    struct Subtitle: Codable {
        var label: String
        var code: String?
        var file: String // relative to the root folder
    }

    struct Entry: Codable {
        var itemId: String
        var kind: String
        var title: String
        var seriesId: String?
        var seriesTitle: String?
        var seasonNumber: Int?
        var episodeNumber: Int?
        var subtitle: String?
        var fileName: String
        var folder: String // relative to the root folder: the app's container moves between updates
        var size: Int64
        var received: Int64
        var converted: Bool
        var durationSeconds: Double?
        var detailHref: String?
        var server: String
        var state: String // downloading, done, failed, interrupted
        var error: String?
        var addedAt: String
        var posterFile: String?
        var posterType: String?
        var subtitles: [Subtitle]
        /// What the server described, kept so an interrupted download can be retried.
        var source: String
    }

    /// Called with the public list whenever something changes (progress is throttled).
    var onChange: (([[String: Any]]) -> Void)?
    /// iOS hands this over when it wakes the app for finished background downloads.
    var backgroundCompletion: (() -> Void)?

    private(set) var entries: [Entry] = []
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.allowsCellularAccess = true
        // We send the Netfish session cookie ourselves (it lives in the web view, not here).
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    private let root: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        #if os(macOS)
        // Not sandboxed on the Mac: a folder of our own, never the old desktop app's "Netfish" folder.
        return base.appendingPathComponent("\(Bundle.main.bundleIdentifier ?? "app.netfish.mac")/Offline", isDirectory: true)
        #else
        return base.appendingPathComponent("Netfish/Offline", isDirectory: true)
        #endif
    }()
    private var manifest: URL { root.deletingLastPathComponent().appendingPathComponent("offline.json") }
    /// Where people got to in downloads, until Netfish is online to tell the server.
    private var positionsFile: URL { root.deletingLastPathComponent().appendingPathComponent("offline-positions.json") }
    /// Home as it last looked, for offline mode (shown greyed out).
    private var snapshotFile: URL { root.deletingLastPathComponent().appendingPathComponent("home-snapshot.json") }

    // ---------- Positions and the Home snapshot (offline mode) ----------

    func savePosition(_ itemId: String, seconds: Double, finished: Bool) {
        guard !itemId.isEmpty else { return }
        var list = readPositions().filter { ($0["itemId"] as? String) != itemId }
        list.append(["itemId": itemId, "seconds": max(0, seconds), "finished": finished, "at": ISO8601DateFormatter().string(from: Date())])
        writeJSON(Array(list.suffix(300)), to: positionsFile)
    }

    /// The positions not yet sent, handed over (and forgotten here).
    func takePositions() -> [[String: Any]] {
        let list = readPositions()
        try? FileManager.default.removeItem(at: positionsFile)
        return list
    }

    func saveSnapshot(_ json: String) {
        guard json.utf8.count < 512_000 else { return }
        try? FileManager.default.createDirectory(at: snapshotFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(json.utf8).write(to: snapshotFile, options: .atomic)
    }

    func snapshot() -> String? { try? String(contentsOf: snapshotFile, encoding: .utf8) }

    private func readPositions() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: positionsFile) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    private func writeJSON(_ value: Any, to file: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    override private init() {
        super.init()
        load()
        // Reattach to downloads that kept going while the app was closed.
        session.getAllTasks { tasks in
            DispatchQueue.main.async {
                let running = Set(tasks.compactMap(\.taskDescription))
                for i in self.entries.indices where self.entries[i].state == "downloading" && !running.contains(self.entries[i].itemId) {
                    self.entries[i].state = "interrupted"
                }
                self.save()
                self.broadcast(now: true)
            }
        }
    }

    // ---------- Manifest ----------

    private func load() {
        entries = (try? JSONDecoder().decode([Entry].self, from: Data(contentsOf: manifest))) ?? []
        entries = entries.filter { $0.state != "done" || FileManager.default.fileExists(atPath: videoFile($0).path) }
    }

    private func save() {
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var folder = root
        try? folder.setResourceValues(values)
        try? JSONEncoder().encode(entries).write(to: manifest, options: .atomic)
    }

    func entry(_ itemId: String) -> Entry? { entries.first { $0.itemId == itemId } }
    func videoFile(_ e: Entry) -> URL { root.appendingPathComponent(e.folder).appendingPathComponent(e.fileName) }
    func posterFile(_ e: Entry) -> URL? { e.posterFile.map { root.appendingPathComponent($0) } }
    func subtitleFile(_ e: Entry, _ n: Int) -> URL? { e.subtitles.indices.contains(n) ? root.appendingPathComponent(e.subtitles[n].file) : nil }
    var hasDownloads: Bool { entries.contains { $0.state == "done" } }

    /// What the pages see (no file paths): same shape as the desktop app's list.
    func publicList() -> [[String: Any]] {
        entries.map { e in
            var item: [String: Any] = [
                "itemId": e.itemId, "kind": e.kind, "title": e.title, "fileName": e.fileName,
                "size": e.size, "received": e.received, "converted": e.converted, "server": e.server,
                "state": e.state, "addedAt": e.addedAt,
                "video": "\(LocalScheme.scheme)://app/media/\(e.itemId)/video",
                "subtitles": e.subtitles.enumerated().map { n, s in
                    ["label": s.label, "code": s.code ?? "", "url": "\(LocalScheme.scheme)://app/media/\(e.itemId)/sub/\(n)"]
                },
            ]
            if e.posterFile != nil { item["poster"] = "\(LocalScheme.scheme)://app/media/\(e.itemId)/poster" }
            for (key, value) in [("seriesId", e.seriesId), ("seriesTitle", e.seriesTitle), ("subtitle", e.subtitle), ("detailHref", e.detailHref), ("error", e.error)] {
                if let value { item[key] = value }
            }
            if let n = e.seasonNumber { item["seasonNumber"] = n }
            if let n = e.episodeNumber { item["episodeNumber"] = n }
            if let d = e.durationSeconds { item["durationSeconds"] = d }
            return item
        }
    }

    private var pending: DispatchWorkItem?
    /// At most one update every 0.4 s while bytes come in. (Not "0.4 s after the last
    /// change": a fast download never pauses that long, so the page would hear nothing.)
    private func broadcast(now: Bool = false) {
        if pending != nil && !now { return }
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.pending = nil
            self.onChange?(self.publicList())
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (now ? 0 : 0.4), execute: work)
    }

    // ---------- Downloading ----------

    private static func safe(_ s: String?) -> String {
        let cleaned = (s ?? "Netfish").replacingOccurrences(of: #"[\\/:*?"<>|]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return String((cleaned.isEmpty ? "Netfish" : cleaned).prefix(100))
    }

    /// The signed-in session cookie from the web view, for requests made outside it.
    @MainActor
    private func cookieHeader(for origin: URL) async -> String {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies
            .filter { cookie in
                guard let host = origin.host else { return false }
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return host == domain || host.hasSuffix("." + domain)
            }
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }

    private func fetch(_ url: URL, cookie: String, to file: URL) async throws -> String {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpShouldHandleCookies = false
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw Problem(L("HTTP error")) }
        try data.write(to: file, options: .atomic)
        return http.value(forHTTPHeaderField: "Content-Type") ?? ""
    }

    /// Start (or restart) downloading one movie/episode as described by the server.
    @MainActor
    func start(_ d: [String: Any]) async throws -> [[String: Any]] {
        guard let itemId = d["itemId"] as? String, let fileName = d["fileName"] as? String, let path = d["url"] as? String else {
            throw Problem(d["error"] as? String ?? L("The server didn't say what to download"))
        }
        guard let origin = Server.url else { throw Problem(L("Not connected to a Netfish server")) }
        if let existing = entry(itemId), existing.state == "done" || existing.state == "downloading" { return publicList() }

        let kind = d["kind"] as? String ?? "Movie"
        let title = d["title"] as? String ?? "Netfish"
        let folder = Self.safe(kind == "Episode" ? (d["seriesTitle"] as? String) : title)
        let dir = root.appendingPathComponent(folder, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let source = (try? JSONSerialization.data(withJSONObject: d)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        var entry = Entry(
            itemId: itemId, kind: kind, title: title,
            seriesId: d["seriesId"] as? String, seriesTitle: d["seriesTitle"] as? String,
            seasonNumber: d["seasonNumber"] as? Int, episodeNumber: d["episodeNumber"] as? Int,
            subtitle: d["subtitle"] as? String, fileName: fileName, folder: folder,
            size: (d["size"] as? NSNumber)?.int64Value ?? 0, received: 0, converted: d["converted"] as? Bool ?? false,
            durationSeconds: (d["durationSeconds"] as? NSNumber)?.doubleValue, detailHref: d["detailHref"] as? String,
            server: origin.absoluteString, state: "downloading", error: nil,
            addedAt: ISO8601DateFormatter().string(from: Date()), posterFile: nil, posterType: nil, subtitles: [], source: source
        )
        entries = [entry] + entries.filter { $0.itemId != itemId }
        save()
        broadcast(now: true)

        // Small things first (artwork, subtitles), then the film itself in the background.
        let cookie = await cookieHeader(for: origin)
        if let poster = d["poster"] as? String, let url = URL(string: origin.absoluteString + poster) {
            let file = dir.appendingPathComponent(".\(itemId).poster")
            if let type = try? await fetch(url, cookie: cookie, to: file) {
                entry.posterFile = "\(folder)/.\(itemId).poster"
                entry.posterType = type
            }
        }
        let base = (fileName as NSString).deletingPathExtension
        let subs = d["subtitles"] as? [[String: Any]] ?? []
        for (n, sub) in subs.enumerated() {
            guard let subPath = sub["url"] as? String, let url = URL(string: origin.absoluteString + subPath) else { continue }
            let code = sub["code"] as? String
            let name = "\(base).\(code ?? "track\(n)").\(n).vtt"
            if (try? await fetch(url, cookie: cookie, to: dir.appendingPathComponent(name))) != nil {
                entry.subtitles.append(Subtitle(label: sub["label"] as? String ?? L("Subtitles"), code: code, file: "\(folder)/\(name)"))
            }
        }
        guard let url = URL(string: origin.absoluteString + path) else { throw Problem(L("Bad download address")) }
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        let task = session.downloadTask(with: request)
        task.taskDescription = itemId
        if entry.size > 0 { task.countOfBytesClientExpectsToReceive = entry.size }
        task.resume()

        if let i = entries.firstIndex(where: { $0.itemId == itemId }) {
            entry.received = entries[i].received
            entries[i] = entry
        }
        save()
        broadcast(now: true)
        return publicList()
    }

    @MainActor
    func retry(_ itemId: String) async throws -> [[String: Any]] {
        guard let e = entry(itemId), let data = e.source.data(using: .utf8),
              let d = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Problem(L("Nothing to retry")) }
        if let i = entries.firstIndex(where: { $0.itemId == itemId }) { entries[i].state = "failed" }
        return try await start(d)
    }

    // ---------- Deleting ----------

    private func cancelTask(_ itemId: String?) async {
        let tasks = await session.allTasks
        for task in tasks where itemId == nil || task.taskDescription == itemId { task.cancel() }
    }

    @MainActor
    func remove(_ itemId: String) async -> [[String: Any]] {
        await cancelTask(itemId)
        if let e = entry(itemId) {
            for file in [videoFile(e)] + [posterFile(e)].compactMap({ $0 }) + e.subtitles.indices.compactMap({ subtitleFile(e, $0) }) {
                try? FileManager.default.removeItem(at: file)
            }
            // Tidy the title's folder if it's now empty.
            let dir = root.appendingPathComponent(e.folder)
            if (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?.isEmpty == true { try? FileManager.default.removeItem(at: dir) }
        }
        entries.removeAll { $0.itemId == itemId }
        save()
        broadcast(now: true)
        return publicList()
    }

    /// Delete every downloaded episode of one show (key: seriesId, else seriesTitle).
    @MainActor
    func removeSeries(_ key: String) async -> [[String: Any]] {
        for e in entries where e.kind == "Episode" && (e.seriesId ?? e.seriesTitle) == key { _ = await remove(e.itemId) }
        return publicList()
    }

    @MainActor
    func clear() async -> [[String: Any]] {
        await cancelTask(nil)
        try? FileManager.default.removeItem(at: root)
        entries = []
        save()
        broadcast(now: true)
        return publicList()
    }

    /// Space used by downloads, in bytes.
    func usage() -> Int64 {
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let file as URL in files { total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        return total
    }

    // ---------- URLSession (runs on the main queue) ----------

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription, let i = entries.firstIndex(where: { $0.itemId == id }) else { return }
        entries[i].received = totalBytesWritten
        if totalBytesExpectedToWrite > 0 { entries[i].size = totalBytesExpectedToWrite }
        entries[i].state = "downloading"
        broadcast()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription, let i = entries.firstIndex(where: { $0.itemId == id }) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            entries[i].state = "failed"
            entries[i].error = status == 401 ? L("Sign in to Netfish again, then retry.") : L("The server said no ({status}).", ["status": String(status)])
            return
        }
        // The temporary file disappears when this returns: move it now.
        let destination = videoFile(entries[i])
        try? FileManager.default.removeItem(at: destination)
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: location, to: destination)
            let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
            entries[i].state = "done"
            entries[i].size = size
            entries[i].received = size
            entries[i].error = nil
        } catch {
            entries[i].state = "failed"
            entries[i].error = L("Couldn't save the file: {error}", ["error": error.localizedDescription])
        }
        save()
        broadcast(now: true)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let id = task.taskDescription, let i = entries.firstIndex(where: { $0.itemId == id }) else { return }
        if (error as NSError).code == NSURLErrorCancelled, entries[i].state != "downloading" { return }
        if entries[i].state == "done" { return }
        entries[i].state = (error as NSError).code == NSURLErrorCancelled ? "interrupted" : "failed"
        entries[i].error = L("The download stopped. Try again when you're on your home network.")
        save()
        broadcast(now: true)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }
}
