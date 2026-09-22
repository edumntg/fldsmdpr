#!/bin/sh
# Install or update FLDSMDPR on macOS (one line, Terminal):
#   curl -fsSL https://raw.githubusercontent.com/edumntg/fldsmdpr/main/install.sh | sh
set -eu

echo "→ Finding latest release…"
url=$(curl -fsSL https://api.github.com/repos/edumntg/fldsmdpr/releases/latest \
  | grep -o 'https://[^"]*\.dmg' | head -1)
[ -n "$url" ] || { echo "✗ No .dmg found in the latest release"; exit 1; }

tmp=$(mktemp -d)
echo "→ Downloading $(basename "$url")…"
curl -fSL --progress-bar "$url" -o "$tmp/FLDSMDPR.dmg"

echo "→ Installing to /Applications…"
pkill -x FLDSMDPR 2>/dev/null || true
mnt=$(hdiutil attach -nobrowse -readonly "$tmp/FLDSMDPR.dmg" | grep -o '/Volumes/.*')
rm -rf /Applications/FLDSMDPR.app
ditto "$mnt/FLDSMDPR.app" /Applications/FLDSMDPR.app
hdiutil detach "$mnt" -quiet
rm -rf "$tmp"

# The build is not Apple-notarized; drop the quarantine flag so Gatekeeper
# doesn't block a tool you chose to install. Future updates happen in-app.
xattr -dr com.apple.quarantine /Applications/FLDSMDPR.app 2>/dev/null || true

echo "✓ FLDSMDPR installed. Opening…"
open -a FLDSMDPR
