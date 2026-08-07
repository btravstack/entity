#!/usr/bin/env sh
#
# Renders og/card.html to public/og-entity.png at exactly 1280x640.
#
#     pnpm --filter ./docs og:card
#
# Two Chrome behaviours make this a script rather than a one-liner, both
# measured on Chrome 145 (macOS):
#
#  1. Headless Chrome never exits. Chrome 132 removed the old headless mode,
#     whose --screenshot wrote the file and quit. The new one writes the file
#     and then keeps running forever; --timeout does not change that. So the
#     browser is launched in the background, watched until the PNG stops
#     growing, and killed.
#
#  2. --window-size is the WINDOW, not the viewport. Chrome subtracts its
#     window chrome (84px, measured with a ruler page) from the height, but
#     still emits the screenshot at the full requested height and pads the
#     unpainted remainder with the page background. Asking for 1280x640
#     therefore yields a 1280x640 PNG whose bottom 84px are blank — which is
#     exactly where this card's "Part of BtravStack" footer sits.
#
#     Rather than hard-code the 84 (it is not contractual, and a different
#     Chrome or platform may differ), the page is rendered into a deliberately
#     over-tall window and the top 1280x640 is cropped off. Any chrome height
#     from 0 to PAD works unchanged.
#
# The crop uses rsvg-convert, wrapping the raw PNG in an SVG viewport: it is
# already installed, and macOS's sips can only crop from the CENTRE (`-c` is
# centre-anchored and --cropOffset is not supported), which is the wrong half.
#
# The render needs the network: Geist and JetBrains Mono come from Google
# Fonts, and `display=block` in the font URL holds the paint until they arrive
# rather than flashing a fallback into the screenshot. This is a manual step —
# the PNG is committed, and CI never runs this.
set -eu

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="og/card.html"
OUT="public/og-entity.png"
WIDTH=1280
HEIGHT=640
PAD=160 # headroom for Chrome's window chrome; anything >= its real height works

[ -x "$CHROME" ] || {
  echo "render.sh: Google Chrome not found at $CHROME" >&2
  exit 1
}
command -v rsvg-convert >/dev/null || {
  echo "render.sh: rsvg-convert not found (brew install librsvg)" >&2
  exit 1
}
[ -f "$SRC" ] || {
  echo "render.sh: run this from the docs workspace (pnpm --filter ./docs og:card)" >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

"$CHROME" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size="$WIDTH,$((HEIGHT + PAD))" \
  --virtual-time-budget=8000 \
  --user-data-dir="$work/profile" \
  --screenshot="$work/raw.png" \
  "file://$PWD/$SRC" >/dev/null 2>&1 &
pid=$!

# Poll for the file, then for its size to settle — the PNG is written
# incrementally, so "exists" alone can catch a half-written one.
size=0
stable=0
i=0
while [ "$i" -lt 160 ]; do
  sleep 0.25
  i=$((i + 1))
  [ -f "$work/raw.png" ] || continue
  now=$(wc -c <"$work/raw.png")
  if [ "$now" -gt 0 ] && [ "$now" -eq "$size" ]; then
    stable=$((stable + 1))
    [ "$stable" -ge 3 ] && break
  else
    stable=0
  fi
  size=$now
done

kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true

[ -s "$work/raw.png" ] || {
  echo "render.sh: Chrome produced no screenshot" >&2
  exit 1
}

# Top-anchored crop: an SVG viewport of the target size over the raw render,
# which is taller. Relative href resolves against the SVG's own directory.
cat >"$work/crop.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="$WIDTH" height="$HEIGHT" viewBox="0 0 $WIDTH $HEIGHT">
  <image xlink:href="raw.png" x="0" y="0" width="$WIDTH" height="$((HEIGHT + PAD))"/>
</svg>
EOF

rsvg-convert --unlimited -w "$WIDTH" -h "$HEIGHT" -o "$OUT" "$work/crop.svg"

echo "render.sh: wrote $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
