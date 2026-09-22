#!/usr/bin/env bash
#
# Install the built disk image the way a recipient would, and say what landed.
#
#   scripts/install-macos.sh            install and launch
#   scripts/install-macos.sh --reset    also sign out first
#   scripts/install-macos.sh --no-open  install, do not launch
#
# Run scripts/package-macos.sh first; this installs what that produced.
#
# Three things about this app make a naive "drag it over" misleading, and this
# script exists for them:
#
#  1. It lives in the menu bar. Closing the window does not quit it, so a copy
#     can still be running while you replace it — and you would then be looking
#     at the old build wondering why nothing changed.
#
#  2. Its web view data is keyed to the bundle id, not to the app copy, and
#     survives every reinstall. A signed-in session therefore outlives the app,
#     which is exactly wrong when the thing you want to test is signing in.
#     --reset clears it.
#
#  3. Every build calls itself 1.2.0, so the version tells you nothing about
#     which one you are running. This reports the build number and checks the
#     binary for the OAuth client id instead.

set -euo pipefail

RESET=false
LAUNCH=true
for arg in "$@"; do
  case "$arg" in
    --reset)   RESET=true ;;
    --no-open) LAUNCH=false ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 64 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DMG="macos/build/artifacts/RapidLog-macOS.dmg"
DEST="/Applications/RapidLog.app"
WEBDATA="$HOME/Library/WebKit/com.limky.rapidlog"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok  %s\n' "$*"; }

[ -f "$DMG" ] || fail "no disk image at $DMG — run scripts/package-macos.sh <version> first"

MOUNT=""
cleanup() { [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; }
trap cleanup EXIT

step "Quitting any running copy"
# A menu bar app outlives its window. Replacing a running bundle leaves the old
# code in memory, so the app you then look at is not the one you just built.
if pgrep -x RapidLog >/dev/null 2>&1; then
  osascript -e 'tell application "RapidLog" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x RapidLog >/dev/null 2>&1 || break
    /bin/sleep 0.3
  done
  pgrep -x RapidLog >/dev/null 2>&1 && pkill -x RapidLog || true
  ok "quit"
else
  ok "none running"
fi

if [ "$RESET" = true ]; then
  step "Signing out"
  # The Firebase session lives in the web view's IndexedDB under this path. It
  # is keyed to the bundle id, so it survives reinstalling and would otherwise
  # leave you signed in when you are trying to test signing in.
  if [ -d "$WEBDATA" ]; then
    rm -rf "$WEBDATA"
    ok "cleared $WEBDATA"
  else
    ok "nothing stored"
  fi
  ok "the app will start signed out"
fi

step "Installing"
for stale in /Volumes/Rapid\ Log*; do
  [ -d "$stale" ] && hdiutil detach "$stale" -quiet 2>/dev/null || true
done
MOUNT="$(hdiutil attach "$DMG" -nobrowse -readonly | grep -oE '/Volumes/.*$' | head -1)"
[ -n "$MOUNT" ] || fail "could not mount $DMG"

rm -rf "$DEST"
# ditto rather than cp: it preserves the signature and extended attributes, and
# a copy that breaks the signature is refused by Gatekeeper for a different
# reason than the one this app already has.
ditto "$MOUNT/RapidLog.app" "$DEST" || fail "could not copy into /Applications"
ok "installed to $DEST"

# Ad-hoc signed, so macOS would refuse to open it. Clearing quarantine is what a
# recipient has to do by hand; notarizing is the only real fix and needs a paid
# Apple Developer account. See CONTRIBUTING.md.
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true
ok "quarantine cleared"

step "What is now installed"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DEST/Contents/Info.plist")"
printf '   version    %s (build %s)\n' "$VERSION" "$BUILD"
printf '   arch       %s\n' "$(lipo -archs "$DEST/Contents/MacOS/RapidLog")"

if strings "$DEST/Contents/MacOS/RapidLog" | grep -q 'apps.googleusercontent.com'; then
  printf '   sign-in    native (system browser sheet)\n'
else
  printf '   sign-in    in-page redirect — this build predates native sign-in\n'
fi

if [ -d "$WEBDATA" ]; then
  printf '   session    kept (re-run with --reset to start signed out)\n'
else
  printf '   session    none — will start signed out\n'
fi

if [ "$LAUNCH" = true ]; then
  step "Launching"
  open "$DEST"
  ok "started"
  printf '\n   Watch the log with:  log stream --predicate '"'"'process == "RapidLog"'"'"' --info\n'
fi
