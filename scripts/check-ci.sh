#!/usr/bin/env bash
# Refuse to release a commit whose CI gates are not green.
#
#   scripts/check-ci.sh <sha> [workflow-file]
#
# Looks for a successful run of the `ci` workflow on exactly that commit. Any
# green run counts (a later cancelled run does not undo it); failed, skipped
# and still-running runs do not. Needs `gh` and a token with actions:read in
# GH_TOKEN; the repository comes from GITHUB_REPOSITORY.
set -euo pipefail

sha="${1:-}"
workflow="${2:-ci.yml}"

if [[ -z "$sha" ]]; then
  echo "usage: scripts/check-ci.sh <sha> [workflow-file]" >&2
  exit 2
fi

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
runs="$(gh run list --repo "$repo" --workflow "$workflow" --commit "$sha" \
  --limit 50 --json headSha,status,conclusion,url)"

green="$(jq --arg sha "$sha" \
  '[.[] | select(.headSha == $sha and .status == "completed" and .conclusion == "success")] | length' \
  <<<"$runs")"

if [[ "$green" -gt 0 ]]; then
  echo "ok: $workflow has a successful run on $sha"
  exit 0
fi

echo "error: no successful '$workflow' run on $sha." >&2
echo "Wait for CI to finish (or dispatch the ci workflow), then retry." >&2
if [[ "$(jq 'length' <<<"$runs")" -gt 0 ]]; then
  echo "runs found for that commit:" >&2
  jq -r '.[] | "  \(.status)/\(.conclusion // "-")  \(.url)"' <<<"$runs" >&2
fi
exit 1
