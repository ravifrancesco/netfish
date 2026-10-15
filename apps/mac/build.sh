#!/bin/bash
# Builds Netfish for Mac (apps/mac/build/Netfish.app), and with --dmg the disk image in release/.
# Needs Xcode's command-line tools, plus mpv and dylibbundler from Homebrew
# (brew install mpv dylibbundler): the app carries its own copy of libmpv and everything it
# needs, so it runs on any Mac with macOS 15 or later, without Homebrew.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('../../package.json').version")
APP=build/Netfish.app
BREW=$(brew --prefix)

rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/iconset.iconset
# Keep build output out of iCloud.
xattr -w 'com.apple.fileprovider.ignore#P' 1 build 2>/dev/null || true

swiftc -O -swift-version 5 -target arm64-apple-macos15.0 \
  -import-objc-header Netfish/Netfish-Bridging-Header.h \
  -I "$BREW/include" -L "$BREW/lib" -lmpv \
  -framework AppKit -framework WebKit -framework OpenGL \
  Netfish/*.swift ../ios/Netfish/Server.swift ../ios/Netfish/OfflineStore.swift ../ios/Netfish/LocalScheme.swift \
  ../ios/Netfish/Strings.swift \
  -o "$APP/Contents/MacOS/Netfish" 2> >(grep -v "deprecated\|^\s*|\|^\s*$\|note:\|^\s*[0-9]* |" >&2)

sed "s/__VERSION__/$VERSION/g" Netfish/Info.plist > "$APP/Contents/Info.plist"
# The setup and downloads pages are shared with the other apps.
cp ../common/setup.html ../common/offline.html "$APP/Contents/Resources/"
# English and Italian (shared with the iPhone app): macOS then shows its own menu items, alerts and
# the local network prompt in Italian too when that's your language.
cp -R ../ios/Netfish/en.lproj ../ios/Netfish/it.lproj "$APP/Contents/Resources/"

# App icon from the shared artwork.
for size in 16 32 128 256 512; do
  sips -z $size $size ../common/icon.png --out "build/iconset.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) ../common/icon.png --out "build/iconset.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns build/iconset.iconset -o "$APP/Contents/Resources/Netfish.icns"

# libmpv and the libraries it uses (FFmpeg and friends) go inside the app, pointed at from there.
mkdir -p "$APP/Contents/Frameworks"
xattr -cr "$APP"
dylibbundler -ns -cd -of -b -x "$APP/Contents/MacOS/Netfish" -d "$APP/Contents/Frameworks" -p @executable_path/../Frameworks/ >/dev/null
# (grep without -q: with pipefail, -q stopping early can make the whole check fail at random.)
if otool -L "$APP/Contents/MacOS/Netfish" "$APP"/Contents/Frameworks/*.dylib | grep /opt/homebrew >/dev/null; then
  echo "Some libraries still point at Homebrew" >&2
  exit 1
fi

# dylibbundler can add its search path to a library that already has it (it did to libmpv).
# macOS 15 refuses to load a library listing the same LC_RPATH twice, so the app wouldn't open there.
rpaths() { otool -l "$1" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }'; }
for bin in "$APP/Contents/MacOS/Netfish" "$APP"/Contents/Frameworks/*.dylib; do
  for path in $(rpaths "$bin" | sort | uniq -d); do
    for _ in 1 2 3 4; do
      rpaths "$bin" | grep -xF "$path" >/dev/null || break
      install_name_tool -delete_rpath "$path" "$bin" 2>/dev/null || true
    done
    install_name_tool -add_rpath "$path" "$bin"
  done
  if [ -n "$(rpaths "$bin" | sort | uniq -d)" ]; then
    echo "$(basename "$bin") still lists a search path twice (macOS 15 won't load it)" >&2
    exit 1
  fi
done

# iCloud and Finder tag files with metadata that code signing refuses.
xattr -cr "$APP"
for lib in "$APP"/Contents/Frameworks/*.dylib; do codesign --force --sign - "$lib"; done
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
  # What the app downloads to update itself (Settings → Update): no disk image to mount.
  rm -f "../../release/Netfish-$VERSION-mac.zip"
  ditto -c -k --keepParent "$APP" "../../release/Netfish-$VERSION-mac.zip"
  echo "Built release/Netfish-$VERSION-mac.zip"
fi
