#!/bin/bash
# Builds Netfish for Windows (64-bit) into release/Netfish-<version>-windows.exe, an installer.
# Runs on a Mac (or Linux). Needs:
#   - the .NET 8 SDK: https://dot.net, or `curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0`
#   - NSIS and 7-Zip: brew install makensis sevenzip
# The film player is libmpv from shinchiro's Windows builds (the ones mpv.io links to), plus the
# Khronos Vulkan loader it needs (graphics drivers usually bring it, but not on every PC). Both pinned below.
set -euo pipefail
cd "$(dirname "$0")"
CACHE="${XDG_CACHE_HOME:-$HOME/Library/Caches}/netfish-build"
# Built from a local copy: macOS won't let .NET clone files kept in iCloud Drive (where this
# project may live), and it keeps build clutter out of iCloud. The installer still lands in release/.
if [ "${NETFISH_STAGED:-}" != 1 ]; then
  REPO=$(cd ../.. && pwd)
  WORK="$CACHE/src"
  mkdir -p "$WORK/apps"
  rsync -a --delete --exclude build ./ "$WORK/apps/windows/"
  rsync -a --delete ../common/ "$WORK/apps/common/"
  cp ../../package.json "$WORK/package.json"
  NETFISH_STAGED=1 NETFISH_RELEASE="$REPO/release" exec "$WORK/apps/windows/build.sh" "$@"
fi
RELEASE="${NETFISH_RELEASE:-../../release}"
VERSION=$(node -p "require('../../package.json').version")
MPV_BUILD=20261012
MPV_FILE=mpv-dev-x86_64-20261012-git-88eb9f2e73.7z
MPV_SHA256=a739eef92a907dfb8ea997564a3fa565b2a4f376f20a25755e7645d0c70fe5e6
VULKAN=1.4.363.0
VULKAN_FILE=VulkanRT-X64-$VULKAN-Components.zip
VULKAN_SHA256=a25a927aa8b9f0371048f1861cf88ac3b9bc9b1fb332c42d897c8ab32695769a
DOTNET=$(command -v dotnet || echo "$HOME/.dotnet/dotnet")
SEVENZIP=$(command -v 7zz || command -v 7z)
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

mkdir -p build
rm -rf build/publish build/mpv build/icon

# App icon from the shared artwork (PNG images inside a .ico).
mkdir -p build/icon
for size in 16 24 32 48 64 128 256; do
  sips -z $size $size ../common/icon.png --out "build/icon/$size.png" >/dev/null 2>&1 \
    || magick ../common/icon.png -resize ${size}x${size} "build/icon/$size.png"
done
python3 - build/icon build/Netfish.ico <<'EOF'
import struct, sys, os
folder, out = sys.argv[1], sys.argv[2]
sizes = [16, 24, 32, 48, 64, 128, 256]
images = [open(os.path.join(folder, f'{s}.png'), 'rb').read() for s in sizes]
offset = 6 + 16 * len(sizes)
header = struct.pack('<HHH', 0, 1, len(sizes))
entries = b''
for s, data in zip(sizes, images):
    entries += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(out, 'wb').write(header + entries + b''.join(images))
EOF

# libmpv and the Vulkan loader: downloaded once, and checked.
fetch() { # url file sha256
  if [ ! -f "$CACHE/$2" ]; then
    curl -fL --progress-bar -o "$CACHE/$2.part" "$1"
    mv "$CACHE/$2.part" "$CACHE/$2"
  fi
  echo "$3  $CACHE/$2" | shasum -a 256 -c - >/dev/null || { echo "$2 doesn't match its checksum" >&2; exit 1; }
}
mkdir -p "$CACHE"
fetch "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/$MPV_BUILD/$MPV_FILE" "$MPV_FILE" "$MPV_SHA256"
fetch "https://sdk.lunarg.com/sdk/download/$VULKAN/windows/$VULKAN_FILE" "$VULKAN_FILE" "$VULKAN_SHA256"
"$SEVENZIP" e -y -obuild/mpv "$CACHE/$MPV_FILE" libmpv-2.dll >/dev/null
"$SEVENZIP" e -y -obuild/mpv "$CACHE/$VULKAN_FILE" "VulkanRT-X64-$VULKAN-Components/x64/vulkan-1.dll" "VulkanRT-X64-$VULKAN-Components/VulkanRT-License.txt" >/dev/null

# The app (with its own copy of .NET, so nothing else needs installing).
"$DOTNET" publish Netfish.csproj -c Release -o build/publish -p:Version="$VERSION" --nologo -v quiet
rm -f build/publish/*.pdb build/publish/*.xml
cp build/mpv/libmpv-2.dll build/mpv/vulkan-1.dll build/publish/
mkdir -p build/publish/licenses
cp build/mpv/VulkanRT-License.txt build/publish/licenses/vulkan.txt
cp THIRD-PARTY.txt build/publish/licenses/
# The setup and downloads pages are shared with the other apps.
mkdir -p build/publish/pages
cp ../common/setup.html ../common/offline.html build/publish/pages/
echo "Built $(pwd)/build/publish/Netfish.exe"

# The installer.
mkdir -p "$RELEASE"
# (makensis crashes without a locale, which shells started by apps often lack.)
LC_ALL="${LC_ALL:-en_US.UTF-8}" makensis -V2 -DVERSION="$VERSION" -DOUTFILE="$RELEASE/Netfish-$VERSION-windows.exe" installer.nsi
echo "Built release/Netfish-$VERSION-windows.exe"
