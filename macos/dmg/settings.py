# dmgbuild configuration for the Rapid Log download.
#
# Driven by scripts/package-macos.sh; not meant to be run directly.
#
# dmgbuild is used rather than AppleScript because it writes the .DS_Store
# itself. The usual recipe for a styled disk image drives Finder over
# AppleScript to position the icons, which needs a logged-in GUI session and is
# unreliable on a CI runner. Nothing here talks to Finder, so the image built on
# a runner is identical to one built by hand.

import os.path

application = defines["app"]
appname = os.path.basename(application)

# Compressed, read-only. The same format the plain image used.
format = "UDZO"
size = None

files = [application]

# A symlink, not a Finder alias. Both give a working drag target; the symlink is
# a dozen bytes and survives being rebuilt on any machine, where an alias
# carries a resource fork and a recorded path.
symlinks = {"Applications": "/Applications"}

# The volume's icon in Finder and on the desktop, built from the app's own
# iconset so the mounted disk looks like the app rather than a blank drive.
icon = defines["volume_icon"]

# These coordinates are paired with the arrow drawn in make-background.py.
# Moving an icon here without redrawing the background leaves the arrow
# pointing at empty space.
icon_locations = {
    appname: (180, 170),
    "Applications": (480, 170),
}

background = defines["background"]

# Chrome off: a download window is a single instruction, and a sidebar or
# toolbar invites people to navigate rather than drag.
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

# Matches the background exactly, so the artwork is never cropped or letterboxed.
window_rect = ((200, 248), (660, 400))

default_view = "icon-view"
show_icon_preview = False

arrange_by = None
grid_offset = (0, 0)
grid_spacing = 100
label_pos = "bottom"
text_size = 16
icon_size = 128
