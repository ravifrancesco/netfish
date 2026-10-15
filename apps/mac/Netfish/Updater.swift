import AppKit

/// Updates the Mac app from GitHub Releases. The newest release's Netfish-mac.zip is
/// downloaded, checked (it's Netfish, the right version, signature intact) and swapped in
/// once Netfish has quit; the old copy stays until the new one is in place, then Netfish
/// opens again. Files an app downloads itself aren't quarantined, so macOS doesn't ask
/// about the new version. The self-test build only ever does a dry run.
///
/// With "Update Netfish by itself" on, AutoUpdate gets the new version ready in the
/// background and swaps it in when Netfish quits, so nothing is ever interrupted.
enum Updater {
    static let repository = "ravifrancesco/netfish"
    static let current = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

    struct Release {
        let version: String
        /// Absent when that release has no Mac zip: then it's only a link to the page.
        let download: URL?
        let page: URL?
    }

    private static var selfTest: Bool { Bundle.main.bundleIdentifier?.hasSuffix(".selftest") == true }

    private static var feed: URL {
        if selfTest, let override = ProcessInfo.processInfo.environment["NETFISH_UPDATE_FEED"], let url = URL(string: override) { return url }
        return URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!
    }

    /// The newest release when it's newer than this app, nil when this is the newest.
    static func check() async throws -> Release? {
        var request = URLRequest(url: feed, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Netfish/\(current) (Mac)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Problem(L("Couldn't check for updates")) }
        struct Feed: Decodable {
            struct Asset: Decodable {
                let name: String
                let browser_download_url: String
            }
            let tag_name: String
            let html_url: String?
            let assets: [Asset]
        }
        let latest = try JSONDecoder().decode(Feed.self, from: data)
        let version = latest.tag_name.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
        guard newer(version, than: current) else { return nil }
        let zip = latest.assets.first { $0.name == "Netfish-mac.zip" }.flatMap { URL(string: $0.browser_download_url) }
        return Release(version: version, download: zip, page: latest.html_url.flatMap(URL.init(string:)))
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    /// A newer version, downloaded and checked, waiting to be swapped in.
    struct Staged {
        let version: String
        let app: URL
        let work: URL
    }

    /// Downloads and checks a release without touching the installed app.
    static func prepare(_ release: Release, progress: @escaping (Int64, Int64) -> Void) async throws -> Staged {
        guard let download = release.download else { throw Problem(L("This version can only be downloaded from its page.")) }
        let app = Bundle.main.bundleURL
        guard app.pathExtension == "app" else { throw Problem(L("Netfish can't update itself here.")) }
        // Opened straight from the disk image or Downloads: macOS runs it from a hidden, read-only copy.
        if app.path.contains("/AppTranslocation/") {
            throw Problem(L("Move Netfish to your Applications folder, open it from there, then update."))
        }
        guard FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path) else {
            throw Problem(L("Netfish can't replace itself in that folder. Download the new version from its page instead."))
        }

        let work = FileManager.default.temporaryDirectory.appendingPathComponent("netfish-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        do {
            let zip = work.appendingPathComponent("Netfish-mac.zip")
            try await Downloader.fetch(download, to: zip, progress: progress)
            try await run("/usr/bin/ditto", ["-x", "-k", zip.path, work.path])
            try? FileManager.default.removeItem(at: zip)
            let fresh = work.appendingPathComponent("Netfish.app")
            guard let info = Bundle(url: fresh)?.infoDictionary,
                  info["CFBundleIdentifier"] as? String == "app.netfish.mac",
                  info["CFBundleShortVersionString"] as? String == release.version else {
                throw Problem(L("The download doesn't look like Netfish {version}.", ["version": release.version]))
            }
            try await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", fresh.path])
            return Staged(version: release.version, app: fresh, work: work)
        } catch {
            try? FileManager.default.removeItem(at: work)
            throw error
        }
    }

    /// Puts the staged version in place once Netfish has quit, and opens it again if asked.
    static func apply(_ staged: Staged, reopen: Bool) throws {
        let app = Bundle.main.bundleURL
        if selfTest {
            print("update dry run: \(staged.app.path) is ready to replace \(app.path)\(reopen ? "" : " after quitting")")
            fflush(stdout)
            return
        }
        // A running app can't be replaced safely: a small script waits for Netfish to quit,
        // swaps the copies (putting the old one back if anything fails), and opens it again.
        let script = """
        while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
        old="$2.old-$$"
        mv "$2" "$old" || exit 1
        if /usr/bin/ditto "$3" "$2"; then rm -rf "$old"; else rm -rf "$2"; mv "$old" "$2"; fi
        /usr/bin/xattr -dr com.apple.quarantine "$2" 2>/dev/null
        [ "$5" = 1 ] && /usr/bin/open "$2"
        rm -rf "$4"
        """
        let swap = Process()
        swap.executableURL = URL(fileURLWithPath: "/bin/sh")
        swap.arguments = ["-c", script, "netfish-update", String(ProcessInfo.processInfo.processIdentifier), app.path, staged.app.path, staged.work.path, reopen ? "1" : "0"]
        try swap.run()
    }

    /// Updates now: downloads and checks the release (unless it's already waiting), then
    /// quits so it can be swapped in, and Netfish opens again.
    @MainActor
    static func install(_ release: Release, progress: @escaping (Int64, Int64) -> Void) async throws {
        var staged = AutoUpdate.shared.take(release.version)
        if staged == nil { staged = try await prepare(release, progress: progress) }
        try apply(staged!, reopen: true)
        if !selfTest { NSApp.terminate(nil) }
    }

    private static func run(_ tool: String, _ arguments: [String]) async throws {
        try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: tool)
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw Problem(L("The update couldn't be checked or unpacked.")) }
        }.value
    }
}

/// "Update Netfish by itself": a check soon after opening and every six hours; a newer
/// version is downloaded and checked in the background, and put in place when Netfish
/// quits (it's there the next time Netfish opens).
@MainActor
final class AutoUpdate {
    static let shared = AutoUpdate()
    private let key = "autoUpdate"
    private var timer: Timer?
    private var busy = false
    /// The version waiting for Netfish to quit.
    private(set) var staged: Updater.Staged?
    /// Why the last try didn't work (shown in Settings).
    private(set) var problem: String?

    var on: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set {
            UserDefaults.standard.set(newValue, forKey: key)
            if newValue { start(after: 1) } else { stop() }
        }
    }

    func start(after delay: TimeInterval = 20) {
        guard on, timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in
            Task { @MainActor in await AutoUpdate.shared.run() }
        }
        Task {
            try? await Task.sleep(for: .seconds(delay))
            await run()
        }
    }

    private func stop() {
        timer?.invalidate()
        timer = nil
        problem = nil
        if let staged { try? FileManager.default.removeItem(at: staged.work) }
        staged = nil
    }

    func run() async {
        guard on, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            guard let release = try await Updater.check(), release.download != nil, release.version != staged?.version else { return }
            let fresh = try await Updater.prepare(release) { _, _ in }
            // Turned off while it downloaded: don't keep it.
            guard on else {
                try? FileManager.default.removeItem(at: fresh.work)
                return
            }
            if let old = staged { try? FileManager.default.removeItem(at: old.work) }
            staged = fresh
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Updating now instead: hands over the waiting copy when it's that version (an older
    /// one is thrown away), so quitting doesn't swap anything else in.
    func take(_ version: String) -> Updater.Staged? {
        guard let waiting = staged else { return nil }
        staged = nil
        if waiting.version == version { return waiting }
        try? FileManager.default.removeItem(at: waiting.work)
        return nil
    }

    /// Netfish is quitting: the new version goes in place now, and opens next time.
    func quitting() {
        guard on, let staged else { return }
        self.staged = nil
        try? Updater.apply(staged, reopen: false)
    }
}

/// One file to disk, reporting progress as it goes.
private final class Downloader: NSObject, URLSessionDownloadDelegate {
    private let destination: URL
    private let progress: (Int64, Int64) -> Void
    private var continuation: CheckedContinuation<Void, Error>?

    private init(destination: URL, progress: @escaping (Int64, Int64) -> Void) {
        self.destination = destination
        self.progress = progress
    }

    static func fetch(_ url: URL, to destination: URL, progress: @escaping (Int64, Int64) -> Void) async throws {
        let downloader = Downloader(destination: destination, progress: progress)
        let session = URLSession(configuration: .ephemeral, delegate: downloader, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            downloader.continuation = continuation
            session.downloadTask(with: url).resume()
        }
    }

    private func finish(_ error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        progress(totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard (downloadTask.response as? HTTPURLResponse)?.statusCode == 200 else {
            return finish(Problem(L("Couldn't download the update")))
        }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            finish(nil)
        } catch {
            finish(error)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(error) }
    }
}
