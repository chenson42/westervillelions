# White Cane poster (22 x 28 posterboard)

Reusable year to year: no date window or year on it. White Cane Safety Day is October 15 every year, the QR encodes the stable short address `westervillelions.org/whitecane` (a redirect that can be repointed, DECISION-119), and the EIN line matches `/donate`.

- `poster-board.html` — the layout (CSS sized in inches for a 22 x 28 page). Edit copy here.
- `art.png` — the illustration (an openly stylized screen-print look; not a photo of Westerville; no children).
- `qr.png` — the QR code, error-correction level H. Regenerate only if the short address changes:
  `npx --yes qrcode -o docs/marketing/white-cane-poster/qr.png -w 1600 -m 4 -e H "https://westervillelions.org/whitecane"`
- `logo.png` — copy of `public/images/logo-official.png`.
- `white-cane-poster-22x28.pdf` — print-ready output. `white-cane-poster-22x28-preview.jpg` — preview.

The illustration is 1774 px wide, about 80 ppi across 22 in. That reads fine on a posterboard seen from a few feet; for a sharper print, export the illustration larger (3500 px wide or more) and replace `art.png` with the same filename.

Regenerate the PDF and preview after editing the HTML:

```bash
node scripts/render-white-cane-poster.mjs
```

Printing: 22 x 28 in, no scaling, matte stock. The QR prints 7 in wide, which scans from about 6 ft; keep the white margin around it. Test-scan the preview on an iPhone and an Android before printing.
