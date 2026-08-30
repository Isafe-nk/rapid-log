#!/usr/bin/env bash
#
# Generate every platform's app icon from assets/icon/icon.png.
#
#   assets/icon/make-icons.sh
#
# The icon used to exist as three unrelated copies — ten JPEGs for macOS, one
# PNG for iOS and a hand-written SVG for the web — with nothing keeping them in
# step. Editing icon.png and running this is now the whole process.
#
# The platforms want genuinely different things, which is the reason this is a
# script rather than a note in a README:
#
#   macOS  transparency, and a margin around the icon body. Finder and the Dock
#          draw the icon exactly as given, so the rounded shape has to be in the
#          file itself.
#   iOS    no alpha at all — the App Store rejects icons that have it — and
#          full-bleed artwork, because iOS applies its own rounded mask. The
#          margin macOS needs would show up as a shrunken icon here.
#
# The web favicon is hand-written SVG inlined in index.html and
# manifest.webmanifest. It is not generated: a data URI drawn from simple shapes
# costs no request and stays sharp at any size, which a downscaled PNG does not.
# If the artwork changes shape, edit that SVG to match.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

MASTER="assets/icon/icon.png"
MACOS_SET="macos/RapidLog/Assets.xcassets/AppIcon.appiconset"
IOS_ICON="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
VENV="macos/build/venv"

[ -f "$MASTER" ] || { echo "missing $MASTER" >&2; exit 1; }

# Pillow already lives in the venv the disk-image build creates; reuse it rather
# than requiring anything to be installed globally.
if [ ! -x "$VENV/bin/python" ]; then
  mkdir -p macos/build
  python3 -m venv "$VENV" >/dev/null
fi
"$VENV/bin/python" -c "import PIL" 2>/dev/null || \
  "$VENV/bin/pip" install --quiet --disable-pip-version-check pillow

"$VENV/bin/python" - "$MASTER" "$MACOS_SET" "$IOS_ICON" <<'PY'
import sys
from PIL import Image

master_path, macos_set, ios_icon = sys.argv[1], sys.argv[2], sys.argv[3]
master = Image.open(master_path).convert("RGBA")
if master.size != (1024, 1024):
    raise SystemExit(f"master must be 1024x1024, got {master.size}")
if master.getchannel("A").getextrema()[0] == 255:
    raise SystemExit("master has no transparency; the corners must be cut")

# --- macOS: keep the alpha and the margin, at the ten sizes iconutil wants.
for pt in (16, 32, 128, 256, 512):
    for suffix, px in ((f"icon_{pt}.png", pt), (f"icon_{pt}@2x.png", pt * 2)):
        master.resize((px, px), Image.LANCZOS).save(f"{macos_set}/{suffix}")
print(f"  macOS  10 files -> {macos_set}")

# --- iOS: no alpha, and full bleed. Cropping to the opaque body first stops the
# margin macOS needs from being baked in as dead space around a shrunken icon.
box = master.getchannel("A").getbbox()
body = master.crop(box)
flat = Image.new("RGB", body.size, body.convert("RGBA").getpixel((body.size[0] // 2, 4))[:3])
flat.paste(body, (0, 0), body)
flat.resize((1024, 1024), Image.LANCZOS).save(ios_icon)
print(f"  iOS    1 file (opaque, full bleed) -> {ios_icon}")
PY

echo
echo "The web favicon is hand-written SVG in index.html and"
echo "public/manifest.webmanifest — update it by hand if the artwork changed shape."
