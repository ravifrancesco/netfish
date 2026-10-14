#!/bin/bash
# Builds Netfish for Mac (apps/mac/build/Netfish.app), and with --dmg the disk image in release/.
# Needs Xcode's command-line tools and mpv from Homebrew (brew install mpv), whose
# libmpv the app uses to play films.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('../../package.json').version")
APP=build/Netfish.app
BREW=$(brew --prefix)

rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/iconset.iconset
# Keep build output out of iCloud.
xattr -w 'com.apple.fileprovider.ignore#P' 1 build 2>/dev/null || true

swiftc -O -swift-version 5 -target arm64-apple-macos13.0 \
  -import-objc-header Netfish/Netfish-Bridging-Header.h \
  -I "$BREW/include" -L "$BREW/lib" -lmpv \
  -framework AppKit -framework WebKit -framework OpenGL \
  Netfish/*.swift ../ios/Netfish/Server.swift ../ios/Netfish/OfflineStore.swift ../ios/Netfish/LocalScheme.swift \
  -o "$APP/Contents/MacOS/Netfish" 2> >(grep -v "deprecated\|^\s*|\|^\s*$\|note:\|^\s*[0-9]* |" >&2)

sed "s/__VERSION__/$VERSION/g" Netfish/Info.plist > "$APP/Contents/Info.plist"
# The setup and downloads pages are shared with the other apps.
cp ../common/setup.html ../common/offline.html "$APP/Contents/Resources/"

# App icon from the shared artwork.
for size in 16 32 128 256 512; do
  sips -z $size $size ../common/icon.png --out "build/iconset.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) ../common/icon.png --out "build/iconset.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns build/iconset.iconset -o "$APP/Contents/Resources/Netfish.icns"

# iCloud and Finder tag files with metadata that code signing refuses.
xattr -cr "$APP"
codesign --force --sign - "$APP" >/dev/null
echo "Built $APP"

# --selftest: a copy with its own identity (app.netfish.mac.selftest), so automated tests never
# touch the real app's sign-in, settings or downloads.
if [ "${1:-}" = "--selftest" ]; then
  TEST=build/NetfishSelfTest.app
  rm -rf "$TEST"
  cp -R "$APP" "$TEST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier app.netfish.mac.selftest" -c "Set :CFBundleName Netfish Self-Test" "$TEST/Contents/Info.plist"
  codesign --force --sign - "$TEST" >/dev/null
  echo "Built $TEST"
fi

if [ "${1:-}" = "--dmg" ]; then
  mkdir -p build/dmg ../../release
  cp -R "$APP" build/dmg/
  ln -s /Applications build/dmg/Applications
  rm -f "../../release/Netfish-$VERSION-mac.dmg"
  hdiutil create -volname Netfish -srcfolder build/dmg -ov -format UDZO "../../release/Netfish-$VERSION-mac.dmg" >/dev/null
  echo "Built release/Netfish-$VERSION-mac.dmg"
fi
