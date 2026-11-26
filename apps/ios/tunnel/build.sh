#!/bin/bash
# Xcode runs this before compiling: netfish-tunnel (apps/common/tunnel, Go) as a library for the
# iPhone or the simulator being built, into the build folder as libnetfishtunnel.a. Needs Go
# (brew install go).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../../common/tunnel"
SDK="${PLATFORM_NAME:-iphoneos}"
TARGET="arm64-apple-ios${IPHONEOS_DEPLOYMENT_TARGET:-16.0}"
[ "$SDK" = iphonesimulator ] && TARGET="$TARGET-simulator"
OUT="${BUILT_PRODUCTS_DIR:-$PWD/build}"
mkdir -p "$OUT"
SYSROOT=$(xcrun --sdk "$SDK" --show-sdk-path)
CC="$(xcrun --sdk "$SDK" -f clang) -target $TARGET -isysroot $SYSROOT" \
CGO_ENABLED=1 GOOS=ios GOARCH=arm64 \
  go build -buildmode=c-archive -trimpath -ldflags "-s -w" -o "$OUT/libnetfishtunnel.a" .
rm -f "$OUT/libnetfishtunnel.h"
