#!/bin/bash
# Make the README's animated GIFs from the demo page: docs/<view>.gif for each view.
# Needs: chromium (or google-chrome), ffmpeg, ImageMagick (convert), python3; internet for the icon font.
# Run from the repo root: bash demo/make-gifs.sh
# How: the demo page freezes every animation at ?t=<ms>; one headless screenshot per frame, 50 ms apart, all cropped
# to the card as found in the first frame, then ffmpeg makes a GIF with its own palette.
set -euo pipefail
cd "$(dirname "$0")/.."
BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
PORT=8765
FRAMES=30          # x 50 ms = 1.5 s loop
WORK=$(mktemp -d)
mkdir -p docs
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER; rm -rf "$WORK"' EXIT
sleep 1

shot() { # view width height t out [extra query]
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
    --window-size="$(($2 + 24)),$3" --screenshot="$5" \
    "http://127.0.0.1:$PORT/demo/?cfg=$1&w=$2&t=$4${6:-}" >/dev/null 2>&1
}

gif() { # name view width height [extra query]
  local name=$1 view=$2 w=$3 h=$4 extra=${5:-}
  echo "$name: $FRAMES frames"
  for i in $(seq 0 $((FRAMES - 1))); do
    shot "$view" "$w" "$h" $((1000 + i * 50)) "$WORK/$name-$(printf %03d "$i").png" "$extra"
  done
  # the card's box in the first frame (everything that isn't the page background), applied to all frames
  local crop
  crop=$(convert "$WORK/$name-000.png" -bordercolor '#111111' -border 1 -fuzz 3% -trim -format '%wx%h%X%Y' info: |
    sed -E 's/\+([0-9]+)\+([0-9]+)$/ \1 \2/' | awk '{split($1,a,"x"); printf "%dx%d+%d+%d", a[1]+16, a[2]+16, $2-9, $3-9}')
  for f in "$WORK/$name"-*.png; do convert "$f" -crop "$crop" +repage "$f"; done
  ffmpeg -loglevel error -y -framerate 20 -i "$WORK/$name-%03d.png" \
    -vf "scale=iw*0.8:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    -loop 0 "docs/$name.gif"
  echo "  docs/$name.gif $(du -h "docs/$name.gif" | cut -f1)"
}

gif tree network 900 640
gif clients wifi 900 900
gif radial radial 1000 760
gif panel wifi 900 900 "&panel=6"
