#!/bin/sh
# Installs the built AppImage as a desktop app (app launcher entry + icon).
set -eu
cd "$(dirname "$0")/.."
APPIMAGE=$(ls dist/WikiTree-*.AppImage 2>/dev/null | head -n1)
[ -n "$APPIMAGE" ] || { echo "Build first: npm run dist"; exit 1; }

DEST="$HOME/.local/share/wikitree"
mkdir -p "$DEST" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
install -m 755 "$APPIMAGE" "$DEST/WikiTree.AppImage"
install -m 644 build/icon.png "$HOME/.local/share/icons/hicolor/512x512/apps/wikitree.png"

cat > "$HOME/.local/share/applications/wikitree.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=WikiTree
Comment=Trees of Wikipedia articles
Exec=$DEST/WikiTree.AppImage %U
Icon=wikitree
Terminal=false
Categories=Education;Reference;
StartupWMClass=wikitree
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Installed: $DEST/WikiTree.AppImage"
