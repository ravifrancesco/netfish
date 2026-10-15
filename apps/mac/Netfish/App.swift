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
        AutoUpdate.shared.start()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { main.showWindow(nil) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        main.player.shutdown()
        AutoUpdate.shared.quitting()
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
        app.addItem(withTitle: L("About Netfish"), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(item(L("Change Server…"), #selector(changeServer), ""))
        app.addItem(.separator())
        app.addItem(withTitle: L("Hide Netfish"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: L("Hide Others"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: L("Show All"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: L("Quit Netfish"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        add(app, "Netfish", to: menu)

        // Copy/paste etc. only work in the page's text fields if these exist.
        let edit = NSMenu(title: L("Edit"))
        edit.addItem(withTitle: L("Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: L("Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: L("Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: L("Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: L("Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: L("Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        add(edit, L("Edit"), to: menu)

        let view = NSMenu(title: L("View"))
        view.addItem(item(L("Reload"), #selector(reload), "r"))
        let fullScreen = view.addItem(withTitle: L("Toggle Full Screen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        add(view, L("View"), to: menu)

        let go = NSMenu(title: L("Go"))
        go.addItem(item(L("Home"), #selector(goHome), "1"))
        go.addItem(item(L("Back"), #selector(goBack), "["))
        let downloads = item(L("Downloads"), #selector(openDownloads), "d")
        downloads.keyEquivalentModifierMask = [.command, .shift]
        go.addItem(downloads)
        add(go, L("Go"), to: menu)

        let window = NSMenu(title: L("Window"))
        window.addItem(withTitle: L("Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: L("Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        add(window, L("Window"), to: menu)
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
