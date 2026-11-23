#!/usr/bin/env bash
# Points the beta channel at the version a latest.json describes, unless the channel already
# offers a newer one.
#
#   .github/scripts/beta-channel.sh <latest.json>
#
# The channel is beta/latest.json on the branch "updates": not a version of its own, but where
# the copies of Tributary that get betas read about the newest version
# (https://raw.githubusercontent.com/<repo>/updates/beta/latest.json, src-tauri/src/updates.rs).
# A new beta points it at itself, and a new release at itself (a release is newer than its
# betas), so it always offers the newest of either. The branch holds nothing else, and is made
# the first time. It's a file on a branch, not a release's, because it changes: a published
# release's files can't once releases are immutable. Every update it offers is still checked
# against Tributary's update key before it's installed.
#
# Copies of 0.17.0 and earlier read the release tagged "beta" instead: it's kept pointing at
# the same version for as long as GitHub lets it change, so they update to a beta that reads
# the branch. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

manifest=$1
branch=updates
file=beta/latest.json
read_version() { node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).version)'; }
version=$(read_version <"$manifest")

current=$(gh api "repos/$GITHUB_REPOSITORY/contents/$file?ref=$branch" -H "Accept: application/vnd.github.raw" 2>/dev/null | read_version 2>/dev/null || true)
if ! node .github/scripts/newer.mjs "$version" "$current"; then
  echo "The beta channel offers $current, which is newer than $version: it's left as it is."
  exit 0
fi

content=$(base64 -w0 <"$manifest")
message="Beta channel: $version"
if gh api "repos/$GITHUB_REPOSITORY/branches/$branch" >/dev/null 2>&1; then
  sha=$(gh api "repos/$GITHUB_REPOSITORY/contents/$file?ref=$branch" --jq .sha 2>/dev/null || true)
  jq -n --arg message "$message" --arg content "$content" --arg branch "$branch" --arg sha "$sha" \
    '{message: $message, content: $content, branch: $branch} + (if $sha == "" then {} else {sha: $sha} end)' |
    gh api -X PUT "repos/$GITHUB_REPOSITORY/contents/$file" --input - >/dev/null
else
  # The branch's first commit, with none before it: it only ever holds the channel.
  blob=$(jq -n --arg content "$content" '{content: $content, encoding: "base64"}' |
    gh api -X POST "repos/$GITHUB_REPOSITORY/git/blobs" --input - --jq .sha)
  tree=$(jq -n --arg path "$file" --arg sha "$blob" '{tree: [{path: $path, mode: "100644", type: "blob", sha: $sha}]}' |
    gh api -X POST "repos/$GITHUB_REPOSITORY/git/trees" --input - --jq .sha)
  commit=$(jq -n --arg message "$message" --arg tree "$tree" '{message: $message, tree: $tree, parents: []}' |
    gh api -X POST "repos/$GITHUB_REPOSITORY/git/commits" --input - --jq .sha)
  jq -n --arg ref "refs/heads/$branch" --arg sha "$commit" '{ref: $ref, sha: $sha}' |
    gh api -X POST "repos/$GITHUB_REPOSITORY/git/refs" --input - >/dev/null
fi
echo "The beta channel offers $version now${current:+ (it offered $current)}."

# The channel as copies of 0.17.0 and earlier read it, while it can still change.
if gh release view beta --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  if gh release upload beta "$manifest" --repo "$GITHUB_REPOSITORY" --clobber; then
    echo "The release tagged beta offers $version too, for copies of 0.17.0 and earlier."
  else
    echo "::warning::The release tagged beta couldn't be pointed at $version (is it immutable now?): copies of 0.17.0 and earlier that get betas aren't offered it."
  fi
fi
