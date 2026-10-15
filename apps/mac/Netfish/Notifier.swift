import AppKit
import UserNotifications

/// Netfish's notices ("ready to watch") as macOS notifications. Clicking one brings Netfish
/// to the front on that page. macOS asks once whether Netfish may notify.
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()
    /// Opens a Netfish page (set by the main window).
    var open: ((String) -> Void)?

    /// Called at launch, so a click on a notification from earlier still lands somewhere.
    func start() {
        UNUserNotificationCenter.current().delegate = self
    }

    func show(title: String, body: String, path: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = ["path": path]
            center.add(UNNotificationRequest(identifier: path, content: content, trigger: nil))
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let path = response.notification.request.content.userInfo["path"] as? String
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            if let path { self.open?(path) }
        }
        done()
    }

    /// Shown even while Netfish is the app in front.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }
}
