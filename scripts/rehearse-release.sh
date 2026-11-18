#!/usr/bin/env bash
# Rehearses a release of wandelzeug from the current commit in a copy of the
# checkout, so neither the release commit nor the tag reaches the
# repository. It records a change when none is pending, releases it with
# the tag helper of the configuration, prepares the assets of the GitHub
# release, and shows what the release workflow would publish.
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
cp -a . "${work}/"
cd "${work}"

# The commit and the tag of a rehearsal need an identity, but no signature.
export GIT_AUTHOR_NAME="wandelzeug rehearsal"
export GIT_AUTHOR_EMAIL="rehearsal@wandelzeug.invalid"
export GIT_COMMITTER_NAME="${GIT_AUTHOR_NAME}"
export GIT_COMMITTER_EMAIL="${GIT_AUTHOR_EMAIL}"
git config commit.gpgSign false
git config tag.gpgSign false

if ! compgen -G ".changes/unreleased/*.md" >/dev/null; then
  bun src/cli.ts new --kind Fixed --body "* Rehearse the release."
  git add .changes
  git commit --quiet --message "record a change for the rehearsal"
fi

bun src/cli.ts release auto
tag="v$(bun src/cli.ts latest)"
just release-assets "${tag}"
scripts/create-github-release.sh --dry-run "${tag}"

echo "--- release commit"
git show --stat --format="%h %s" HEAD
echo "--- tag message"
git for-each-ref --format="%(contents)" "refs/tags/${tag}"
echo "--- release notes"
cat dist/release/notes.md
echo "--- checksums"
cat dist/release/SHA256SUMS

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Release rehearsal of ${tag}"
    echo
    cat dist/release/notes.md
    echo
    echo '```'
    cat dist/release/SHA256SUMS
    echo '```'
  } >>"${GITHUB_STEP_SUMMARY}"
fi
