# Print targets

Decision (2026-11-17): **WHCC for the final album, Prodigi layflat for cheap proof copies,**
and a vendor-free PDF for validation. Each is a profile in `src/print/profiles/`; the album
spec does not change between them, only `--profile`.

| Profile | Use | Export | Verified |
|---|---|---|---|
| `proof-10x10` | validating the pipeline, reading a PDF | one PDF page per page | yes (no lab to match) |
| `prodigi-layflat-294` | first physical copy, 294x294 mm (`BOOK-FE-11_7-SQ-LF-G`) | one PDF page per page, no bleed; `book.pdf` with covers | **no** |
| `whcc-album-10x10` | the final album | one JPEG per spread | **no, placeholder numbers** |

A profile sets page size, bleed, safe margin, the no-face band around the fold, target and
minimum resolution, the page range and the export shape. `verified: false` puts a warning on
every build until someone checks the numbers against the lab's own spec.

## Prodigi catalogue API, 2026-11-20 (live key, read-only calls; no order created)

- Square layflat SKU **`BOOK-FE-11_7-SQ-LF-G`**: hard matte cover, 190gsm gloss pages,
  `default` print area **294 x 294 mm** at 300 dpi (the 297 mm in the print guide is the A4
  width, not the square). Made in US or DE, ships worldwide, 120 h production.
- **Spine** (`GET /catalogue/variants/{sku}/spine`, CA, any province): 10 mm at 18 pages,
  12 mm at 32 and 34, 14 mm at 40. The variant lists no `spine` print area; the API also
  accepts `spineDetails.dynamicSpineDetails` (colour plus text rendered in production).
- **Quote** (`POST /quotes/order`, one book, a Toronto address, USD): 32 pages = items 38.38
  (28.58 for the first 18 pages + 0.70 a page) + shipping 24.26 = **62.64**, tax 0.00. Budget
  and Standard cost the same. It ships from Prodigi's **German lab** (de8), so Canadian GST/HST
  and a carrier handling fee are due on delivery.
- Sandbox orders need a `sandbox_` key from the sandbox dashboard; a live key cannot be
  turned into one by changing its prefix.

## Prodigi layflat page order (print guide, page 6)

PDF page 1 is the front cover. Prodigi adds a blank inside front cover, so **PDF page 2
prints alone on the first right-hand page**; spreads are PDF pages 3+4, 5+6, and so on; the
**second-to-last PDF page prints alone on a left-hand page** facing a blank inside back cover
that Prodigi adds; the last PDF page is the back cover. A PDF that puts spreads straight
after the cover prints every spread split across two openings. `book.pdf` follows the
guide: `spec.firstPage` (a `page-*` right-hand layout, e.g. the title page) and
`spec.lastPage` (a left-hand layout, e.g. a colophon) fill the two single pages, or blank
white pages go in their place with a `blank-page` warning. The spine for this book is set
with `dynamicSpineDetails` in the API or in the dashboard's manual order form (fonts: Arial,
Brandon, DarkCourier, Georgia, GochiHand, Helvetica, Tahoma, TimesNewRoman, Verdana).
Prodigi recommends PDF/X-4 with fonts embedded and transparency flattened.

## Lab research, 2026-11-20 (from the labs' own docs; nothing ordered, no account used)

This overrides the older notes below where they disagree. Profiles stay `verified: false`
until a test order.

**Prodigi** (API v5, `https://api.prodigi.com/v5`, `X-API-Key`; a `sandbox_` key is never
printed or charged) [OpenAPI spec](https://www.prodigi.com/print-api/docs/openapi.yml)
- **There is no 12x12 in layflat.** Sizes are 210x210 mm, 297x297 mm, A4 landscape and A4
  portrait; SKUs start `BOOK-FE` (e.g. `BOOK-FE-A4-L-LF-G`).
  [product page](https://www.prodigi.com/products/books-and-magazines/layflat-photo-book/)
- Interior: one PDF of **single pages**, page size = book size, **no bleed and no crop
  marks** (Prodigi adds them), **10 mm safe margin** on outer edges, none at the inner edge on
  layflat. 300 dpi, RGB, PDF/X-4. PDF page 1 is the front cover and the last is the back
  cover; a blank page sits inside each cover.
  [print guide](https://www.prodigi.com/download/print-guides/layflat-photo-book-print-guide.pdf)
- 18–122 pages, even counts. Spine is its own `spine` print area; its width comes from
  `GET /catalogue/variants/{sku}/spine?pageCount=&countryCode=CA&stateOrCounty=..`.
- Flow: `POST /quotes/order`, `POST /orders` (assets by **public URL**), `POST
  /orders/{id}:submit`, webhooks. Layflat is made in the EU and US only; import taxes to
  Canada fall on the recipient. [taxation FAQ](https://www.prodigi.com/faq/taxation/)

**WHCC**
- The Order Submit API is **legacy** and issues no new credentials. The new API (Bearer key,
  stage `https://apis-stage.whcc.com/api`, no fees) requires albums and layflat books to be
  **designed in WHCC's hosted editor**: no PDF, no headless path yet ("not expected until
  December"). [albums guide](https://www.whcc.com/developer/docs/guides/albums/index.html.md),
  [FAQ](https://www.whcc.com/developer/docs/faq/index.html.md)
- Layflat 10–40 spreads; 12x12 lustre is $137 USD for 10 spreads plus $7 per spread.
  [layflat](https://www.whcc.com/products/layflat-books.md)
- Canada: WHCC is importer of record (GST/HST on the invoice, nothing due at the door);
  shipping $7.95 plus 10% of the order plus the current tariff.

**What this means here:** the old `prodigi-layflat-12x12` profile described a product Prodigi does
not sell; it was replaced by `prodigi-layflat-297`, then by `prodigi-layflat-294` once the catalogue API gave the real size (see below). WHCC cannot take
this pipeline's output through its API until headless ordering ships; its spreads would be
uploaded into the editor by hand.

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
