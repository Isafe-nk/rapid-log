# Contributing

Rapid Log is deliberately small. The goal is a daily log you can read in one
glance, so the bar for a new feature is high: most good ideas make the app
better at something it is not trying to do.

That said — bug reports, fixes, and questions about how something works are all
welcome, and the sections below are the things that are genuinely surprising
about this codebase.

## Run it locally

Requires Node.js.

```
npm install
npm run dev
```

That runs against the real Firebase project, so signing in writes to real data.
`npm run lint` is `tsc --noEmit`; there is no test suite.

## How it fits together

One web app, three shells:

| Shell | What it is |
|---|---|
| **Web** | React 19 + Vite + Tailwind, deployed to Firebase Hosting |
| **macOS** | SwiftUI wrapping a `WKWebView`, plus a menu bar popover |
| **iOS** | Capacitor wrapper around the same web app |

The web app is the source of truth. **The macOS shell loads the deployed URL**,
so a code change does not reach it until it is deployed — rebuilding in Xcode is
not enough. The iOS shell is the exception: it bundles `dist` (`webDir` in
[`capacitor.config.ts`](capacitor.config.ts)), so it ships a frozen snapshot and
needs `npm run build && npx cap sync` before it reflects anything.

Nearly all of the web app lives in `src/App.tsx`. That is a choice, not an
oversight — it is one screen, and splitting it made it harder to follow, not
easier.

## Data

There is no server. The browser talks to Firestore directly, so the whole
backend is three things:

- **`todos` collection** — one document per entry, with `text`, `completed`,
  `type`, `timeOfDay`, `time`, `endTime`, `priority`, `userId` and `createdAt`
  (epoch ms).
- **[`firestore.rules`](firestore.rules)** — default deny, ownership checks on
  every operation, and per-field validation. The permitted fields are named
  explicitly, so **adding a field to an entry means adding it here too** or
  every write will fail with a permission error.
- **[`firestore.indexes.json`](firestore.indexes.json)** — a composite index on
  `(userId, createdAt)`. The app subscribes to a 30-day window rather than every
  entry ever created; opening an older date widens it. That query cannot run
  without this index.

Guest mode keeps entries in React state only. Signing in stashes them in
`localStorage` first, because native sign-in uses `signInWithRedirect`, which
navigates the page away and destroys everything in memory. The stash has a
10-minute TTL and is cleared only after the write succeeds.

## Deploy

```
npm run build
npx firebase deploy --only hosting
```

Rules and indexes deploy separately, and an index must finish building before
the query that needs it will run:

```
npx firebase deploy --only firestore:rules
npx firebase deploy --only firestore:indexes
```

`index.html` is served with `no-cache` and hashed assets with `immutable` (see
[`firebase.json`](firebase.json)). Without that, a cached `index.html` keeps
resolving the previous bundle — which Firebase still serves — and the app
silently runs old code after a deploy.

This deploys the web app only. The macOS download is attached to a GitHub
Release and reached through a redirect, so shipping a new version of the app
needs no deploy at all — see [Releasing](#releasing). A deploy is only required
when the redirect itself changes.

## Google sign-in

`authDomain` in [`firebase-applet-config.json`](firebase-applet-config.json)
points at `to-do-rapidlog.web.app`, the domain the app is served from, rather
than the default `to-do-rapidlog.firebaseapp.com`. Sign-in fails in the macOS
web view otherwise: completing the flow means reading the result across sites,
and WebKit blocks that, so the app returns from Google still signed out.

**This depends on a setting that is not in this repo.** The Google Cloud OAuth
client must list both handlers under *Authorized redirect URIs*:

```
https://to-do-rapidlog.web.app/__/auth/handler           required by authDomain above
https://to-do-rapidlog.firebaseapp.com/__/auth/handler   keep, so authDomain can be reverted
```

Console: https://console.cloud.google.com/apis/credentials?project=to-do-rapidlog

If sign-in ever fails with `redirect_uri_mismatch`, check that list first.

### The Mac app signs in outside its own web view

Everything above describes the **web** path, which the iOS app also uses. The
Mac app does not: it runs the whole flow in a system browser sheet and hands
the result back to the page.

The reason is passkeys. An embedded `WKWebView` runs in the host app's context,
so a WebAuthn ceremony only succeeds for a domain that app has claimed through
Associated Domains — and `google.com` is not ours to claim. Google's "Use your
passkey to confirm it's really you" screen appears, the device is never asked,
and the only way through is *More ways to verify*. No configuration fixes this;
the entitlement that would is not one this app can hold.

[`GoogleAuth.swift`](macos/RapidLog/GoogleAuth.swift) uses
`ASWebAuthenticationSession` instead, which runs in the default browser's
context with the full web platform available. It also means the app can no
longer read the page the password is typed into — the reason Google discourages
embedded web views generally.

```
Swift   ASWebAuthenticationSession  →  authorization code   (passkeys work here)
Swift   POST oauth2.googleapis.com/token  (code + PKCE verifier)  →  id_token
Swift   evaluateJavaScript → window.__nativeGoogleSignInResult(idToken, null)
TS      signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
```

Installed apps cannot ask Google for an `id_token` directly — `response_type`
must be `code` — hence the exchange. There is no server in it: the OAuth client
is an **iOS** client, which carries no secret, and the PKCE verifier stands in
for one. A *Desktop* client would have shipped a secret inside the binary.

**This needs an iOS OAuth client, which does not live in this repo.** The
project's automatic client is a *Web* client; Apple apps need their own.

Firebase creates one for you, so there is no need to visit the Cloud console:

```
Firebase Console → Project settings → Your apps → Add app → iOS
  Bundle ID: com.limky.rapidlog
```

Registering the app provisions an OAuth 2.0 iOS client in the underlying Cloud
project. Download `GoogleService-Info.plist`, read `CLIENT_ID` out of it, and
put that in `GoogleAuth.clientID`. The plist itself is not needed — this code
takes the id as a constant — but its `REVERSED_CLIENT_ID` is a useful check
that it matches the scheme `GoogleAuth` derives.

The iOS app shares this bundle id, so one registration covers both Apple
shells.

There is also a **Whitelist client IDs from external projects** field under
Firebase → Authentication → Sign-in method → Google. It is for clients that
live in a *different* project, so a client Firebase created here does not need
it. If sign-in ever fails with an audience mismatch — Firebase checking the
`aud` of the token and not recognising the client — that field is the fix, and
the error says nothing about it.

`GoogleAuth.clientID` ships as a `REPLACE_WITH_…` placeholder. Until it is
filled in, the Mac app reports "This build has no Google client id" rather than
opening an empty browser sheet. The client id is not a secret — it names the
application and authorises nothing on its own.

No `Info.plist` entry is needed. `ASWebAuthenticationSession` intercepts the
redirect itself through `callbackURLScheme`, so the reversed-client-id scheme
is passed to the session rather than registered with the system.

If the Mac app is older than the web app and has no `googleSignIn` bridge, the
web code falls back to the redirect flow — sign-in still works there, passkeys
aside.

## The app icon

```
assets/icon/make-icons.sh
```

`assets/icon/icon.png` is the only artwork. The script derives every platform's
copy from it, and refuses to run if the master has no transparency.

It exists because the icon used to be three unrelated copies with nothing
keeping them in step — which is how the macOS set came to be JPEGs carrying a
`.png` extension while the web version stayed a clean SVG. The platforms want
genuinely different things:

| | needs |
| --- | --- |
| macOS | transparency, and a margin around the body. Finder and the Dock draw the icon exactly as given, so the rounded shape has to be in the file. |
| iOS | **no** alpha — the App Store rejects icons that have it — and full-bleed artwork, since iOS applies its own mask. The margin macOS needs would show here as a shrunken icon, so the script crops to the body and flattens. |

The web favicon is hand-written SVG inlined in `index.html` and
`public/manifest.webmanifest`, and is **not** generated: a data URI built from a
few shapes costs no request and stays sharp at any size, which a downscaled PNG
does not. If the artwork changes shape, edit that SVG to match — its geometry is
measured off the master.

Apple's grid puts the icon body at 824 of 1024, leaving a margin. Artwork that
fills the canvas edge to edge will sit larger than its neighbours in the Dock
even once its corners are rounded.

## The macOS app

The window and the menu bar popover share one long-lived `WKWebView` owned by
`AppDelegate`, not by a SwiftUI `WindowGroup` — closing the window would
otherwise deallocate it and leave the popover stale and inert.

### Building the download

```
scripts/package-macos.sh 1.2.0
```

That builds and packages the disk image into `macos/build/artifacts/`, and
verifies it the way a recipient receives it. It is the same script CI runs, so a
release cannot be built one way here and another way there.

It refuses to produce an artifact — rather than warning — if the app reports a
version other than the one asked for, if `lipo` does not report both
architectures, if the signature does not survive the round trip through the
image, if the image has no working `Applications` symlink, if the background or
volume icon is missing, if the icons are not where `settings.py` puts them, or
if any web asset ends up inside the bundle. The layout is read back out of the
built image's `.DS_Store`, because an unstyled image still mounts and still
works — it just silently looks like nothing was done.

Two details in there are worth knowing, because they are easy to get wrong by
hand:

`ARCHS="arm64 x86_64"` is not optional. A plain Release build produces an
arm64-only binary that Intel Macs cannot launch at all.

The version is passed to `xcodebuild` as `MARKETING_VERSION` rather than read
from `project.yml`, so that file's literal never takes part in a release. It
had drifted a full minor version behind `package.json` before this existed.

### The disk image

The disk image is the download. A zip left a bare `RapidLog.app` in
`~/Downloads` with no hint where it belonged, so people ran it from there
indefinitely; the image opens a window with the app, an `Applications` symlink
and an arrow between them.

Its appearance is built from `macos/dmg/`:

| | |
| --- | --- |
| `settings.py` | window size, icon coordinates, icon size, chrome |
| `background.png`, `background@2x.png` | the artwork, combined into one HiDPI TIFF at build time |
| `make-background.py` | regenerates both PNGs |

The icon coordinates in `settings.py` and the arrow drawn by
`make-background.py` are two halves of one layout. Move an icon without
redrawing the background and the arrow points at empty space, so change both
together.

`dmgbuild` does the packaging, installed into a venv under `macos/build/` on
first run — no global install, and nothing to set up before cloning. It is used
rather than AppleScript because it writes the `.DS_Store` itself: the
conventional recipe drives Finder to place the icons, which needs a logged-in
GUI session and does not work on a runner.

The background's ground is the app's `#fcfcf9`, which has to differ from the
icon's cream body or the icon would have no visible edges. It was briefly
matched to that cream instead, back when the icons were JPEGs with no alpha and
the match was the only way to hide the opaque square they painted; both the
match and the `sips` conversion `iconutil` needed went when the icons became
real PNGs. See [the app icon](#the-app-icon).

Shipping an image changes where the app lands, not whether it opens. Quarantine
attaches to the downloaded image and files dragged out of it inherit the flag,
so the Gatekeeper wall below is unaffected.

### Releasing

Push a tag. `.github/workflows/release-macos.yml` runs the same script and
attaches the disk image to a GitHub Release:

```
git tag -a v1.2.0 -m "..." && git push origin v1.2.0
```

Ad-hoc signing needs no certificate, so the runner needs no secrets.
`CFBundleVersion` comes from the run number, which never repeats.

To rehearse without publishing, run the workflow from the Actions tab with
**workflow_dispatch**, or just run the script locally — they do the same work
and the same checks.

### Signing

The app is **ad-hoc signed** (`Signature=adhoc`, no team identifier), so
`spctl -a -t exec` rejects it and macOS refuses to open it after download.
Recipients have to clear the quarantine flag by hand:

```
xattr -d com.apple.quarantine /Applications/RapidLog.app
```

Fixing this properly needs the Apple Developer Program: a *Developer ID
Application* certificate to sign with, then notarization and stapling.

```
xcodebuild ... CODE_SIGN_IDENTITY="Developer ID Application: NAME (TEAMID)" \
  OTHER_CODE_SIGN_FLAGS="--timestamp --options=runtime"
xcrun notarytool submit macos/build/artifacts/RapidLog-macOS.dmg \
  --apple-id ... --team-id ... --wait
xcrun stapler staple macos/build/artifacts/RapidLog-macOS.dmg
```

Hardened runtime (`--options=runtime`) is required for notarization and is not
enabled by the ad-hoc build.

## The iOS app

`DEVELOPMENT_TEAM` is deliberately blank in `ios/App/App.xcodeproj`, so building
for a device means selecting your own team under *Signing & Capabilities* first.
See the note above about `dist` being bundled rather than fetched.

## Pull requests

Branch from `main`. Commit messages are lowercase, imperative, and say what
changed and why — `fix: stop the log arriving in waves` rather than
`fix bug`. Run `npm run lint` before opening the PR.

If a change touches an entry's shape, check that `firestore.rules` was updated
in the same commit. That is the single easiest thing to forget here.

### What CI checks

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
`npm ci`, then `npm run lint` and `npm run build`. Node comes from `.nvmrc`, so
CI and a local checkout cannot end up on different majors.

It also fails on three things that are easy to reintroduce and awkward to
notice:

- **A committed binary.** The download belongs on a release; roughly 10 MB of
  superseded ones are already in this repository's history because nothing
  stopped them.
- **A download redirect pointing at a file nothing builds.** `firebase.json`
  redirects by filename, so renaming the script's output silently 404s the
  download at GitHub.
- **An executable in `dist`.** Hosting rejects those on the Spark plan, and the
  deploy fails only *after* the build has passed, which reads as a broken
  pipeline rather than a bad payload.

Releases are a separate workflow; see [Releasing](#releasing).
