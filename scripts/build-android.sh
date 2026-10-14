#!/bin/bash
# Builds the Android app (phones, tablets, Fire TV, Android TV) into release/Netfish-<version>-android.apk.
# Needs a JDK (17+) and the Android SDK (sdk.dir in apps/android/local.properties).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
VERSION=$(node -p "require('./package.json').version")
if [ -z "${JAVA_HOME:-}" ] && [ -d "$(brew --prefix 2>/dev/null)/opt/openjdk@21" ]; then
  export JAVA_HOME="$(brew --prefix)/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
fi
# Built from a local copy: macOS won't let Gradle clone files kept in iCloud Drive (where this
# project may live), and it keeps build clutter out of iCloud.
WORK="${XDG_CACHE_HOME:-$HOME/Library/Caches}/netfish-build/src"
mkdir -p "$WORK/apps"
rsync -a --delete --exclude build --exclude .gradle apps/android/ "$WORK/apps/android/"
rsync -a --delete apps/common/ "$WORK/apps/common/"
(cd "$WORK/apps/android" && ./gradlew assembleRelease --console=plain -q)
mkdir -p release
cp "$WORK/apps/android/app/build/outputs/apk/release/app-release.apk" "release/Netfish-$VERSION-android.apk"
echo "Built release/Netfish-$VERSION-android.apk"
