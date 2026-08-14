<div align="center">

# Rapid Log

**A daily log that fits on one page.**

Each day is split into Morning, Noon and Night. Every line is a task, an event
or a note. Nothing else.

[**Open the web app**](https://to-do-rapidlog.web.app) &nbsp;·&nbsp;
[**Download for macOS**](https://to-do-rapidlog.web.app/RapidLog-macOS.zip)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

<!--
  Screenshot goes here. Two images, captured from the Release build:
    1. The app window with a populated day.
    2. The menu bar popover open, showing today at a glance.
  Commit them to docs/images/ and reference them below.
-->

## What it does

- **One page per day.** Morning, Noon and Night. No projects, no boards, no tags.
- **Three kinds of line.** A task, an event or a note — switched beside the input
  before you write.
- **Times when you want them.** Any entry can carry a start and an end time, and
  entries sort by time, then by when you added them.
- **Priority.** Star a line to mark it. It stays where it is; the star is there
  to catch your eye, not to reorder your day.
- **Drag between sections.** Move something from Morning to Night by dragging it.
- **Completed entries are archived, not deleted.** The day stays readable; the
  record stays intact.
- **Menu bar access on macOS.** Today's entries without switching windows.
- **Guest mode.** Use it without an account. Nothing is saved, and signing in
  later brings whatever you wrote with you.

## Install

**Web** — nothing to install: [to-do-rapidlog.web.app](https://to-do-rapidlog.web.app).
Works everywhere, but there is no menu bar.

**macOS 14 or later** — [download the app](https://to-do-rapidlog.web.app/RapidLog-macOS.zip)
(universal, Apple Silicon and Intel), then:

1. Move `RapidLog.app` to your Applications folder.
2. Run this once, because the app is not notarized yet:

   ```
   xattr -d com.apple.quarantine /Applications/RapidLog.app
   ```

3. Open it. Left-click the dot in the menu bar for today at a glance;
   right-click for a menu with the full window, reload and quit.

Without step 2 macOS refuses to open it and offers only *Move to Trash*. It is
not a warning you can click past. See [Signing](CONTRIBUTING.md#signing) for why,
and [build it yourself](CONTRIBUTING.md#the-macos-app) if you would rather not
run a downloaded binary.

**iOS** — no build is published. The Xcode project is in [`ios/`](ios) and you
can build it with your own signing team.

## Your data

There is no Rapid Log server. The app talks to Firestore directly, and every
entry is stored under your own account and readable only by you — enforced by
[`firestore.rules`](firestore.rules), which denies by default and checks
ownership on every read and write.

There is no analytics, no tracking and no third party besides Google (Firebase
for storage, Google Sign-In for your account).

In guest mode nothing leaves the tab. Entries live in memory, are gone when you
close it, and the macOS app warns you before quitting with unsaved ones.

## Built with

React 19, Vite, Tailwind and Framer Motion, on Firebase Auth, Firestore and
Hosting. The macOS app is SwiftUI wrapping a `WKWebView`; the iOS app is
Capacitor. One web app, three shells.

## Contributing

Bug reports, feature requests and pull requests are all welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for how to run it locally, how the pieces fit
together, and how to build and deploy each shell.

Security issues: please read [SECURITY.md](SECURITY.md) rather than opening a
public issue.

## License

[MIT](LICENSE).
