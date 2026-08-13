import SwiftUI
import WebKit

/// Owns the single WKWebView for the app's lifetime. The web view must outlive
/// the window: it is the only source of task data for the menu bar popover, and
/// closing the window used to tear it down and leave the popover stale and inert.
class WebEngine: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let viewModel: MenuBarViewModel
    let webView: WKWebView

    private static let homeURL = URL(string: "https://to-do-rapidlog.web.app")!

    init(viewModel: MenuBarViewModel) {
        self.viewModel = viewModel

        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let script = WKUserScript(
            source: "window.__MACOS_NATIVE__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(script)

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        config.userContentController.add(self, name: "taskUpdate")
        webView.navigationDelegate = self
        webView.uiDelegate = self

        viewModel.onToggleTask = { [weak self] taskId in
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript(
                    "window.__toggleTodoFromNative && window.__toggleTodoFromNative('\(taskId)');"
                )
            }
        }
    }

    func loadIfNeeded() {
        guard webView.url == nil else { return }
        load()
    }

    /// Always revalidates the document. A cached index.html points at a stale
    /// hashed bundle that Firebase still serves, so the app would silently run
    /// old code after a deploy.
    func load() {
        var request = URLRequest(url: Self.homeURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(request)
        print("[RapidLog] Loading from: \(Self.homeURL)")
    }

    // MARK: - WKScriptMessageHandler
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if message.name == "taskUpdate", let jsonString = message.body as? String {
            DispatchQueue.main.async {
                self.viewModel.updateFromJSON(jsonString)
            }
        }
    }

    // MARK: - WKUIDelegate
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            print("[RapidLog] Popup request for: \(url) — loading in main view")
            webView.load(navigationAction.request)
        }
        return nil
    }

    // MARK: - WKNavigationDelegate
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("[RapidLog] Page loaded successfully")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[RapidLog] Load failed: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("[RapidLog] WebContent process terminated, reloading...")
        webView.reload()
    }
}

struct ContentView: View {
    let webEngine: WebEngine

    var body: some View {
        WebViewContainer(webEngine: webEngine)
            .ignoresSafeArea()
    }
}

/// Hands the long-lived web view to SwiftUI. Detaching from any previous
/// superview lets the window be closed and reopened around the same instance.
struct WebViewContainer: NSViewRepresentable {
    let webEngine: WebEngine

    func makeNSView(context: Context) -> WKWebView {
        webEngine.webView.removeFromSuperview()
        return webEngine.webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
