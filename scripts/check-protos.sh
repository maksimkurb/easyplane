#!/usr/bin/env bash
# CI guard: fail if proto/easytier/* disagrees with the pinned upstream ref, or
# if the committed TypeScript bindings are stale.
#
# Uses the same ref as the last scripts/sync-protos.sh run (proto/easytier/UPSTREAM_REF).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$ROOT_DIR/proto/easytier"
REF_FILE="$PROTO_DIR/UPSTREAM_REF"

if [[ ! -f "$REF_FILE" ]]; then
  echo "error: $REF_FILE is missing; run scripts/sync-protos.sh <ref>" >&2
  exit 1
fi

REF="$(sed -n 's/^ref=//p' "$REF_FILE")"
COMMIT="$(sed -n 's/^commit=//p' "$REF_FILE")"
if [[ -z "$REF" || -z "$COMMIT" ]]; then
  echo "error: malformed $REF_FILE" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "checking protos against $REF ($COMMIT)"

# Redirect sync output so the check is quiet on success.
if ! "$ROOT_DIR/scripts/sync-protos.sh" "$REF" >"$TMP_DIR/sync.log" 2>&1; then
  cat "$TMP_DIR/sync.log" >&2
  echo "error: sync-protos.sh failed" >&2
  exit 1
fi

# google/protobuf/* is generated from protoc's bundled well-known types, whose
# comments vary by protoc version, so it is excluded from the drift comparison.
DRIFT="$(git -C "$ROOT_DIR" status --porcelain -- proto/easytier packages/proto/src/generated ':(exclude)packages/proto/src/generated/google')"
if [[ -n "$DRIFT" ]]; then
  echo "error: proto definitions or generated bindings are out of date:" >&2
  echo "$DRIFT" >&2
  git -C "$ROOT_DIR" diff --stat -- proto/easytier packages/proto/src/generated ':(exclude)packages/proto/src/generated/google' >&2
  echo "run scripts/sync-protos.sh $REF and commit the result" >&2
  exit 1
fi

echo "protos are in sync with $COMMIT"
