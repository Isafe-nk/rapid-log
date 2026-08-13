import SwiftUI
import AppKit

@main
struct RapidLogApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    // The main window is created and owned by AppDelegate rather than a
    // WindowGroup so that closing it does not deallocate the WebEngine the
    // menu bar popover depends on.
    var body: some Scene {
        Settings { EmptyView() }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var rightClickMenu: NSMenu!
    var mainWindow: NSWindow?

    let viewModel = MenuBarViewModel()
    lazy var webEngine = WebEngine(viewModel: viewModel)

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Start loading immediately so the menu bar has data even if the user
        // never opens (or closes) the main window.
        webEngine.loadIfNeeded()

        // Setup NSPopover for left click
        popover = NSPopover()
        popover.contentSize = NSSize(width: 280, height: 360)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: MenuBarPopover(viewModel: viewModel))

        // Setup NSStatusItem
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "●"
            button.font = NSFont.systemFont(ofSize: 11, weight: .bold)
            button.action = #selector(statusItemClicked(_:))
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        // Setup NSMenu for right click
        rightClickMenu = NSMenu()
        rightClickMenu.addItem(
            NSMenuItem(title: "Launch Rapid Log", action: #selector(launchApp), keyEquivalent: "")
        )
        rightClickMenu.addItem(
            NSMenuItem(title: "Reload", action: #selector(reloadWebApp), keyEquivalent: "r")
        )
        rightClickMenu.addItem(NSMenuItem.separator())
        rightClickMenu.addItem(
            NSMenuItem(title: "Quit Rapid Log", action: #selector(quitApp), keyEquivalent: "q")
        )

        showMainWindow()
    }

    /// Rapid Log keeps living in the menu bar after its window is closed.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Clicking the Dock icon brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }

        if event.type == .rightMouseUp {
            // Right click -> display native context menu with Launch and Quit
            statusItem.menu = rightClickMenu
            statusItem.button?.performClick(nil)
            statusItem.menu = nil
        } else {
            // Left click -> toggle popover task list
            if popover.isShown {
                popover.performClose(sender)
            } else {
                popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
                popover.contentViewController?.view.window?.makeKey()
            }
        }
    }

    @objc func launchApp() {
        showMainWindow()
    }

    @objc func reloadWebApp() {
        webEngine.load()
        showMainWindow()
    }

    @objc func quitApp() {
        NSApp.terminate(nil)
    }

    private func showMainWindow() {
        if mainWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 520, height: 780),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "Rapid Log"
            window.isReleasedWhenClosed = false
            window.center()
            window.setFrameAutosaveName("RapidLogMainWindow")
            window.contentView = NSHostingView(rootView: ContentView(webEngine: webEngine))
            mainWindow = window
        }

        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }
}
