#!/bin/bash
# Builds Crypto Scanner.app and a .dmg from the Swift package.
# Runs on macOS (GitHub Actions or locally).
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
BUILD="${BUILD:-1}"
NAME="Crypto Scanner"
EXEC="CryptoScanner"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

swift build -c release --arch arm64
BIN_DIR="$(swift build -c release --arch arm64 --show-bin-path)"

rm -rf dist
APP="dist/stage/$NAME.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$BIN_DIR/$EXEC" "$APP/Contents/MacOS/$EXEC"
cp Resources/Info.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$APP/Contents/Info.plist"

# App icon
ICONSET="dist/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size Resources/AppIcon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double Resources/AppIcon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature (required to run on Apple Silicon)
codesign --force --deep --sign - "$APP"

ln -s /Applications "dist/stage/Applications"
hdiutil create -volname "$NAME" -srcfolder dist/stage -ov -format UDZO "dist/CryptoScanner.dmg"

echo "Built dist/CryptoScanner.dmg ($VERSION, build $BUILD)"
