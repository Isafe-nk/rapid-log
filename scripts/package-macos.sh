#!/usr/bin/env bash
#
# Build, package and verify the macOS download.
#
#   scripts/package-macos.sh <version> [build-number]
#   scripts/package-macos.sh 1.2.0
#
# Produces macos/build/artifacts/RapidLog-macOS.dmg. That path sits under
# build/, which .gitignore already covers, so nothing here can be committed by
# accident.
#
# This is the one place the recipe lives: CI calls this script rather than
# repeating the commands, so the two cannot drift apart. Every check below
# refuses to produce an artifact rather than warning about it — a bad build that
# ships is worse than no build.

set -euo pipefail

VERSION="${1:-}"
BUILD_NUMBER="${2:-1}"

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> [build-number]" >&2
  echo "   eg: $0 1.2.0" >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DERIVED="macos/build/DerivedData"
APP="$DERIVED/Build/Products/Release/RapidLog.app"
OUT="macos/build/artifacts"
STAGE="macos/build/dmg-stage"

MOUNT=""
cleanup() {
  # Leaving a volume mounted would make the next run fail on a stale mount
  # point rather than on anything real.
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok  %s\n' "$*"; }

# build/ is gitignored, so a fresh clone does not have it and the log redirect
# below would fail before xcodebuild ever ran.
mkdir -p macos/build

step "Building $VERSION (build $BUILD_NUMBER)"
# ARCHS is not optional: a plain Release build is arm64-only and will not launch
# on an Intel Mac at all.
#
# CODE_SIGN_IDENTITY="-" is ad-hoc signing, which needs no certificate, so this
# works on a machine with an empty keychain (a CI runner). The project's own
# CODE_SIGN_STYLE is Automatic, which would fail there for want of a team.
#
# The version is injected rather than read from project.yml, so that file's
# literal never participates in a release and cannot drift from package.json.
xcodebuild \
  -project macos/RapidLog.xcodeproj \
  -scheme RapidLog \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=YES \
  CODE_SIGNING_ALLOWED=YES \
  DEVELOPMENT_TEAM="" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  build \
  > "macos/build/xcodebuild.log" 2>&1 \
  || { tail -40 "macos/build/xcodebuild.log" >&2; fail "xcodebuild failed; full log at macos/build/xcodebuild.log"; }
ok "built"

step "Checking the build"
GOT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[ "$GOT" = "$VERSION" ] || fail "app reports $GOT, expected $VERSION"
ok "reports $GOT"

ARCHS_OUT="$(lipo -archs "$APP/Contents/MacOS/RapidLog")"
case "$ARCHS_OUT" in
  *arm64*x86_64*|*x86_64*arm64*) ok "universal ($ARCHS_OUT)" ;;
  *) fail "not universal: lipo reports '$ARCHS_OUT'" ;;
esac

codesign --verify --deep --strict "$APP" || fail "signature does not verify"
ok "signature verifies"

# The shell is meant to load the deployed site, not carry a copy of it. A stray
# bundle here would mean users running frozen assets forever.
if find "$APP" \( -name '*.html' -o -name '*.js' -o -name '*.css' \) | grep -q .; then
  fail "the app bundles web assets; it should load them over the network"
fi
ok "no bundled web assets"

step "Packaging"
rm -rf "$OUT" "$STAGE"
mkdir -p "$OUT" "$STAGE"

# The disk image is the only artifact. A zip left a bare app in Downloads with
# no hint where it belonged, so it is not built at all any more.
# ditto rather than cp -R, so the signature and xattrs survive the copy.
ditto "$APP" "$STAGE/RapidLog.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create \
  -volname "Rapid Log" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$OUT/RapidLog-macOS.dmg" >/dev/null
ok "dmg"

step "Checking the disk image as a user receives it"
MOUNT="$(hdiutil attach "$OUT/RapidLog-macOS.dmg" -nobrowse -readonly | grep -oE '/Volumes/.*$' | head -1)"
[ -n "$MOUNT" ] || fail "could not mount the disk image"
ok "mounts at $MOUNT"

# Without this symlink the window has nothing to drag the app onto, which is the
# only reason the disk image exists at all.
[ "$(readlink "$MOUNT/Applications")" = "/Applications" ] \
  || fail "no working Applications symlink in the disk image"
ok "Applications symlink"

DMG_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MOUNT/RapidLog.app/Contents/Info.plist")"
[ "$DMG_VERSION" = "$VERSION" ] || fail "disk image contains $DMG_VERSION, expected $VERSION"
ok "contains $DMG_VERSION"

codesign --verify --deep --strict "$MOUNT/RapidLog.app" || fail "signature did not survive the disk image"
ok "signature survived the disk image"

step "Gatekeeper (recorded, not enforced)"
# Expected to be rejected: the app is ad-hoc signed, so recipients still have to
# clear the quarantine flag by hand. Fixing that needs a Developer ID
# certificate and notarization, not a change here.
spctl -a -t exec -vv "$MOUNT/RapidLog.app" 2>&1 | sed 's/^/   /' || true

printf '\n== Done. %s at %s\n' "$VERSION" "$OUT"
ls -lh "$OUT" | tail -n +2 | sed 's/^/   /'
