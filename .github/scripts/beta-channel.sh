#!/usr/bin/env bash
# Points the beta channel at the version a latest.json describes, unless the channel already
# offers a newer one.
#
#   .github/scripts/beta-channel.sh <latest.json>
#
# The channel is the release tagged "beta": not a version of its own, but where the copies of
# Tributary that get betas read latest.json. A new beta points it at itself, and a new release
# at itself (a release is newer than its betas), so it always offers the newest of either.
# It's made the first time. Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA.
set -euo pipefail

manifest=$1
read_version() { node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).version)'; }
version=$(read_version <"$manifest")

if ! gh release view beta --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release create beta --repo "$GITHUB_REPOSITORY" --prerelease --target "$GITHUB_SHA" --title "Beta channel" \
    --notes "Not a version of its own: its latest.json tells the copies of Tributary that get beta versions (About Tributary → Get beta versions) about the newest version, beta or not. The betas themselves are the pre-releases named like v0.3.0-beta.4."
fi

current=$(gh release download beta --repo "$GITHUB_REPOSITORY" --pattern latest.json --output - 2>/dev/null | read_version 2>/dev/null || true)
if node .github/scripts/newer.mjs "$version" "$current"; then
  gh release upload beta "$manifest" --repo "$GITHUB_REPOSITORY" --clobber
  echo "The beta channel offers $version now${current:+ (it offered $current)}."
else
  echo "The beta channel offers $current, which is newer than $version: it's left as it is."
fi
