#!/usr/bin/env bash
set -euo pipefail

# Build the Tailscale tsconnect WASM artifact from the vendored submodule.
# Output: packages/tailscale-wasm/src/tailscale.wasm

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
TSCONNECT="$REPO_ROOT/vendor/tailscale/cmd/tsconnect"
OUT="$PKG_DIR/src/tailscale.wasm"

if [ ! -d "$TSCONNECT" ]; then
	echo "vendor/tailscale submodule missing — run: git submodule update --init --recursive" >&2
	exit 1
fi

cd "$TSCONNECT"
GOOS=js GOARCH=wasm go build -o "$OUT" ./wasm
echo "wrote $OUT"
