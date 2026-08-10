#!/usr/bin/env bash
#
# Renders the welcome packet to a PDF, and verifies it paginated correctly.
#
#   scripts/render-welcome-packet.sh [source.html] [output.pdf]
#
# Defaults to docs/club-documents/welcome-packet-2026-27.html, written to
# ~/Downloads so it is somewhere you can actually find it and attach to mail.
#
# WHY THE VERIFY STEP EXISTS
#   Slides are content-sized, and the deck only works if each one occupies
#   exactly one landscape sheet. A slide that grows past the page spills onto
#   a second sheet silently, and every page after it is off by one. That has
#   happened repeatedly from changes as small as adding one contact row, and
#   it is invisible until someone flips through 29 printed pages. So: count
#   the <section class="slide"> blocks in the source, count the pages in the
#   PDF, and fail loudly if they disagree.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$REPO_ROOT/docs/club-documents/welcome-packet-2026-27.html}"
OUT="${2:-$HOME/Downloads/$(basename "${SRC%.html}").pdf}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }
[ -f "$SRC" ]    || { echo "No such source file: $SRC" >&2; exit 1; }

# The source has no <!doctype>/<html> wrapper: it is also published as a
# Claude artifact, which supplies one. Wrap it before printing.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
{
  printf '<!doctype html><html><head><meta charset="utf-8">'
  printf '<style>*{box-sizing:border-box}html,body{margin:0;padding:0}</style>'
  printf '</head><body>'
  cat "$SRC"
  printf '</body></html>'
} > "$TMP/packet.html"

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$TMP/packet.html" >/dev/null 2>&1

python3 - "$SRC" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
# Strip HTML comments first: this repo's own maintenance header quotes the
# string <section class="slide">, and counting it inflates the total by one,
# which silently cancels out a real overflow. That exact off-by-one hid a
# broken render the first time this script ran.
body = re.sub(r'<!--.*?-->', '', open(src).read(), flags=re.S)
slides = len(re.findall(r'<section class="slide', body))
data = open(out, "rb").read()
pages = len(re.findall(rb'/Type\s*/Page[^s]', data))
box = re.search(rb'/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', data)
w, h = (float(box.group(1))/72, float(box.group(2))/72) if box else (0, 0)

print(f"  slides in source : {slides}")
print(f"  pages in PDF     : {pages}")
print(f"  page size        : {w:.2f} x {h:.2f} in")
print(f"  written to       : {out}")

if pages != slides:
    print()
    print(f"  *** PAGINATION BROKEN: {pages} pages from {slides} slides. ***")
    print("  At least one slide no longer fits a single landscape sheet, so")
    print("  every page after it is out of register. Find it by rendering each")
    print("  slide on its own, then shorten that slide or split it in two.")
    sys.exit(1)
print()
print("  OK: one slide per page.")
PY
