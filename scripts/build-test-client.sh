#!/usr/bin/env bash
# Build the real, UNMODIFIED easytier-core used by the conformance suite from
# the pinned upstream commit and place it in docker/easytier-core/.
#
# The upstream tag v2.6.4 does NOT point at the pinned commit (tag 8428a89,
# 2026-05-12; pin 81487c36, 2026-08-24), so the conformance client is built from
# source. Only the test client is built from Rust; nothing is vendored here.
#
# Usage: scripts/build-test-client.sh
# Env:
#   EASYTIER_TEST_REF   override the ref to build (default: proto/easytier/UPSTREAM_REF commit)
#   EASYTIER_REF_REPO   existing checkout to build from (default: <scratch>/easytier-ref)
#   EASYTIER_SCRATCH    scratch directory (default: /tmp/easyplane-easytier-ref)
#   EASYTIER_CARGO_TARGET_DIR  cargo target dir to reuse (default: <scratch>/target)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REF_FILE="$ROOT_DIR/proto/easytier/UPSTREAM_REF"
GIT_URL="${EASYTIER_GIT_URL:-https://github.com/EasyTier/EasyTier.git}"
SCRATCH_DIR="${EASYTIER_SCRATCH:-/tmp/easyplane-easytier-ref}"
OUT_DIR="$ROOT_DIR/docker/easytier-core"

REF="${EASYTIER_TEST_REF:-$(sed -n 's/^commit=//p' "$UPSTREAM_REF_FILE")}"
if [[ -z "$REF" ]]; then
  echo "error: cannot determine upstream ref; pass EASYTIER_TEST_REF" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is required to build the conformance client" >&2
  exit 1
fi

REPO="${EASYTIER_REF_REPO:-$SCRATCH_DIR/easytier-ref}"
if [[ ! -d "$REPO/.git" ]]; then
  echo "cloning $GIT_URL into $REPO"
  mkdir -p "$(dirname "$REPO")"
  git clone "$GIT_URL" "$REPO"
fi

if ! git -C "$REPO" cat-file -e "$REF^{commit}" 2>/dev/null; then
  echo "fetching $REF in $REPO"
  git -C "$REPO" fetch origin "$REF" || git -C "$REPO" fetch origin
fi

echo "checking out $REF (read-only build; upstream sources are not modified)"
git -C "$REPO" checkout --quiet --detach "$REF"
if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
  echo "error: $REPO has local modifications; refusing to build from a dirty tree" >&2
  exit 1
fi
COMMIT="$(git -C "$REPO" rev-parse HEAD)"
echo "building easytier-core at $COMMIT"

# The upstream checkout pins mold via .cargo/config.toml; fall back to a linker
# that exists on this machine without touching the checkout.
if command -v mold >/dev/null 2>&1; then
  LINKER_FLAG="-C link-arg=-fuse-ld=mold"
elif command -v ld.lld >/dev/null 2>&1; then
  LINKER_FLAG="-C link-arg=-fuse-ld=lld"
else
  LINKER_FLAG="-C link-arg=-fuse-ld=bfd"
fi
command -v protoc >/dev/null || { echo "error: protoc is required to build easytier-core (apt install protobuf-compiler)" >&2; exit 1; }

CARGO_TARGET_DIR="${EASYTIER_CARGO_TARGET_DIR:-$SCRATCH_DIR/target}" \
  RUSTFLAGS="$LINKER_FLAG" \
  cargo build --release --manifest-path "$REPO/Cargo.toml" -p easytier --bin easytier-core

BIN="${EASYTIER_CARGO_TARGET_DIR:-$SCRATCH_DIR/target}/release/easytier-core"
if [[ ! -x "$BIN" ]]; then
  echo "error: build did not produce $BIN" >&2
  exit 1
fi

VERSION="$("$BIN" --version)"
SHORT="${COMMIT:0:8}"
if [[ "$VERSION" != *"$SHORT"* ]]; then
  echo "warning: '$VERSION' does not mention commit $SHORT" >&2
fi

mkdir -p "$OUT_DIR"
cp "$BIN" "$OUT_DIR/easytier-core"
echo "installed docker/easytier-core/easytier-core ($VERSION)"
echo "ref=$REF" >"$OUT_DIR/BUILD_INFO"
echo "commit=$COMMIT" >>"$OUT_DIR/BUILD_INFO"
echo "version=$VERSION" >>"$OUT_DIR/BUILD_INFO"
echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$OUT_DIR/BUILD_INFO"
