#!/usr/bin/env bash
# Regenerate TypeScript protobuf bindings from proto/easytier/*.proto.
#
# Requires `protoc` (libprotoc >= 3.19) and the workspace dev dependencies
# (`bun install` installs `ts-proto`, whose protoc-gen-ts_proto plugin we use).
#
# Output: packages/proto/src/generated/<proto basename>.ts
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$ROOT_DIR/proto/easytier"
OUT_DIR="$ROOT_DIR/packages/proto/src/generated"
PLUGIN="$ROOT_DIR/node_modules/.bin/protoc-gen-ts_proto"

if ! command -v protoc >/dev/null 2>&1; then
  echo "error: protoc not found in PATH" >&2
  exit 1
fi
if [[ ! -x "$PLUGIN" ]]; then
  echo "error: $PLUGIN not found; run 'bun install' first" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# The generated code is consumed by NodeNext ESM TypeScript, hence importSuffix.
# forceLong=bigint keeps 64-bit RPC transaction ids exact.
mapfile -t PROTOS < <(find "$PROTO_DIR" -maxdepth 1 -name '*.proto' | sort)
if [[ ${#PROTOS[@]} -eq 0 ]]; then
  echo "error: no .proto files in $PROTO_DIR" >&2
  exit 1
fi

protoc \
  --proto_path="$PROTO_DIR" \
  --plugin="protoc-gen-ts_proto=$PLUGIN" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=esModuleInterop=true \
  --ts_proto_opt=forceLong=bigint \
  --ts_proto_opt=importSuffix=.js \
  --ts_proto_opt=outputEncodeMethods=true \
  --ts_proto_opt=outputJsonMethods=false \
  --ts_proto_opt=outputPartialMethods=false \
  --ts_proto_opt=stringEnums=false \
  --ts_proto_opt=useOptionals=messages \
  --ts_proto_opt=oneof=unions \
  --ts_proto_opt=outputServices=false \
  "${PROTOS[@]}"

echo "generated $(ls -1 "$OUT_DIR" | wc -l) files in packages/proto/src/generated"
