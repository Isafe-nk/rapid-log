import SwiftUI
import WebKit

/// Owns the single WKWebView for the app's lifetime. The web view must outlive
/// the window: it is the only source of task data for the menu bar popover, and
/// closing the window used to tear it down and leave the popover stale and inert.
class WebEngine: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let viewModel: MenuBarViewModel
    let webView: WKWebView

    /// Sign-in happens outside this web view. See GoogleAuth.swift for why a
    /// passkey can never be used inside one.
    private let googleAuth = GoogleAuth()

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
        config.userContentController.add(self, name: "googleSignIn")
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

    /// Loads on the server's own caching terms, which are already the right
    /// ones: firebase.json serves `/` as `no-cache, must-revalidate`, so the
    /// document is revalidated on every launch and cannot point at a stale
    /// bundle, while the hashed assets beside it are `immutable` and can be
    /// reused.
    ///
    /// This used to force `.reloadIgnoringLocalCacheData`, guarding against a
    /// stale index.html. The guard was real but the server header already
    /// provides it, and the policy applies to the whole load — so every launch
    /// re-downloaded the JavaScript bundle as well. That is roughly 225 KB and
    /// most of a second, paid on every single launch, to solve a problem that
    /// was already solved.
    ///
    /// If the app ever appears to run old code after a deploy, check that
    /// header before reaching for a cache policy here.
    func load() {
        webView.load(URLRequest(url: Self.homeURL))
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

        if message.name == "googleSignIn" {
            DispatchQueue.main.async { self.startGoogleSignIn() }
        }
    }

    /// Runs the system sign-in sheet, then hands the ID token to the page,
    /// which trades it for a Firebase session. The page is waiting on a promise
    /// that only this call can settle, so every path here must report back —
    /// including the failures, or the button spins for ever.
    private func startGoogleSignIn() {
        googleAuth.signIn { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let idToken):
                    self?.deliverSignIn(idToken: idToken, error: nil)
                case .failure(let error):
                    print("[RapidLog] Google sign-in failed: \(error.localizedDescription)")
                    self?.deliverSignIn(idToken: nil, error: error.localizedDescription)
                }
            }
        }
    }

    private func deliverSignIn(idToken: String?, error: String?) {
        // JSON-encoded rather than interpolated into quotes. A token is base64url
        // and safe, but an error message is arbitrary text and a stray apostrophe
        // would turn this into a syntax error that silently does nothing.
        func literal(_ value: String?) -> String {
            guard let value = value else { return "null" }
            guard
                let data = try? JSONSerialization.data(
                    withJSONObject: [value],
                    options: [.fragmentsAllowed]
                ),
                let array = String(data: data, encoding: .utf8)
            else { return "null" }
            return String(array.dropFirst().dropLast())
        }

        let js = """
            window.__nativeGoogleSignInResult \
            && window.__nativeGoogleSignInResult(\(literal(idToken)), \(literal(error)));
            """
        webView.evaluateJavaScript(js)
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
