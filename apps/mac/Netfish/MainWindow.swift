import AppKit
@preconcurrency import WebKit

/// The Netfish window: mpv's picture at the bottom, the Netfish interface (a
/// transparent web view) on top, like Jellyfin Media Player. Everything you
/// see and click is the Netfish web app from your server; mpv only draws the
/// film underneath it.
final class MainWindow: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    let player = MpvPlayer()
    private(set) var web: DraggableWebView!
    private let store = OfflineStore.shared
    private var returnURL: URL?
    private static let background = NSColor(red: 6 / 255, green: 8 / 255, blue: 11 / 255, alpha: 1)

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Netfish"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = Self.background
        window.minSize = NSSize(width: 720, height: 480)
        window.collectionBehavior = [.fullScreenPrimary]
        window.center()
        window.setFrameAutosaveName("Netfish")
        super.init(window: window)
        window.delegate = self
        buildContent()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func buildContent() {
        let config = WKWebViewConfiguration()
        // The interface checks for "NetfishDesktop" to leave room for the window buttons.
        config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15 NetfishDesktop/\(MacBridge.version)"
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        config.setURLSchemeHandler(LocalScheme(store: store), forURLScheme: LocalScheme.scheme)
        let scripts = config.userContentController
        scripts.addUserScript(WKUserScript(source: MacBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        scripts.addScriptMessageHandler(MacBridge(window: self), contentWorld: .page, name: "netfish")

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = Self.background.cgColor
        let video = MpvView(player: player)
        web = DraggableWebView(frame: .zero, configuration: config)
        web.autoresizingMask = [.width, .height]
        // See-through where the page is transparent (during playback), so mpv's picture shows.
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        if #available(macOS 13.3, *) { web.isInspectable = true }
        root.addSubview(video)
        root.addSubview(web)
        window?.contentView = root
        video.frame = root.bounds
        web.frame = root.bounds

        store.onChange = { [weak self] list in self?.push("__netfishOfflineChanged", list) }
        player.onState = { [weak self] state in self?.pushState(state) }
        player.onEnd = { [weak self] finished, error in
            var state: [String: Any] = ["ended": true, "finished": finished]
            if let error { state["error"] = error }
            self?.push("__netfishVideo", state)
        }

        if let server = Server.url { open(server) } else { showSetup(error: nil) }
    }

    override func showWindow(_ sender: Any?) {
        super.showWindow(sender)
        layoutTrafficLights()
    }

    // ---------- Pages ----------

    func showSetup(error: String?) {
        player.stop()
        web.load(URLRequest(url: LocalScheme.url("setup.html", query: error.map { ["error": $0] } ?? [:])))
    }

    func showOffline(_ target: [String: Any]) {
        player.stop()
        if Server.owns(web.url) { returnURL = web.url }
        var query: [String: String] = [:]
        if let play = target["play"] as? String { query["play"] = play }
        if let show = target["show"] as? String { query["show"] = show }
        web.load(URLRequest(url: LocalScheme.url("offline.html", query: query)))
    }

    func showServer(fresh: Bool = false) {
        guard let server = Server.url else { return showSetup(error: nil) }
        let target = !fresh && Server.owns(returnURL) ? returnURL! : server
        returnURL = nil
        open(target)
    }

    func goHome() {
        if let server = Server.url { open(server) }
    }

    func reload() {
        web.reload()
    }

    private func open(_ url: URL) {
        web.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10))
    }

    // ---------- Talking to the page ----------

    func push(_ function: String, _ value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.\(function) && window.\(function)(\(json))")
    }

    private var lastTimePush = Date.distantPast
    private func pushState(_ state: [String: Any]) {
        // The time changes every frame; four updates a second is plenty for the seek bar.
        if state.keys.contains("time-pos"), state.count == 1 {
            guard Date().timeIntervalSince(lastTimePush) > 0.25 else { return }
            lastTimePush = Date()
        }
        push("__netfishVideo", state)
    }

    /// The signed-in session cookie from the web view, for mpv's requests.
    func cookieHeader(for url: URL) async -> String {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies
            .filter { cookie in
                guard let host = url.host else { return false }
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return host == domain || host.hasSuffix("." + domain)
            }
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }

    // ---------- Window ----------

    /// The window buttons sit inset (like the desktop app always had) so the interface's layout fits around them.
    func layoutTrafficLights() {
        guard let window, let close = window.standardWindowButton(.closeButton),
              let mini = window.standardWindowButton(.miniaturizeButton),
              let zoom = window.standardWindowButton(.zoomButton),
              let container = close.superview?.superview else { return }
        if window.styleMask.contains(.fullScreen) { return }
        let inset = NSPoint(x: 20, y: 18)
        var frame = container.frame
        frame.size.height = close.frame.height + inset.y * 2
        frame.origin.y = window.frame.height - frame.height
        container.frame = frame
        for (n, button) in [close, mini, zoom].enumerated() {
            button.setFrameOrigin(NSPoint(x: inset.x + CGFloat(n) * 20, y: (frame.height - button.frame.height) / 2))
        }
    }

    func windowDidResize(_ notification: Notification) { layoutTrafficLights() }
    func windowDidEnterFullScreen(_ notification: Notification) { push("__netfishVideo", ["fullscreen": true]) }
    func windowDidExitFullScreen(_ notification: Notification) {
        layoutTrafficLights()
        push("__netfishVideo", ["fullscreen": false])
    }

    // ---------- Navigation ----------

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if url.scheme == LocalScheme.scheme || url.scheme == "about" || Server.owns(url) { return decisionHandler(.allow) }
        // Anything else (IMDb, Letterboxd…) opens in the browser.
        if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // NETFISH_SELFTEST=<folder>: runs step1.js, step2.js… in the page, one per finished page load,
    // prints what the last one returns, then quits. For automated checks only.
    private var selfTestStep = 0
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Only the separate self-test build (its own sign-in, settings and downloads) runs tests.
        guard let folder = ProcessInfo.processInfo.environment["NETFISH_SELFTEST"],
              Bundle.main.bundleIdentifier?.hasSuffix(".selftest") == true else { return }
        selfTestStep += 1
        let file = URL(fileURLWithPath: folder).appendingPathComponent("step\(selfTestStep).js")
        guard let code = try? String(contentsOf: file, encoding: .utf8) else { return }
        webView.callAsyncJavaScript(code, arguments: [:], in: nil, in: .page) { result in
            let next = URL(fileURLWithPath: folder).appendingPathComponent("step\(self.selfTestStep + 1).js")
            if FileManager.default.fileExists(atPath: next.path) { return }
            switch result {
            case .success(let value): print("selftest:", value ?? "nil")
            case .failure(let error): print("selftest failed:", error)
            }
            fflush(stdout)
            NSApp.terminate(nil)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // Leaving a page always stops a film playing underneath it.
        player.stop()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let err = error as NSError
        guard err.code != NSURLErrorCancelled, err.code != 102 else { return }
        if (err.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.scheme == LocalScheme.scheme { return }
        // Away from home with films downloaded: straight to them.
        if store.hasDownloads { return showOffline([:]) }
        showSetup(error: L("Couldn't reach {server} ({error}). Is it on?", [
            "server": Server.url?.absoluteString ?? L("the server"), "error": err.localizedDescription,
        ]))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // confirm() / alert() from the pages.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: L("OK"))
        alert.addButton(withTitle: L("Cancel"))
        alert.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn) }
    }
}

/// Remembers the last click so the page can turn it into a window drag (its header is the title bar).
final class DraggableWebView: WKWebView {
    private(set) var lastMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }

    func dragWindow() {
        guard let event = lastMouseDown, let window, NSEvent.pressedMouseButtons & 1 != 0 else { return }
        window.performDrag(with: event)
    }
}
