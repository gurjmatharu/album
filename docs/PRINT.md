# Print targets

Decision (2026-11-17): **WHCC for the final album, Prodigi layflat for cheap proof copies,**
and a vendor-free PDF for validation. Each is a profile in `src/print/profiles/`; the album
spec does not change between them, only `--profile`.

| Profile | Use | Export | Verified |
|---|---|---|---|
| `proof-10x10` | validating the pipeline, reading a PDF | one PDF page per page | yes (no lab to match) |
| `prodigi-layflat-12x12` | first physical copy | one PDF page per page | **no** |
| `whcc-album-10x10` | the final album | one JPEG per spread | **no, placeholder numbers** |

A profile sets page size, bleed, safe margin, the no-face band around the fold, target and
minimum resolution, the page range and the export shape. `verified: false` puts a warning on
every build until someone checks the numbers against the lab's own spec.

## What is known, with sources

**WHCC**
- The Order Submit API handles albums: the order request needs an `ItemBookAttribute` block
  whose `BookAttributeUID` values come from the product catalog. Orders are imported, then
  submitted with the returned confirmation id. API credentials are required.
  [Albums](https://www.whcc.com/developer/docs/order-submit-api/albums/index.html.md),
  [overview](https://www.whcc.com/developer/docs/order-submit-api/)
- Not confirmed: whether the flush-mount style can be ordered through the API, the sizes,
  bleed, spread limits, and whether files are per spread or per page.
- **Canada:** WHCC has a help page for orders shipping to Canada, so it ships there. That
  page mentions an $18 minimum and Canada's 25% surtax on certain US-origin goods
  (in force since 2025-03-04). Whether the surtax applies to albums, and who pays duties
  and taxes at the door, is not confirmed.
  [Shipping to Canada](https://www.whcc.com/help/shipping/canada)

**Prodigi**
- Layflat books come in 9x9 in, 12x12 in and A4 on 190 gsm lustre paper. The page range is
  18–122 in the technical guide and 24–122 in a dashboard announcement.
  [Technical guide](https://www.prodigi.com/blog/photo-books-technical-guide),
  [announcement](https://www.prodigi.com/blog/photo-books-now-available/)
- Prodigi recommends PDF/X-4 with fonts embedded, says its workflow is tuned for RGB input,
  and wants the spine supplied separately from the cover for API orders, with a width that
  depends on the page count. [FAQ](https://prodigi.com/faq/print-api)
- Not confirmed: bleed, safe margins, whether the interior is uploaded as single pages, and
  shipping to Canada.

## Notes on the output

- In `pdf-pages` export the inner bleed of each page shows the neighbouring page's content,
  as a spread split in two normally does. On a true layflat book printed as spreads this
  never shows; on a bound book a trim error could show a sliver.
- Pictures are sRGB JPEG at quality 95. There is no CMYK conversion and no PDF/X output
  (issue 7).
- There is no cover and no spine yet (issue 5).
