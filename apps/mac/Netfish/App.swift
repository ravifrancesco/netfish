import AppKit

/// Netfish for Mac: one window around your Netfish server's interface, with
/// mpv playing films underneath it (the way Jellyfin Media Player works).
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var main: MainWindow!

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        main = MainWindow()
        main.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { main.showWindow(nil) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        main.player.shutdown()
    }

    // ---------- Menus ----------

    @objc private func changeServer() { main.showSetup(error: nil) }
    @objc private func openDownloads() { main.showOffline([:]) }
    @objc private func goHome() { main.goHome() }
    @objc private func reload() { main.reload() }
    @objc private func goBack() { main.web.goBack() }

    private func buildMenu() {
        let menu = NSMenu()

        let app = NSMenu()
        app.addItem(withTitle: "About Netfish", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(item("Change Server…", #selector(changeServer), ""))
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Netfish", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit Netfish", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        add(app, "Netfish", to: menu)

        // Copy/paste etc. only work in the page's text fields if these exist.
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        add(edit, "Edit", to: menu)

        let view = NSMenu(title: "View")
        view.addItem(item("Reload", #selector(reload), "r"))
        let fullScreen = view.addItem(withTitle: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        add(view, "View", to: menu)

        let go = NSMenu(title: "Go")
        go.addItem(item("Home", #selector(goHome), "1"))
        go.addItem(item("Back", #selector(goBack), "["))
        let downloads = item("Downloads", #selector(openDownloads), "d")
        downloads.keyEquivalentModifierMask = [.command, .shift]
        go.addItem(downloads)
        add(go, "Go", to: menu)

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        add(window, "Window", to: menu)
        NSApp.windowsMenu = window

        NSApp.mainMenu = menu
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func add(_ submenu: NSMenu, _ title: String, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        menu.addItem(item)
    }
}
