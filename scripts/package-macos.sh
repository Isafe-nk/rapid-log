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

# .noindex, deliberately: Spotlight skips any directory whose name ends that way
# — it is why Xcode calls its own index directory Index.noindex. Without it every
# build registers a second RapidLog.app, and searching for the app offers the
# build product alongside the installed one. Launching the wrong copy is
# indistinguishable from a new build not working.
DERIVED="macos/build/DerivedData.noindex"
APP="$DERIVED/Build/Products/Release/RapidLog.app"
OUT="macos/build/artifacts"
VENV="macos/build/venv"
DMGDIR="macos/dmg"
APPICONS="macos/RapidLog/Assets.xcassets/AppIcon.appiconset"
VOLICON="macos/build/VolumeIcon.icns"
BACKGROUND="macos/build/background.tiff"

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
# Captured rather than piped into `grep -q`. Under `set -o pipefail` a grep that
# exits on its first match closes the pipe, the producer dies of SIGPIPE, and the
# pipeline reports failure — so a gate written that way reads a positive find as
# "nothing here" and passes. The more files there are, the more likely it is,
# which is precisely when this check matters.
BUNDLED_WEB="$(find "$APP" \( -name '*.html' -o -name '*.js' -o -name '*.css' \) 2>/dev/null || true)"
if [ -n "$BUNDLED_WEB" ]; then
  echo "$BUNDLED_WEB" | sed 's/^/   /' >&2
  fail "the app bundles web assets; it should load them over the network"
fi
ok "no bundled web assets"

step "Preparing the disk image assets"
rm -rf "$OUT"
mkdir -p "$OUT"

# dmgbuild lives in a venv under build/ rather than being installed globally, so
# a clone needs no setup step and a runner needs no extra install. It is not
# optional: without it the image would have no background, no window size and no
# icon positions, which is the whole point of shipping a disk image.
if [ ! -x "$VENV/bin/dmgbuild" ]; then
  echo "   .. creating the build venv and installing dmgbuild"
  python3 -m venv "$VENV" >/dev/null 2>&1 || fail "could not create a venv at $VENV"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check dmgbuild \
    || fail "could not install dmgbuild into $VENV"
fi
ok "dmgbuild ready"

# The mounted volume shows the app's icon instead of a blank drive. Built from
# the same iconset the app uses, so it cannot drift from the app's own icon.
ICONSET="macos/build/RapidLog.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for pair in "16 16x16" "32 32x32" "128 128x128" "256 256x256" "512 512x512"; do
  set -- $pair
  cp "$APPICONS/icon_$1.png"    "$ICONSET/icon_$2.png"
  cp "$APPICONS/icon_$1@2x.png" "$ICONSET/icon_$2@2x.png"
done
iconutil -c icns "$ICONSET" -o "$VOLICON" || fail "could not build the volume icon"
ok "volume icon"

# One TIFF carrying both the 1x and 2x artwork, so the background stays sharp on
# a Retina display instead of being scaled up from the 1x image.
tiffutil -cathidpicheck "$DMGDIR/background.png" "$DMGDIR/background@2x.png" \
  -out "$BACKGROUND" >/dev/null 2>&1 || fail "could not build the background TIFF"
ok "background (1x + 2x)"

step "Packaging"
# dmgbuild writes the .DS_Store itself. The conventional recipe drives Finder
# over AppleScript to place the icons, which needs a GUI session and does not
# work on a runner; this produces the same layout headlessly.
"$VENV/bin/dmgbuild" \
  -s "$DMGDIR/settings.py" \
  -D app="$PWD/$APP" \
  -D background="$PWD/$BACKGROUND" \
  -D volume_icon="$PWD/$VOLICON" \
  "Rapid Log" \
  "$OUT/RapidLog-macOS.dmg" >/dev/null 2>&1 \
  || fail "dmgbuild failed"
ok "dmg"

step "Checking the disk image as a user receives it"
# Detach anything an interrupted earlier run left behind, or this mounts as
# "Rapid Log 1" and the checks read a stale volume.
for stale in /Volumes/Rapid\ Log*; do
  [ -d "$stale" ] && hdiutil detach "$stale" -quiet 2>/dev/null || true
done
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

# The window only shows the drag instruction if the background and the icon
# positions both survived into the image. Producing an unstyled disk image is a
# silent failure otherwise: it mounts, it works, and it looks like nothing was
# done. Read back what Finder will actually use.
# dmgbuild stores a single background file as .background.tiff at the volume
# root; the .background/ directory is what the AppleScript recipes produce.
# Accept either, so this does not break if the tool changes.
if [ -f "$MOUNT/.background.tiff" ]; then
  BG_AT=".background.tiff"
elif [ -f "$MOUNT/.background/background.tiff" ]; then
  BG_AT=".background/background.tiff"
else
  fail "the disk image has no background picture"
fi
ok "background present ($BG_AT)"

[ -f "$MOUNT/.VolumeIcon.icns" ] || fail "the disk image has no volume icon"
ok "volume icon present"

[ -f "$MOUNT/.DS_Store" ] || fail "the disk image has no .DS_Store, so the window is unstyled"
python3 - "$MOUNT/.DS_Store" <<'PYEOF' || fail "icon positions are not what settings.py asks for"
import re, struct, sys

want = {"RapidLog.app": (180, 170), "Applications": (480, 170)}
data = open(sys.argv[1], "rb").read()
found = {}

# Records are: name length (4 bytes BE), name (UTF-16BE), 4-byte code, 4-byte
# type, then the value. For Iloc the value is a blob holding x and y.
for m in re.finditer(b"Iloc", data):
    i = m.start()
    for nlen in range(1, 40):
        start = i - nlen * 2 - 4
        if start < 0:
            break
        if struct.unpack(">I", data[start:start + 4])[0] == nlen:
            try:
                name = data[start + 4:i].decode("utf-16-be")
            except Exception:
                break
            x, y = struct.unpack(">II", data[i + 12:i + 20])
            found[name] = (x, y)
            break

for name, xy in want.items():
    if found.get(name) != xy:
        print(f"      {name}: expected {xy}, found {found.get(name)}")
        sys.exit(1)
    print(f"      {name} at {xy}")
PYEOF
ok "icon positions"

step "Gatekeeper (recorded, not enforced)"
# Expected to be rejected: the app is ad-hoc signed, so recipients still have to
# clear the quarantine flag by hand. Fixing that needs a Developer ID
# certificate and notarization, not a change here.
spctl -a -t exec -vv "$MOUNT/RapidLog.app" 2>&1 | sed 's/^/   /' || true

printf '\n== Done. %s at %s\n' "$VERSION" "$OUT"
ls -lh "$OUT" | tail -n +2 | sed 's/^/   /'
