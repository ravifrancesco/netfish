import UIKit
@preconcurrency import WebKit

/// The whole app: one full-screen web view showing the Netfish server's
/// interface (or the setup / downloads pages bundled with the app).
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var web: WKWebView!
    /// Films play here, underneath the page (which shows Netfish's controls on top).
    let video = AppleVideo()
    private let store = OfflineStore.shared
    /// Where to go back to after the downloads page (e.g. the Movies → Offline tab).
    private var returnURL: URL?
    private static let background = UIColor(red: 6 / 255, green: 8 / 255, blue: 11 / 255, alpha: 1)

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Lets the interface know it's inside the app ("NetfishiOS" in the user agent).
        config.applicationNameForUserAgent = "Mobile/15E148 NetfishiOS/\(Bridge.version)"
        config.preferences.isElementFullscreenEnabled = true
        config.setURLSchemeHandler(LocalScheme(store: store), forURLScheme: LocalScheme.scheme)
        let scripts = config.userContentController
        scripts.addUserScript(WKUserScript(source: Bridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        scripts.addScriptMessageHandler(BridgeHandler(controller: self), contentWorld: .page, name: "netfish")

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        // See-through where the page is transparent (during playback), so the film underneath shows.
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        // The pages leave room for the notch themselves (viewport-fit=cover).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        let root = UIView()
        root.backgroundColor = Self.background
        video.view.frame = root.bounds
        video.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.frame = root.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(video.view)
        root.addSubview(web)
        view = root
        video.onState = { [weak self] state in self?.pushVideo(state) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        store.onChange = { [weak self] list in self?.push(list) }
        if let server = Server.url { open(server) } else { showSetup(error: nil) }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // ---------- Pages ----------

    func showSetup(error: String?) {
        web.load(URLRequest(url: LocalScheme.url("setup.html", query: error.map { ["error": $0] } ?? [:])))
    }

    func showOffline(_ target: [String: Any]) {
        if Server.owns(web.url) { returnURL = web.url }
        var query: [String: String] = [:]
        if let play = target["play"] as? String { query["play"] = play }
        if let show = target["show"] as? String { query["show"] = show }
        web.load(URLRequest(url: LocalScheme.url("offline.html", query: query)))
    }

    /// Back to the server: where you were before the downloads page, or its home page.
    func showServer(fresh: Bool = false) {
        guard let server = Server.url else { return showSetup(error: nil) }
        let target = !fresh && Server.owns(returnURL) ? returnURL! : server
        returnURL = nil
        open(target)
    }

    /// A server page. Away from home the address doesn't answer: give up quickly and show the downloads instead.
    private func open(_ url: URL) {
        web.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 8))
    }

    /// Play a film underneath the page, signed in with the page's session.
    func playVideo(_ request: [String: Any]) async throws {
        guard let urlString = request["url"] as? String, let url = URL(string: urlString), Server.owns(url) else { throw Problem(L("Nothing to play")) }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies().filter { cookie in
            guard let host = url.host else { return false }
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return host == domain || host.hasSuffix("." + domain)
        }
        video.load(url: url, start: (request["startSeconds"] as? NSNumber)?.doubleValue ?? 0, cookies: cookies)
    }

    private func pushVideo(_ state: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__netfishVideo && window.__netfishVideo(\(json))")
    }

    /// Tell the pages about download progress.
    private func push(_ list: [[String: Any]]) {
        guard let data = try? JSONSerialization.data(withJSONObject: list), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__netfishOfflineChanged && window.__netfishOfflineChanged(\(json))")
    }

    // ---------- Navigation ----------

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        // Frames inside the page (trailers) load freely.
        if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if url.scheme == LocalScheme.scheme || url.scheme == "about" || Server.owns(url) { return decisionHandler(.allow) }
        // Anything else (IMDb, Letterboxd links…) opens in Safari.
        if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    /// Links that open a new window go to Safari too.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A new page never keeps a film playing underneath it.
        video.stop()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let err = error as NSError
        guard err.code != NSURLErrorCancelled, err.code != 102 /* frame load interrupted */ else { return }
        let failed = err.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        if failed?.scheme == LocalScheme.scheme { return }
        // Away from home with films downloaded: straight to them, like Netflix.
        if store.hasDownloads { return showOffline([:]) }
        showSetup(error: L("Couldn't reach {server} ({error}). Is it on, and are you on your home network?", [
            "server": Server.url?.absoluteString ?? L("the server"), "error": err.localizedDescription,
        ]))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // ---------- confirm() / alert() from the pages ----------

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: L("OK"), style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: L("Cancel"), style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: L("OK"), style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
