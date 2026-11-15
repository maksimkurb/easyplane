#!/usr/bin/env bash
# Docker tags for the published EasyPlane image.
#
#   scripts/docker-tags.sh edge            # main: edge, sha-<short>
#   scripts/docker-tags.sh release 1.2.3   # 1.2.3, 1.2, 1, latest, sha-<short>
#
# The output is docker/metadata-action's `tags` syntax. `--github-output` wraps
# it in the GITHUB_OUTPUT heredoc format so the workflows can simply run:
#
#   scripts/docker-tags.sh --github-output edge >> "$GITHUB_OUTPUT"
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/docker-tags.sh [--github-output] edge|release [X.Y.Z]
EOF
}

github_output=0
if [[ "${1:-}" == "--github-output" ]]; then
  github_output=1
  shift
fi

kind="${1:-}"
version="${2:-}"

tags=("type=sha,format=short,prefix=sha-")
case "$kind" in
  edge)
    tags+=("type=raw,value=edge")
    ;;
  release)
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "error: release needs a plain X.Y.Z version, got '${version}'" >&2
      exit 2
    fi
    IFS=. read -r major minor _patch <<<"$version"
    tags+=(
      "type=raw,value=${version}"
      "type=raw,value=${major}.${minor}"
      "type=raw,value=${major}"
      "type=raw,value=latest"
    )
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ "$github_output" == "1" ]]; then
  echo "tags<<EOF"
  printf '%s\n' "${tags[@]}"
  echo "EOF"
else
  printf '%s\n' "${tags[@]}"
fi
