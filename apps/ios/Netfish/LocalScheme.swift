import Foundation
@preconcurrency import WebKit

/// The app's private netfish-offline:// address, like the desktop app's: the
/// setup and downloads pages bundled with the app, and downloaded films with
/// their artwork and subtitles. Byte ranges are supported so video can seek.
final class LocalScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "netfish-offline"
    static func url(_ page: String, query: [String: String] = [:]) -> URL {
        var parts = URLComponents(string: "\(scheme)://app/\(page)")!
        if !query.isEmpty { parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return parts.url!
    }

    private let store: OfflineStore
    private let io = DispatchQueue(label: "app.netfish.local-files", qos: .userInitiated, attributes: .concurrent)
    /// Requests the web view gave up on (seeked away, closed the player): stop sending them data.
    private var stopped = Set<ObjectIdentifier>()

    init(store: OfflineStore) {
        self.store = store
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else { return fail(task) }
        let parts = url.pathComponents.filter { $0 != "/" }
        if parts.first != "media" {
            let name = parts.last ?? "offline.html"
            guard name.range(of: #"^[\w.-]+\.(html|js|css|svg)$"#, options: .regularExpression) != nil,
                  let file = Bundle.main.url(forResource: name, withExtension: nil) else { return fail(task) }
            return serve(task, file: file, type: Self.type(of: file))
        }
        guard parts.count >= 3, let entry = store.entry(parts[1]) else { return fail(task) }
        switch parts[2] {
        case "video":
            serve(task, file: store.videoFile(entry), type: Self.type(of: store.videoFile(entry)))
        case "poster":
            guard let file = store.posterFile(entry) else { return fail(task) }
            serve(task, file: file, type: entry.posterType ?? "image/jpeg")
        case "sub":
            guard parts.count >= 4, let n = Int(parts[3]), let file = store.subtitleFile(entry, n) else { return fail(task) }
            serve(task, file: file, type: "text/vtt; charset=utf-8")
        case "trick":
            guard parts.count >= 4, let n = Int(parts[3]), let file = store.trickplayFile(entry, n) else { return fail(task) }
            serve(task, file: file, type: "image/jpeg")
        default:
            fail(task)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func fail(_ task: WKURLSchemeTask) {
        let response = HTTPURLResponse(url: task.request.url ?? URL(string: "\(Self.scheme)://app/")!, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
        task.didReceive(response)
        task.didReceive(Data(L("Not found").utf8))
        task.didFinish()
    }

    /// Answer with the whole file or the asked-for byte range, read in chunks off the main thread.
    private func serve(_ task: WKURLSchemeTask, file: URL, type: String) {
        guard let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value,
              let handle = try? FileHandle(forReadingFrom: file) else { return fail(task) }
        var start: Int64 = 0
        var end: Int64 = size - 1
        var status = 200
        if let range = task.request.value(forHTTPHeaderField: "Range"),
           let match = range.range(of: #"bytes=(\d*)-(\d*)"#, options: .regularExpression) {
            let spec = range[match].dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
            let from = Int64(spec.first ?? "")
            let to = spec.count > 1 ? Int64(spec[1]) : nil
            if let from {
                start = from
                if let to { end = min(to, size - 1) }
            } else if let to {
                start = max(0, size - to) // "bytes=-500": the last 500 bytes
            }
            status = 206
        }
        let url = task.request.url!
        guard start < size || size == 0 else {
            try? handle.close()
            let response = HTTPURLResponse(url: url, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: ["Content-Range": "bytes */\(size)"])!
            task.didReceive(response)
            task.didFinish()
            return
        }
        var headers = ["Content-Type": type, "Content-Length": String(max(0, end - start + 1)), "Accept-Ranges": "bytes"]
        if status == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)

        let id = ObjectIdentifier(task)
        io.async { [weak self] in
            defer { try? handle.close() }
            var offset = start
            try? handle.seek(toOffset: UInt64(start))
            while offset <= end {
                let count = Int(min(512 * 1024, end - offset + 1))
                guard let chunk = try? handle.read(upToCount: count), !chunk.isEmpty else { break }
                offset += Int64(chunk.count)
                // One chunk at a time: the main thread hands it over, so memory stays flat.
                var keepGoing = true
                DispatchQueue.main.sync {
                    if self?.stopped.contains(id) ?? true { keepGoing = false } else { task.didReceive(chunk) }
                }
                if !keepGoing { break }
            }
            DispatchQueue.main.async {
                if self?.stopped.remove(id) == nil { task.didFinish() }
            }
        }
    }

    static func type(of file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "mp4": return "video/mp4"
        case "m4v": return "video/x-m4v"
        case "mov": return "video/quicktime"
        case "mkv": return "video/x-matroska"
        case "vtt": return "text/vtt; charset=utf-8"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "webp": return "image/webp"
        default: return "application/octet-stream"
        }
    }
}
