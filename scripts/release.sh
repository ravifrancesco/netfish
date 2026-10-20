#!/bin/bash
# Publishes the version in package.json as a GitHub release: builds every app, tags vX.Y.Z and
# uploads the files under fixed names, so links like
#   https://github.com/<owner>/netfish/releases/latest/download/Netfish-android.apk
# always give the newest one. Pushing the tag also makes GitHub build the server image
# (ghcr.io/<owner>/netfish:<version> and :latest, see .github/workflows/docker.yml).
# Needs a Mac (for the Mac app), the GitHub CLI signed in (gh auth login), and everything committed.
#   SKIP_BUILD=1 scripts/release.sh   publishes the files already in release/
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
OWNER=$(gh repo view --json owner -q .owner.login)

[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first." >&2; exit 1; }
# The downloads page's player is built from the web app and committed, so the apps build without Node.
npm run build:player >/dev/null
git diff --quiet -- apps/common/player.js || { echo "apps/common/player.js was out of date: commit the rebuilt copy." >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "$TAG already exists: raise the version in package.json first." >&2
  exit 1
fi
grep -q "netfishVersion = '$VERSION'" apps/android/app/build.gradle || { echo "Set netfishVersion to '$VERSION' in apps/android/app/build.gradle." >&2; exit 1; }
# The release page opens with this version's entry in CHANGELOG.md ("## X.Y.Z (date)" up to the next "## ").
WHATS_NEW=$(awk -v v="$VERSION" 'index($0, "## " v " ") == 1 || $0 == "## " v { on = 1; next } on && /^## / { exit } on { print }' CHANGELOG.md)
[ -n "$(echo "$WHATS_NEW" | tr -d '[:space:]')" ] || { echo "Write the entry for $VERSION in CHANGELOG.md first (\"## $VERSION ($(date +%F))\")." >&2; exit 1; }
# The app versions Netfish asks devices to update to can't be newer than this release.
node -e '
const [file, version] = process.argv.slice(1);
const n = (v) => v.split(".").reduce((sum, part) => sum * 1000 + Number(part), 0);
const asked = [...require("fs").readFileSync(file, "utf8").matchAll(/(?:recommended|needed): .(\d+\.\d+\.\d+)./g)].map((m) => m[1]);
const ahead = asked.filter((v) => n(v) > n(version));
if (ahead.length) {
  console.error(`web/src/lib/appVersions.ts asks for ${[...new Set(ahead)].join(", ")}, newer than ${version}.`);
  process.exit(1);
}
' web/src/lib/appVersions.ts "$VERSION"

if [ "${SKIP_BUILD:-}" != 1 ]; then
  npm run pack:pi
  npm run build:mac
  npm run build:android
  npm run build:windows
  npm run build:samsung
  npm run build:ios
fi

STAGE=$(mktemp -d)
for kind in server.tar.gz mac.dmg mac.zip windows.exe android.apk samsung.wgt ios.ipa; do
  cp "release/Netfish-$VERSION-$kind" "$STAGE/Netfish-$kind"
done
{
  echo "## What's new"
  echo
  echo "$WHATS_NEW"
  echo
  echo "Every version: [CHANGELOG.md](https://github.com/$OWNER/netfish/blob/main/CHANGELOG.md)"
  echo
} > "$STAGE/notes.md"
cat >> "$STAGE/notes.md" <<NOTES
## Install

| For | Get |
|---|---|
| **Server** (Raspberry Pi or any Docker host) | Portainer pulls \`ghcr.io/$OWNER/netfish:latest\` (or \`:$VERSION\`), see the README. Or upload **Netfish-server.tar.gz** in Portainer to build the image on the Pi itself. |
| **Mac** (Apple silicon, macOS 15 or later) | **Netfish-mac.dmg** (everything included) |
| **Windows 10/11** (64-bit) | **Netfish-windows.exe** (installs for your account, no admin rights) |
| **Android**: phones, tablets, Fire TV, Android TV | **Netfish-android.apk**. On a Fire TV, the Downloader app takes this link: \`https://github.com/$OWNER/netfish/releases/latest/download/Netfish-android.apk\` |
| **Samsung TV** (2022 or newer) | **Netfish-samsung.wgt**, installed with TizenBrew or Tizen Studio: [guide](https://github.com/$OWNER/netfish/blob/main/docs/install/samsung-tv.md) |
| **iPhone & iPad** | **Netfish-ios.ipa** for AltStore/SideStore, or install with Xcode: [guide](https://github.com/$OWNER/netfish/blob/main/docs/install/iphone-ipad.md) |

Step-by-step guides for every device: [docs/install](https://github.com/$OWNER/netfish/tree/main/docs/install) (in Italian: [docs/install/it](https://github.com/$OWNER/netfish/tree/main/docs/install/it)).

The apps aren't signed by Apple or Microsoft yet: on a Mac, right-click → **Open** the first time; on Windows, **More info → Run anyway**.

NOTES

git tag -a "$TAG" -m "Netfish $VERSION"
git push origin "$TAG"
gh release create "$TAG" --title "Netfish $VERSION" --notes-file "$STAGE/notes.md" --generate-notes \
  "$STAGE/Netfish-server.tar.gz" "$STAGE/Netfish-mac.dmg" "$STAGE/Netfish-mac.zip" "$STAGE/Netfish-windows.exe" "$STAGE/Netfish-android.apk" \
  "$STAGE/Netfish-samsung.wgt" "$STAGE/Netfish-ios.ipa"
rm -rf "$STAGE"
# Every version's files are on GitHub: only this one's stay here, so old copies don't pile
# up (or show up in Spotlight next to the installed app).
find release -maxdepth 1 -name 'Netfish-*' ! -name "Netfish-$VERSION-*" -delete
echo "Published https://github.com/$OWNER/netfish/releases/tag/$TAG"
