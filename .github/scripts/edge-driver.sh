#!/usr/bin/env bash
# Puts msedgedriver.exe on the PATH for the desktop tests on Windows: the one for the version
# of the WebView2 runtime that draws the app's window, as the driver won't drive another
# version. Installs the runtime first if it isn't there.
#
#   .github/scripts/edge-driver.sh    (in Git Bash)
#
# On GitHub Actions it's added to the job's PATH; elsewhere it says which folder to add.
set -euo pipefail

# WebView2's version, as Windows records it for everyone or for this user.
webview_version() {
  powershell -NoProfile -Command '
    $client = "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    foreach ($key in "HKLM:\SOFTWARE\WOW6432Node\$client", "HKLM:\SOFTWARE\$client", "HKCU:\SOFTWARE\$client") {
      $version = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).pv
      if ($version -and $version -ne "0.0.0.0") { $version; break }
    }' | tr -d '\r'
}

temp=$(cygpath -u "${RUNNER_TEMP:-$TEMP}")
version=$(webview_version)
if [ -z "$version" ]; then
  echo "WebView2 isn't installed: installing it."
  curl -fsSL --retry 3 -o "$temp/webview2-setup.exe" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
  "$temp/webview2-setup.exe" /silent /install
  version=$(webview_version)
  [ -n "$version" ] || { echo "::error::WebView2 didn't install."; exit 1; }
fi
echo "WebView2 $version"

# Microsoft's address for the drivers, then the one it had before.
folder="$temp/edge-driver"
mkdir -p "$folder"
for host in msedgedriver.microsoft.com msedgedriver.azureedge.net; do
  if curl -fsSL --retry 3 -o "$folder/driver.zip" "https://$host/$version/edgedriver_win64.zip"; then
    unzip -o -q "$folder/driver.zip" -d "$folder"
    break
  fi
  echo "::warning::Couldn't download msedgedriver $version from $host."
done

# The runner comes with a driver for its Edge, which is often WebView2's version too.
if [ ! -f "$folder/msedgedriver.exe" ] && [ -n "${EDGEWEBDRIVER:-}" ]; then
  installed=$("$(cygpath -u "$EDGEWEBDRIVER")/msedgedriver.exe" --version | grep -oE '[0-9]+(\.[0-9]+){3}' || true)
  if [ "${installed%%.*}" = "${version%%.*}" ]; then
    echo "::notice::Using the runner's own msedgedriver $installed."
    cp "$(cygpath -u "$EDGEWEBDRIVER")/msedgedriver.exe" "$folder/"
  fi
fi
[ -f "$folder/msedgedriver.exe" ] || { echo "::error::There's no msedgedriver for WebView2 $version."; exit 1; }

"$folder/msedgedriver.exe" --version
if [ -n "${GITHUB_PATH:-}" ]; then
  cygpath -w "$folder" >> "$GITHUB_PATH"
else
  echo "Add $(cygpath -w "$folder") to your PATH."
fi
