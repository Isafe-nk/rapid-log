#!/usr/bin/env bash
#
# Rebuild the Mac app and put it in /Applications, for testing rather than
# shipping.
#
#   scripts/dev-macos.sh              build once, install, relaunch
#   scripts/dev-macos.sh --watch      do that again every time a source file changes
#   scripts/dev-macos.sh --no-open    install without relaunching
#   scripts/dev-macos.sh --reset      sign out first (clears the web view session)
#
# This is NOT the release path. scripts/package-macos.sh is, and it stays the
# one place the shipping recipe lives. The differences here are all deliberate
# and all in service of the loop being short:
#
#   universal -> this Mac's architecture only, which roughly halves the build
#   disk image -> skipped; the app is copied straight into /Applications
#   verification -> skipped; package-macos.sh is what gates an artifact
#   its own DerivedData -> so alternating with a release build does not force
#                          each to rebuild what the other just invalidated
#
# WHAT THIS CANNOT DO. The app has no bundled web assets: it loads
# https://to-do-rapidlog.web.app at launch. Anything you changed under src/ is
# NOT in the app until it is deployed, however many times you rebuild. Use
# `npm run dev` in a browser for web work. This script only ever changes Swift.

set -euo pipefail

WATCH=false
LAUNCH=true
RESET=false
for arg in "$@"; do
  case "$arg" in
    --watch)   WATCH=true ;;
    --no-open) LAUNCH=false ;;
    --reset)   RESET=true ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 64 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Its own, and .noindex for the same reason the release one is: Spotlight skips
# a directory named that way, which keeps the build product out of file search.
# Launch Services is a separate problem, handled after every build below.
DERIVED="macos/build/DevDerivedData.noindex"
APP="$DERIVED/Build/Products/Release/RapidLog.app"
DEST="/Applications/RapidLog.app"
WEBDATA="$HOME/Library/WebKit/com.limky.rapidlog"
COUNTER="macos/build/dev-build-number"
LOG="macos/build/dev-xcodebuild.log"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

# Everything a rebuild should react to. project.yml and the entitlements are in
# here because changing either changes the app as surely as changing Swift does.
WATCHED=(macos/RapidLog macos/project.yml)

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok  %s\n' "$*"; }

mkdir -p macos/build

version_from_package() {
  python3 -c 'import json;print(json.load(open("package.json")).get("version","0.0.0"))' 2>/dev/null \
    || echo "0.0.0"
}

# A build number that always goes up, so "is this the one I just built?" is
# answerable at a glance. Version alone cannot answer it — every build of this
# app calls itself the same thing.
next_build_number() {
  local n=1
  [ -f "$COUNTER" ] && n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$COUNTER"
  echo "$n"
}

build_and_install() {
  local version build started
  version="$(version_from_package)"
  build="dev$(next_build_number)"
  started=$(date +%s)

  step "Building $version ($build)"
  # ONLY_ACTIVE_ARCH and no ARCHS override: this Mac's slice only. The release
  # build is universal and must stay that way — an arm64-only build will not
  # launch on an Intel Mac at all — but nothing here is going to another Mac.
  if ! xcodebuild \
      -project macos/RapidLog.xcodeproj \
      -scheme RapidLog \
      -configuration Release \
      -derivedDataPath "$DERIVED" \
      ONLY_ACTIVE_ARCH=YES \
      CODE_SIGN_STYLE=Manual \
      CODE_SIGN_IDENTITY="-" \
      CODE_SIGNING_REQUIRED=YES \
      CODE_SIGNING_ALLOWED=YES \
      DEVELOPMENT_TEAM="" \
      MARKETING_VERSION="$version" \
      CURRENT_PROJECT_VERSION="$build" \
      build > "$LOG" 2>&1; then
    # Only the compiler's own lines. A full xcodebuild log buries three errors
    # in nine hundred lines of linker invocations.
    echo
    grep -E '(error|warning):' "$LOG" | head -20 | sed 's/^/   /' || true
    echo "   full log: $LOG"
    return 1
  fi
  ok "built in $(( $(date +%s) - started ))s"

  # A menu bar app outlives its window, so a running copy has to go before its
  # bundle is replaced — otherwise the old code stays in memory and the app you
  # then look at is not the one you just built.
  local was_running=false
  if pgrep -x RapidLog >/dev/null 2>&1; then
    was_running=true
    osascript -e 'tell application "RapidLog" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -x RapidLog >/dev/null 2>&1 || break
      /bin/sleep 0.3
    done
    pgrep -x RapidLog >/dev/null 2>&1 && pkill -x RapidLog || true
  fi

  if [ "$RESET" = true ] && [ -d "$WEBDATA" ]; then
    rm -rf "$WEBDATA"
    ok "signed out"
  fi

  rm -rf "$DEST"
  # ditto, not cp: it keeps the signature and the extended attributes intact.
  ditto "$APP" "$DEST" || fail "could not copy into /Applications"
  xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true

  # Every xcodebuild registers what it built, so without this each rebuild adds
  # another RapidLog to app search and launching the wrong one is
  # indistinguishable from the new build not working.
  if [ -x "$LSREG" ]; then
    "$LSREG" -u "$PWD/$APP" 2>/dev/null || true
    "$LSREG" -f "$DEST" 2>/dev/null || true
  fi

  ok "installed $version ($build) · $(lipo -archs "$DEST/Contents/MacOS/RapidLog")"

  if [ "$LAUNCH" = true ] || [ "$was_running" = true ]; then
    open "$DEST"
    ok "relaunched"
  fi
}

# A fingerprint of every watched file's modification time. Cheaper than it
# looks, and it needs no fswatch — which is not installed here and would be a
# dependency for something a loop and `find` already do.
fingerprint() {
  find "${WATCHED[@]}" -type f \( -name '*.swift' -o -name '*.yml' -o -name '*.entitlements' -o -name '*.plist' \) \
    -exec stat -f '%m %N' {} + 2>/dev/null | sort
}

if [ "$WATCH" = false ]; then
  build_and_install
  exit 0
fi

step "Watching"
printf '   %s\n' "${WATCHED[@]}"
printf '   Ctrl-C to stop. Swift only — src/ changes need a deploy, see --help.\n'

build_and_install || true
LAST="$(fingerprint)"

while true; do
  /bin/sleep 1
  NOW="$(fingerprint)"
  [ "$NOW" = "$LAST" ] && continue

  # Settle before building. An editor writing several files, or writing one in
  # two steps, would otherwise start a build against a half-saved tree.
  while true; do
    /bin/sleep 1
    SETTLED="$(fingerprint)"
    [ "$SETTLED" = "$NOW" ] && break
    NOW="$SETTLED"
  done

  LAST="$NOW"
  printf '\n─── %s ──────────────────────────\n' "$(date +%H:%M:%S)"
  # Deliberately not fatal. A typo should leave the watcher running so that
  # fixing it rebuilds, rather than making you restart the watcher too.
  build_and_install || echo "   build failed — still watching"
done
