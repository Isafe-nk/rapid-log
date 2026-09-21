import AppKit
import AuthenticationServices
import CryptoKit
import Foundation

/// Signs in with Google outside this app's own web view, and hands the
/// resulting ID token back to the page.
///
/// Google's passkey prompt never fires inside a `WKWebView`. An embedded web
/// view runs in the calling app's context, so a passkey ceremony only succeeds
/// for a domain the app itself has claimed through Associated Domains —
/// `google.com` is not ours to claim. The ceremony fails with `NotAllowedError`
/// and the user is left with "More ways to verify" and no device prompt.
///
/// `ASWebAuthenticationSession` runs in the default browser's context instead,
/// isolated from this app and with the whole web platform available, passkeys
/// included. It shares Safari's session, so an account already signed in there
/// needs one tap. It also means this app can no longer read the page the
/// password is typed into — the reason Google discourages embedded web views
/// in the first place.
///
/// Installed apps cannot ask Google for an `id_token` directly: `response_type`
/// must be `code` here. So this runs the authorization-code flow with PKCE and
/// exchanges the code itself. No server is involved — an iOS-type OAuth client
/// carries no secret, and the PKCE verifier is what proves that the process
/// which started the flow is the one redeeming it.
final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {

    /// Created in Google Cloud as an **iOS** client, deliberately: a Desktop
    /// client is issued a secret, and that secret would ship inside this binary
    /// and into a public repository. An iOS client has none.
    ///
    /// Not sensitive. A client id names the application; it authorises nothing
    /// on its own, which is why PKCE is required alongside it.
    ///
    /// Two console steps go with this value. Sign-in fails without either:
    ///
    ///  1. Google Cloud → Credentials → Create an **iOS** OAuth client with
    ///     bundle id `com.limky.rapidlog`, and paste its id here.
    ///  2. Firebase → Authentication → Sign-in method → Google → **Whitelist
    ///     client IDs from external projects** → add that same id. Firebase
    ///     checks the `aud` of the token it is handed and rejects one issued
    ///     for a client it does not recognise.
    static let clientID = "REPLACE_WITH_IOS_OAUTH_CLIENT_ID.apps.googleusercontent.com"

    static var isConfigured: Bool { !clientID.hasPrefix("REPLACE_WITH_") }

    /// Google's convention for an installed app: the client id with its
    /// dot-separated components reversed. `1-abc.apps.googleusercontent.com`
    /// becomes `com.googleusercontent.apps.1-abc`.
    private static var redirectScheme: String {
        clientID.split(separator: ".").reversed().joined(separator: ".")
    }

    private static var redirectURI: String { "\(redirectScheme):/oauth2redirect" }

    private static let authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    private static let tokenEndpoint = "https://oauth2.googleapis.com/token"

    enum AuthError: LocalizedError {
        case notConfigured
        case cancelled
        case noCode(String?)
        case tokenExchangeFailed(String)
        case noIDToken

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "This build has no Google client id. See GoogleAuth.swift."
            case .cancelled:
                return "Sign in was cancelled."
            case .noCode(let reason):
                return reason.map { "Google returned an error: \($0)" }
                    ?? "Google did not return an authorization code."
            case .tokenExchangeFailed(let reason):
                return "Could not exchange the code: \(reason)"
            case .noIDToken:
                return "Google returned no ID token. Check the 'openid' scope."
            }
        }
    }

    /// Held for the duration of the flow. `ASWebAuthenticationSession` is
    /// deallocated — and the window closed from under the user — if nothing
    /// keeps a reference to it.
    private var session: ASWebAuthenticationSession?

    func signIn(completion: @escaping (Result<String, Error>) -> Void) {
        guard Self.isConfigured else {
            completion(.failure(AuthError.notConfigured))
            return
        }

        let verifier = Self.randomVerifier()

        var components = URLComponents(string: Self.authorizeEndpoint)!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: Self.clientID),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            // `openid` is what makes the token endpoint return an id_token at
            // all; email and profile fill in the account on the Firebase side.
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            // Always offer the chooser. Without this Google silently reuses the
            // last account and there is no way to switch — the same reason the
            // web path sets prompt=select_account on its provider.
            URLQueryItem(name: "prompt", value: "select_account"),
        ]

        let session = ASWebAuthenticationSession(
            url: components.url!,
            callbackURLScheme: Self.redirectScheme
        ) { [weak self] callbackURL, error in
            self?.session = nil

            if let error = error {
                let cancelled = (error as? ASWebAuthenticationSessionError)?.code
                    == .canceledLogin
                completion(.failure(cancelled ? AuthError.cancelled : error))
                return
            }

            guard
                let callbackURL = callbackURL,
                let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                    .queryItems,
                let code = items.first(where: { $0.name == "code" })?.value
            else {
                let reason = callbackURL
                    .flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems }
                    .flatMap { $0.first(where: { $0.name == "error" })?.value }
                completion(.failure(AuthError.noCode(reason)))
                return
            }

            Self.exchange(code: code, verifier: verifier, completion: completion)
        }

        session.presentationContextProvider = self
        // Deliberately not ephemeral: sharing Safari's session is the whole
        // point. It is what lets a passkey already registered on this Mac be
        // offered, and an account already signed in to be picked in one tap.
        session.prefersEphemeralWebBrowserSession = false

        self.session = session

        if !session.start() {
            completion(.failure(AuthError.cancelled))
        }
    }

    // MARK: - Token exchange

    private static func exchange(
        code: String,
        verifier: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        var request = URLRequest(url: URL(string: tokenEndpoint)!)
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded",
            forHTTPHeaderField: "Content-Type"
        )

        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: verifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
        ]
        request.httpBody = body.percentEncodedQuery?.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error = error {
                completion(.failure(AuthError.tokenExchangeFailed(error.localizedDescription)))
                return
            }
            guard
                let data = data,
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                completion(.failure(AuthError.tokenExchangeFailed("unreadable response")))
                return
            }
            if let googleError = json["error"] as? String {
                let detail = json["error_description"] as? String
                completion(.failure(
                    AuthError.tokenExchangeFailed(detail.map { "\(googleError): \($0)" } ?? googleError)
                ))
                return
            }
            guard let idToken = json["id_token"] as? String else {
                completion(.failure(AuthError.noIDToken))
                return
            }
            completion(.success(idToken))
        }.resume()
    }

    // MARK: - PKCE

    private static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        // SecRandomCopyBytes rather than a Swift RNG: the verifier is the only
        // thing standing in for a client secret here.
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        }
        return base64URL(Data(bytes))
    }

    private static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// base64url, per RFC 7636: the standard alphabet with `+/` swapped and the
    /// padding removed. Plain base64 is rejected by the token endpoint.
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }
}
