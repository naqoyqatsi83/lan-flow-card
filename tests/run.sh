#!/usr/bin/env bash
# Runs the automated checks: syntax check of the card as a module, then the
# browser tests in headless Chromium. Exit code 1 on any failure.
# Needs python3, node and chromium/chrome (or set CHROME=/path/to/browser).
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8765}
CHROME=${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || true)}
[ -n "$CHROME" ] || { echo "no chromium/chrome found (set CHROME=...)"; exit 1; }
PY=$(command -v python3 || command -v python)
fail=0

tmp=$(mktemp -d)
cp lan-flow-card.js "$tmp/card.mjs"
if node --check "$tmp/card.mjs"; then echo "PASS syntax"; else echo "FAIL syntax"; fail=1; fi
rm -rf "$tmp"

if LC_ALL=C grep -n '[^[:print:][:space:]]' lan-flow-card.js; then echo "FAIL lan-flow-card.js is not ASCII"; fail=1; else echo "PASS ascii"; fi

"$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

for t in editor-test panel-keep-test fields-test unifi-test; do
  out=$("$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=6000 \
    --dump-dom "http://127.0.0.1:$PORT/tests/$t.html" 2>/dev/null \
    | sed -n '/<pre id="out">/,/<\/pre>/p' | sed 's/.*<pre id="out">//; s/<[^>]*>//g' | grep -E '^(PASS|FAIL)')
  pass=$(grep -c '^PASS' <<<"$out"); bad=$(grep -c '^FAIL' <<<"$out")
  grep '^FAIL' <<<"$out"
  echo "$t: $pass passed, $bad failed"
  if [ "$bad" -ne 0 ] || [ "$pass" -eq 0 ]; then fail=1; fi
done
exit $fail
