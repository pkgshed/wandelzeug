#!/usr/bin/env bash
# Prepares the assets of the GitHub release of a tag in dist/release: the
# bundle, its checksum, and the release notes from the changelog. It stops
# when the bundle reports another version than the tag names. Run it after
# "just build", as the release-assets recipe does.
set -euo pipefail

tag="${1:?usage: release-assets.sh TAG}"
version="$(bun dist/wlz.js --version)"
if [ "v${version}" != "${tag}" ]; then
  echo "release-assets: the bundle reports version ${version}, but the tag is ${tag}" >&2
  exit 1
fi

out=dist/release
rm -rf "${out}"
mkdir -p "${out}"
cp dist/wlz.js "${out}/wlz.js"
bun dist/wlz.js show "${tag}" >"${out}/notes.md"
(cd "${out}" && sha256sum wlz.js >SHA256SUMS)
echo "prepared the assets of ${tag} in ${out}"
