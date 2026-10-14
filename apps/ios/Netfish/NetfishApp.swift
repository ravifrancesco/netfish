import SwiftUI
import UIKit

@main
struct NetfishApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()
                .background(Color(red: 6 / 255, green: 8 / 255, blue: 11 / 255))
                .preferredColorScheme(.dark)
        }
    }
}

private struct WebView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// iOS wakes the app when background downloads finish: let the store wrap up, then tell iOS.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == OfflineStore.sessionId else { return completionHandler() }
        OfflineStore.shared.backgroundCompletion = completionHandler
    }
}
