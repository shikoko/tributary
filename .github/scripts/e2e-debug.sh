#!/usr/bin/env bash
# Temporary: why the desktop tests can't start the app on the Windows runner.
set -u
app="$PWD/src-tauri/target/e2e/debug/tributary.exe"
data=$(cygpath -u "$LOCALAPPDATA")/io.github.shikoko.tributary.e2e
echo "== whoami: $(whoami), session: $(powershell -NoProfile -Command '[System.Diagnostics.Process]::GetCurrentProcess().SessionId' | tr -d '\r')"
echo "== The app, by itself, with a remote debugging port"
rm -rf "$data"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" "$app" > "$RUNNER_TEMP/app.out" 2> "$RUNNER_TEMP/app.err" &
pid=$!
for i in $(seq 1 30); do
  sleep 1
  if curl -s --max-time 2 http://127.0.0.1:9333/json/version > "$RUNNER_TEMP/devtools.json"; then echo "devtools answered after ${i}s:"; cat "$RUNNER_TEMP/devtools.json"; break; fi
done
kill -0 "$pid" 2>/dev/null && echo "the app is running" || echo "the app exited: $(wait "$pid"; echo $?)"
echo "-- its stdout:"; tail -20 "$RUNNER_TEMP/app.out"
echo "-- its stderr:"; tail -40 "$RUNNER_TEMP/app.err"
echo "-- its data folder:"; find "$data" -maxdepth 3 2>/dev/null | head -30
find "$(cygpath -u "$LOCALAPPDATA")" "$(cygpath -u "$TEMP")" -name DevToolsActivePort 2>/dev/null | head
taskkill //F //IM tributary.exe > /dev/null 2>&1
sleep 2

echo "== msedgedriver, verbose, starting the app as tauri-driver asks it to"
rm -rf "$data"
msedgedriver --port=9515 --verbose --log-path="$RUNNER_TEMP/msedgedriver.log" > /dev/null 2>&1 &
driver=$!
sleep 3
win=$(cygpath -w "$app" | sed 's/\\/\\\\/g')
curl -s --max-time 120 -X POST http://127.0.0.1:9515/session -H 'content-type: application/json' \
  -d "{\"capabilities\":{\"alwaysMatch\":{\"browserName\":\"webview2\",\"ms:edgeChromium\":true,\"ms:edgeOptions\":{\"binary\":\"$win\",\"args\":[]}}}}" | head -c 2000
echo
kill "$driver" 2>/dev/null
echo "-- msedgedriver's log (the start and the end):"
head -60 "$RUNNER_TEMP/msedgedriver.log"
echo "..."
tail -60 "$RUNNER_TEMP/msedgedriver.log"
taskkill //F //IM tributary.exe > /dev/null 2>&1
exit 0
