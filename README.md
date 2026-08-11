<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/506782dd-2406-47c5-bd62-862017b0d6a1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploying

The web app is the source of truth for all three shells. The macOS app and the
iOS wrapper both load `https://to-do-rapidlog.web.app` in a web view, so a code
change does not reach them until it is deployed — rebuilding in Xcode is not
enough:

```
npm run build
npx firebase deploy --only hosting
```

`index.html` is served with `no-cache` and hashed assets with `immutable`
(see [firebase.json](firebase.json)). Without that, a cached `index.html` keeps
resolving the previous bundle, which Firebase still serves, and the app silently
runs old code after a deploy.

## Google sign-in configuration

`authDomain` in [firebase-applet-config.json](firebase-applet-config.json) points
at `to-do-rapidlog.web.app` — the domain the app is served from — rather than the
default `to-do-rapidlog.firebaseapp.com`. Sign-in fails in the macOS web view
otherwise: completing the flow means reading the result across sites, and WebKit
blocks that, so the app comes back from Google still signed out.

**This depends on a setting that is not in this repo.** The Google Cloud OAuth
client must list both handlers under *Authorized redirect URIs*:

```
https://to-do-rapidlog.web.app/__/auth/handler           required by authDomain above
https://to-do-rapidlog.firebaseapp.com/__/auth/handler   keep, so authDomain can be reverted
```

Console: https://console.cloud.google.com/apis/credentials?project=to-do-rapidlog

If sign-in ever fails with `redirect_uri_mismatch`, check that list first.
