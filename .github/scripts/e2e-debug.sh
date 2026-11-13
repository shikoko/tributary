#!/usr/bin/env bash
# Temporary: why the desktop tests can't start the app on the Windows runner.
set -u
app="$PWD/src-tauri/target/e2e/debug/tributary.exe"
local_data=$(cygpath -u "$LOCALAPPDATA")
data="$local_data/io.github.shikoko.tributary.e2e"
temp=$(cygpath -u "$RUNNER_TEMP")

# The WebView2 processes running now: the browser process (no --type=) in full, the others counted.
webviews() {
  powershell -NoProfile -Command '
    $all = Get-CimInstance Win32_Process -Filter "Name = ''msedgewebview2.exe''"
    "msedgewebview2 processes: $($all.Count)"
    foreach ($p in $all) { if ($p.CommandLine -notmatch "--type=") { "browser process $($p.ProcessId) (parent $($p.ParentProcessId)): $($p.CommandLine)" } }
    Get-CimInstance Win32_Process -Filter "Name = ''tributary.exe''" | ForEach-Object { "tributary.exe $($_.ProcessId)" }' | tr -d '\r' | cut -c 1-1500
}
stop_all() {
  taskkill //F //IM tributary.exe > /dev/null 2>&1
  taskkill //F //IM msedgewebview2.exe > /dev/null 2>&1
  sleep 3
}

echo "== Left over from the tests"
webviews
stop_all
echo "== After stopping them"
webviews

echo "== The app by itself, with a debugging port and a data folder of the test's"
rm -rf "$data" "$temp/wv2"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" WEBVIEW2_USER_DATA_FOLDER="$(cygpath -w "$temp/wv2")" "$app" > /dev/null 2>&1 &
sleep 15
webviews
curl -s --max-time 3 http://127.0.0.1:9333/json/version && echo || echo "port 9333 doesn't answer"
echo "-- DevToolsActivePort files:"; find "$local_data" "$temp" -name DevToolsActivePort 2>/dev/null
echo "-- the test's data folder:"; ls "$temp/wv2" 2>&1 | head -5
echo "-- the app's own data folder:"; ls "$data" 2>&1 | head -5
stop_all

echo "== The app through msedgedriver, with its log on"
rm -rf "$data"
msedgedriver --port=9515 --verbose --log-path="$RUNNER_TEMP/msedgedriver.log" > /dev/null 2>&1 &
driver=$!
sleep 3
win=$(cygpath -w "$app" | sed 's/\\/\\\\/g')
(sleep 25; echo "-- 25 seconds into the session:"; webviews; echo "-- DevToolsActivePort files:"; find "$local_data" "$temp" "$(cygpath -u "$TEMP")" -name DevToolsActivePort 2>/dev/null) &
watcher=$!
curl -s --max-time 120 -X POST http://127.0.0.1:9515/session -H 'content-type: application/json' \
  -d "{\"capabilities\":{\"alwaysMatch\":{\"browserName\":\"webview2\",\"ms:edgeChromium\":true,\"ms:edgeOptions\":{\"binary\":\"$win\",\"args\":[]}}}}" | head -c 300
echo
wait "$watcher"
kill "$driver" 2>/dev/null
echo "-- msedgedriver's log, what it set and what happened:"
grep -v '^ \|^{\|^}' "$RUNNER_TEMP/msedgedriver.log" | grep -v "Populating" | cut -c 1-1200 | head -40
stop_all
exit 0
