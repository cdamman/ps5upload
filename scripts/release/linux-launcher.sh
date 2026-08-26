#!/bin/sh
# PS5Upload Linux launcher (fresh-install safe + white-screen safe).
#
# Why this wrapper exists:
#
# 1. FUSE (Ubuntu 24.04+, fresh arm64 images, most modern desktops):
#    Tauri's type-2 AppImage uses FUSE to self-mount at startup, but
#    those distros ship without libfuse2 by default — so a brand-new
#    user double-clicking PS5Upload.AppImage gets "AppImage requires
#    FUSE to run" and nothing happens. `APPIMAGE_EXTRACT_AND_RUN=1`
#    tells the AppImage runtime to self-extract to /tmp and exec from
#    there instead — no kernel module, no apt install, no daemon.
#
# 2. WebKitGTK white screen (Bazzite, SteamOS, NVIDIA, some Mesa
#    stacks): the app window comes up blank/white because WebKitGTK's
#    accelerated compositing + DMABUF renderer don't render on those
#    GPU/compositor combos. The folder/.deb build can hit this too,
#    but it's most common with the AppImage on gaming distros.
#    Disabling the DMABUF renderer makes WebKit fall back to a path
#    that renders correctly on those stacks, at no perceptible cost.
#    If the window is STILL blank, also disable accelerated
#    compositing: `WEBKIT_DISABLE_COMPOSITING_MODE=1 ./PS5Upload.sh`.
#    That one is not the default because it forces software rendering
#    of the whole page and makes scrolling sluggish for everyone.
#
#    If a white screen persists even with these set, escalate (see
#    FAQ -> "white screen on Linux"): force X11 with `GDK_BACKEND=x11`,
#    then software rendering with `LIBGL_ALWAYS_SOFTWARE=1`.
#
# Shipped in the Linux release .zip alongside PS5Upload.AppImage; the
# release workflow only copies this file into the zip (it doesn't
# generate it inline) so its contents go through the normal repo
# review / lint pipeline. Prefer launching via this wrapper rather than
# the bare PS5Upload.AppImage so both rescues apply.
set -e
here="$(cd "$(dirname "$0")" && pwd)"

# Overridable WebKitGTK rendering workaround — see note (2) above.
#
# Only DMABUF is disabled by default. Disabling accelerated COMPOSITING as
# well used to be the default and made scrolling sluggish on every Linux
# install, because it drops the page to software rendering — which this app
# feels acutely, its main screens being long scrolling lists. It stays
# available for anyone who needs it:
#   WEBKIT_DISABLE_COMPOSITING_MODE=1 ./PS5Upload.sh
: "${WEBKIT_DISABLE_DMABUF_RENDERER:=1}"
export WEBKIT_DISABLE_DMABUF_RENDERER

exec env APPIMAGE_EXTRACT_AND_RUN=1 "$here/PS5Upload.AppImage" "$@"
