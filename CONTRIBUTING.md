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

## The macOS app

The window and the menu bar popover share one long-lived `WKWebView` owned by
`AppDelegate`, not by a SwiftUI `WindowGroup` — closing the window would
otherwise deallocate it and leave the popover stale and inert.

### Building the download

```
cd macos
xcodebuild -project RapidLog.xcodeproj -scheme RapidLog -configuration Release \
  -derivedDataPath build/DerivedData ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO build

cd ..
ditto -c -k --keepParent --noextattr --norsrc \
  macos/build/DerivedData/Build/Products/Release/RapidLog.app \
  public/RapidLog-macOS.zip
```

`ARCHS` is not optional. A plain Release build produces an arm64-only binary
that Intel Macs cannot launch at all.

`ditto --keepParent` is what puts `RapidLog.app` at the root of the archive.
Zipping from inside the bundle yields a bare `Contents/` folder that is not a
launchable app. `--noextattr --norsrc` drop the `._` AppleDouble files that
`com.apple.provenance` would otherwise scatter through the archive; the
signature survives both. Verify by extracting the zip and running
`codesign --verify --deep --strict` on the result.

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
xcrun notarytool submit public/RapidLog-macOS.zip --apple-id ... --team-id ... --wait
xcrun stapler staple macos/build/.../RapidLog.app   # then re-zip the stapled app
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
