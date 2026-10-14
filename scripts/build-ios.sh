#!/bin/bash
# Builds the iPhone & iPad app into release/Netfish-<version>-ios.ipa, unsigned: AltStore and
# SideStore sign it with the person's own Apple ID when they install it. (Installing straight
# from Xcode instead is in docs/install/iphone-ipad.md.) Needs Xcode.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
WORK="${XDG_CACHE_HOME:-$HOME/Library/Caches}/netfish-build/ios"
rm -rf "$WORK/Payload"
xcodebuild -project apps/ios/Netfish.xcodeproj -scheme Netfish -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath "$WORK/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" MARKETING_VERSION="$VERSION" \
  build -quiet 2>&1 | grep -E "error:" | grep -v "exit code 0" || true
mkdir -p "$WORK/Payload" release
cp -R "$WORK/DerivedData/Build/Products/Release-iphoneos/Netfish.app" "$WORK/Payload/"
rm -f "release/Netfish-$VERSION-ios.ipa"
(cd "$WORK" && zip -q -r -y "$OLDPWD/release/Netfish-$VERSION-ios.ipa" Payload)
echo "Built release/Netfish-$VERSION-ios.ipa"
