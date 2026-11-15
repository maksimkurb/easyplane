#!/usr/bin/env bash
# Compute the next release version from the latest vX.Y.Z git tag.
#
#   scripts/next-version.sh --bump patch        # default
#   scripts/next-version.sh --bump minor
#   scripts/next-version.sh --bump major
#   scripts/next-version.sh --version 1.4.0     # explicit, wins over --bump
#   scripts/next-version.sh --tag v1.4.0        # validate an existing tag
#
# Prints the bare version (no leading "v"). Only plain X.Y.Z tags are
# considered; pre-release tags such as v1.2.3-rc1 are ignored when looking for
# the latest release. With no vX.Y.Z tag yet, the first release is 0.1.0.
#
# Used by .github/workflows/release.yml; run it from the repository root (or
# with `git -C` set up), because it reads the local tag list.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/next-version.sh [--bump patch|minor|major]
                               [--version X.Y.Z]
                               [--tag vX.Y.Z]
EOF
}

bump="patch"
explicit=""
tag=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      bump="$2"
      shift 2
      ;;
    --bump=*)
      bump="${1#*=}"
      shift
      ;;
    --version)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      explicit="$2"
      shift 2
      ;;
    --version=*)
      explicit="${1#*=}"
      shift
      ;;
    --tag)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      tag="$2"
      shift 2
      ;;
    --tag=*)
      tag="${1#*=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'

if [[ -n "$tag" ]]; then
  version="${tag#v}"
  if [[ ! "$version" =~ $semver_re ]]; then
    echo "error: --tag must look like vX.Y.Z, got '$tag'" >&2
    exit 2
  fi
  printf '%s\n' "$version"
  exit 0
fi

if [[ -n "$explicit" ]]; then
  version="${explicit#v}"
  if [[ ! "$version" =~ $semver_re ]]; then
    echo "error: --version must be X.Y.Z, got '$explicit'" >&2
    exit 2
  fi
  printf '%s\n' "$version"
  exit 0
fi

case "$bump" in
  patch | minor | major) ;;
  *)
    echo "error: --bump must be patch, minor or major, got '$bump'" >&2
    exit 2
    ;;
esac

# -v:refname sorts v1.10.0 above v1.9.0; the grep drops pre-releases and tags
# that are not releases at all. grep exits 1 when no tag matches, which is a
# normal first-release situation rather than an error.
latest="$(git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)"
if [[ -z "$latest" ]]; then
  printf '0.1.0\n'
  exit 0
fi

IFS=. read -r major minor patch <<<"${latest#v}"
case "$bump" in
  patch) patch=$((patch + 1)) ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
esac
printf '%s.%s.%s\n' "$major" "$minor" "$patch"
