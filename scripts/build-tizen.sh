#!/bin/bash
# Packages the Samsung TV app (apps/tizen) into release/Netfish-<version>-samsung.wgt.
# The package isn't signed: Samsung TVs only install apps signed for that TV, so it gets
# signed on the way in (Tizen Studio or TizenBrew, see docs/install/samsung-tv.md).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
WORK="${XDG_CACHE_HOME:-$HOME/Library/Caches}/netfish-build/tizen"
rm -rf "$WORK"
mkdir -p "$WORK" release
sed "s/__VERSION__/$VERSION/" apps/tizen/config.xml > "$WORK/config.xml"
cp apps/tizen/index.html "$WORK/"
# The launcher icon, from the shared artwork.
sips -z 512 512 apps/common/icon.png --out "$WORK/icon.png" >/dev/null 2>&1 || cp apps/common/icon.png "$WORK/icon.png"
rm -f "release/Netfish-$VERSION-samsung.wgt"
(cd "$WORK" && zip -q -X -r "$OLDPWD/release/Netfish-$VERSION-samsung.wgt" config.xml index.html icon.png)
echo "Built release/Netfish-$VERSION-samsung.wgt"
