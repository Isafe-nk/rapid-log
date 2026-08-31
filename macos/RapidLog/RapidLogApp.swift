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
            // A symbol image rather than a "●" text glyph, so the size and
            // baseline no longer come from the system font — it cannot shift if
            // the font resolves differently, and AppKit centres it rather than
            // a text baseline deciding where it sits.
            //
            // Only single marks survive up here. `checklist` was tried and
            // rejected: it packs two rows of circle-and-line into the menu
            // bar's ~17pt, so each row gets about 7pt and the circles collapse
            // into broken arcs. Every one of the system's own menu bar items is
            // a single shape, presumably for the same reason.
            //
            // A tick rather than the old dot, because a dot says nothing about
            // the app. Swapping it is one string: circle.fill at 10pt is the
            // previous look exactly, and smallcircle.filled.circle or
            // list.bullet at 13pt are the other legible options.
            //
            // Bold rather than regular. Heavy was tried and is a step too far:
            // at this size its strokes merge at the vertex and the tick reads
            // as a blob. Semibold is the lighter option if bold looks heavy
            // beside the rest of your menu bar.
            let icon = NSImage(
                systemSymbolName: "checkmark",
                accessibilityDescription: "Rapid Log"
            )?.withSymbolConfiguration(
                NSImage.SymbolConfiguration(pointSize: 13, weight: .bold)
            )
            // Set on the image actually used, not on the one it derived from.
            // Symbols are templates by default and the flag survives the
            // configuration, but neither is worth depending on silently.
            icon?.isTemplate = true
            button.image = icon

            // Kept as a fallback: if the symbol were ever unavailable, an empty
            // button would be an invisible, unclickable menu bar item.
            if button.image == nil {
                button.title = "●"
                button.font = NSFont.systemFont(ofSize: 11, weight: .bold)
            }
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

    /// Guest entries exist only in the web view's memory. WKWebView does not
    /// present `beforeunload` unless the host implements the JS panel delegate,
    /// so without this a guest loses everything to Cmd-Q with no warning — the
    /// one thing a browser gives them for free.
    ///
    /// Answering means asking the page, which is async, hence `.terminateLater`.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        webEngine.webView.evaluateJavaScript(
            "window.__unsavedGuestCount ? window.__unsavedGuestCount() : 0"
        ) { result, error in
            if let error = error {
                // Never trap someone in an app because a script failed.
                print("[RapidLog] Could not read guest state, quitting: \(error)")
                NSApp.reply(toApplicationShouldTerminate: true)
                return
            }

            let count = (result as? NSNumber)?.intValue ?? 0
            guard count > 0 else {
                NSApp.reply(toApplicationShouldTerminate: true)
                return
            }

            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = count == 1
                ? "Discard 1 unsaved entry?"
                : "Discard \(count) unsaved entries?"
            alert.informativeText = """
                You are using Rapid Log as a guest, so nothing has been saved. \
                Quitting discards these entries permanently. Sign in first to keep them.
                """
            alert.addButton(withTitle: "Quit and Discard")
            alert.addButton(withTitle: "Cancel")

            let discard = alert.runModal() == .alertFirstButtonReturn
            NSApp.reply(toApplicationShouldTerminate: discard)
        }

        return .terminateLater
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
