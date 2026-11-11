#!/usr/bin/env bash
# Installs the libraries Tauri needs on Linux, for the Rust checks and the smoke test.
#
# Ubuntu's mirror on GitHub's runners (azure.archive.ubuntu.com) sometimes can't be reached,
# or its name can't be looked up, for a while. apt doesn't count that as a failure when it
# updates, and then spends 20 seconds on each package it can't download, which ran past the
# step's time limit before a second try could start. So an update that can't reach a mirror
# fails, each try is cut short, and after a failed try the Azure mirror is swapped for
# Ubuntu's own (archive.ubuntu.com) for the next one.
set -uo pipefail

packages=(libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev)
apt=(sudo apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)

for attempt in 1 2 3; do
  if timeout 240 "${apt[@]}" update --error-on=any && timeout 480 "${apt[@]}" install -y "${packages[@]}"; then
    exit 0
  fi
  echo "::warning::Couldn't install the Linux libraries (try $attempt of 3): trying again with Ubuntu's own mirror."
  # Finish anything a try that was cut short left half done.
  sudo dpkg --configure -a || true
  # The runners list their mirrors in apt-mirrors.txt (apt's mirror+file method).
  for list in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
    if [[ -f $list ]]; then sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' "$list"; fi
  done
  sleep $((attempt * 10))
done
exit 1
