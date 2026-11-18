#!/usr/bin/env bash
# Creates the GitHub release of a tag from the assets in dist/release, as a
# prerelease for a version such as 1.0.0-rc.1. With --dry-run, it prints
# the command instead of running it. gh takes the repository from GH_REPO
# or from the origin remote, and the token from GH_TOKEN.
set -euo pipefail

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
  shift
fi
tag="${1:?usage: create-github-release.sh [--dry-run] TAG}"

command=(
  gh release create "${tag}"
  --verify-tag
  --title "wandelzeug ${tag}"
  --notes-file dist/release/notes.md
)
if [[ "${tag}" == *-* ]]; then
  command+=(--prerelease)
fi
command+=(dist/release/wlz.js dist/release/SHA256SUMS)

if "${dry_run}"; then
  printf 'would run:'
  printf ' %q' "${command[@]}"
  printf '\n'
else
  "${command[@]}"
fi
