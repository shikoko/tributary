#!/usr/bin/env bash
# Checks a published release the way Tributary sees it: the latest release is <tag>, its
# latest.json is that version's and lists every platform, each platform's file downloads, the
# update window's notes have no pictures, and the pictures on the release page load. Run by
# the release build once it's published; it can be run again by hand on an older release:
#
#   GH_TOKEN=… .github/scripts/check-release.sh v0.7.0
set -uo pipefail
tag=$1
repository=${GITHUB_REPOSITORY:-shikoko/tributary}
problems=0
problem() {
  echo "::error::$1"
  problems=$((problems + 1))
}
# One byte of it, following GitHub's redirects: enough to know it downloads.
downloads() { curl -fsSL --retry 3 -r 0-0 -o /dev/null "$1"; }

latest=$(gh api "repos/$repository/releases/latest" --jq .tag_name)
[ "$latest" = "$tag" ] || problem "The latest release is $latest, not $tag."

release=$(gh api "repos/$repository/releases/tags/$tag") || { problem "There's no release $tag."; exit 1; }
manifest=$(mktemp)
url=$(jq -r '.assets[] | select(.name == "latest.json") | .browser_download_url' <<<"$release")
if [ -z "$url" ] || ! curl -fsSL --retry 3 -o "$manifest" "$url"; then
  problem "$tag has no latest.json, so nobody is offered it."
  exit 1
fi
version=$(jq -r .version "$manifest")
[ "$version" = "${tag#v}" ] || problem "latest.json says $version, not ${tag#v}."
for platform in darwin-aarch64 darwin-x86_64 windows-x86_64 windows-x86_64-nsis; do
  file=$(jq -r --arg platform "$platform" '.platforms[$platform].url // empty' "$manifest")
  if [ -z "$file" ]; then
    problem "latest.json has nothing for $platform."
  elif ! downloads "$file"; then
    problem "$platform's file doesn't download: $file"
  fi
done
if jq -r .notes "$manifest" | grep -q '!\['; then
  problem "The update window's notes have pictures in them."
fi
pictures=$(jq -r .body <<<"$release" | grep -oE '!\[[^]]*\]\([^)]+\)' | sed -E 's/.*\(([^)]+)\)/\1/' || true)
for picture in $pictures; do
  downloads "$picture" || problem "A picture on the release page doesn't load: $picture"
done

if [ "$problems" -gt 0 ]; then
  exit 1
fi
echo "::notice::$tag is the latest release: latest.json lists every platform and their files download, and its page's $(wc -w <<<"$pictures") pictures load."
