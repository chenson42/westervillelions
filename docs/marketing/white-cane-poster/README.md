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

## Postcard (6 x 4 in, same copy, art and QR)

For pinning on bulletin boards and handing out around town. Same stable short address, so it is reusable year to year like the poster.

- `postcard-4x6.html` — the layout (CSS sized in inches for a 6 x 4 landscape card). Edit copy here, then mirror the edit in `postcard-4x6-bleed.html`; the poster and the two postcard files are kept in step by hand.
- `postcard-2up-letter.html` — two cards on one letter sheet with crop marks, for a home or office printer.
- `postcard-4x6-bleed.html` / `white-cane-postcard-4x6-bleed.pdf` — the same card on a 6.25 x 4.25 page with a 0.125 in bleed on every side and all text inside a 0.25 in safe margin. **Use this one at a print shop** (FedEx Office, Staples, an online printer) and tell them the file includes bleed, trim to 6 x 4.
- `white-cane-postcard-4x6.pdf` — single card at exactly 6 x 4 with no bleed, for a printer that wants the finished size.
- `white-cane-postcard-4x6.jpg` — 1800 x 1200 px (300 ppi), for a photo counter's 4x6 print service (upload like a photo; choose "fill" or "no crop", not "fit").
- `white-cane-postcard-2up-letter.pdf` — the two-up sheet; print at 100 percent on card stock, cut on the marks.

```bash
node scripts/render-white-cane-postcard.mjs
```

The QR prints 1.35 in wide, which scans from about a foot; keep the white margin. Test-scan the JPEG on a phone before ordering a batch.
