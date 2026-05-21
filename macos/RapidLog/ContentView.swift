import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
    }
}

struct WebView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // Inject flag so the web app knows it's running in the native macOS wrapper
        let script = WKUserScript(
            source: "window.__MACOS_NATIVE__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(script)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        // Load from Firebase Hosting
        let url = URL(string: "https://to-do-rapidlog.web.app")!
        webView.load(URLRequest(url: url))
        print("[RapidLog] Loading from: \(url)")

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

// MARK: - Delegates
class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {

    // Handle popup requests by loading in the same webview (avoids crash)
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Don't create popup — redirect-based auth is used instead
        if let url = navigationAction.request.url {
            print("[RapidLog] Popup request for: \(url) — loading in main view")
            webView.load(navigationAction.request)
        }
        return nil
    }

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

    // Handle WebContent process crash — reload instead of staying blank
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("[RapidLog] WebContent process terminated, reloading...")
        webView.reload()
    }
}
