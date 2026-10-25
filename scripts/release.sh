#!/usr/bin/env bash
# Builds WikiTree for every platform into releases/ — run on Linux x64.
#   releases/WikiTree-<v>-Linux-x64.AppImage
#   releases/WikiTree-<v>-Windows-x64.exe          (portable, no install)
#   releases/WikiTree-<v>-macOS-AppleSilicon.zip   (M1/M2/M3/M4 Macs)
#   releases/WikiTree-<v>-macOS-Intel.zip
# macOS apps are ad-hoc signed with rcodesign (Apple Silicon refuses to run unsigned apps);
# they are not notarized, so macOS asks the user to confirm the first launch.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT=releases
TOOLS=node_modules/.cache/wikitree-tools
RCODESIGN_VERSION=0.29.0
RCODESIGN="$TOOLS/rcodesign"
export NODE_ENV=production

rm -rf dist "$OUT"
mkdir -p "$OUT" "$TOOLS"

if [ ! -x "$RCODESIGN" ]; then
  echo "Fetching rcodesign $RCODESIGN_VERSION"
  name="apple-codesign-$RCODESIGN_VERSION-x86_64-unknown-linux-musl"
  url="https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F$RCODESIGN_VERSION/$name.tar.gz"
  curl -sfL "$url" -o "$TOOLS/$name.tar.gz"
  curl -sfL "$url.sha256" -o "$TOOLS/$name.sha256"
  echo "$(cut -c1-64 "$TOOLS/$name.sha256")  $TOOLS/$name.tar.gz" | sha256sum -c --quiet -
  tar xzf "$TOOLS/$name.tar.gz" -C "$TOOLS"
  mv "$TOOLS/$name/rcodesign" "$RCODESIGN"
  rm -rf "$TOOLS/$name" "$TOOLS/$name.tar.gz" "$TOOLS/$name.sha256"
fi

npx electron-builder --linux AppImage --publish never
npx electron-builder --win portable --publish never
npx electron-builder --mac dir --arm64 --x64 --publish never

cp "dist/WikiTree-$VERSION-linux-x86_64.AppImage" "$OUT/WikiTree-$VERSION-Linux-x64.AppImage"
chmod +x "$OUT/WikiTree-$VERSION-Linux-x64.AppImage"
cp "dist/WikiTree-$VERSION-windows-portable.exe" "$OUT/WikiTree-$VERSION-Windows-x64.exe"

for build in "mac-arm64:AppleSilicon" "mac:Intel"; do
  dir=${build%%:*}
  label=${build##*:}
  "$RCODESIGN" sign "dist/$dir/WikiTree.app" > /dev/null
  # -y keeps the framework symlinks (required for the signature to stay valid)
  (cd "dist/$dir" && zip -qry "../../$OUT/WikiTree-$VERSION-macOS-$label.zip" WikiTree.app)
done

(cd "$OUT" && sha256sum WikiTree-* > SHA256SUMS.txt)
rm -rf dist
ls -lh "$OUT"
