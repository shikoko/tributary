#!/usr/bin/env bash
# Installs the libraries Tauri needs on Linux, for the Rust checks, the smoke test and the
# AppImage.
#
# Ubuntu's mirrors sometimes can't be reached from GitHub's runners, or their names
# (azure.archive.ubuntu.com, archive.ubuntu.com, security.ubuntu.com) can't be looked up, for
# hours, while other names can. apt doesn't count that as a failure when it updates, and then
# spends 20 seconds on each package it can't download, which ran past the step's time limit
# before a second try could start. So an update that can't reach a mirror fails, each try is
# cut short, and after a failed try the next ones use mirrors outside ubuntu.com
# (kernel.org's, which carry the whole archive, security updates too).
set -uo pipefail

packages=(libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev)
apt=(sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
elsewhere=(https://mirrors.edge.kernel.org/ubuntu/ http://mirrors.kernel.org/ubuntu/ https://archive.ubuntu.com/ubuntu/)

use_elsewhere() {
  # The runners list their mirrors in apt-mirrors.txt (apt's mirror+file method), tried in order.
  if [[ -f /etc/apt/apt-mirrors.txt ]]; then
    for i in "${!elsewhere[@]}"; do printf '%s\tpriority:%d\n' "${elsewhere[$i]}" $((i + 1)); done | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
  fi
  for list in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
    if [[ -f $list ]]; then sudo sed -i -E "s#https?://(azure\.archive|archive|security)\.ubuntu\.com/ubuntu/?#${elsewhere[0]}#g" "$list"; fi
  done
}

for attempt in 1 2 3; do
  if timeout 240 "${apt[@]}" update --error-on=any && timeout 480 "${apt[@]}" install -y "${packages[@]}"; then
    exit 0
  fi
  echo "::warning::Couldn't install the Linux libraries (try $attempt of 3): trying again with mirrors outside ubuntu.com."
  getent hosts archive.ubuntu.com mirrors.edge.kernel.org || true
  # Finish anything a try that was cut short left half done.
  sudo dpkg --configure -a || true
  use_elsewhere
  sleep $((attempt * 10))
done
exit 1
