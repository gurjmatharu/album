# Open issues

State on 2026-11-20 (first real album: 87 photos, Punta Cana 2022). Numbered so commits and notes can refer to
them. Close an issue by deleting it here in the commit that fixes it.

## Blocks a real album

1. **The face worker has never run.** `cv/cv_worker.py faces` is written against InsightFace
   (`buffalo_l`) and DBSCAN but was not executed: no real photos and no model weights where
   it was built. The clustering threshold (`DBSCAN_EPS = 0.5`) and the 2% minimum face width
   are starting values. Until it runs, real albums have no faces, so crops ignore people and
   `coverage`, `face-cut` and `face-on-fold` check nothing. Also: the `buffalo_l` weights
   are non-commercial. Fine for a family album, not for a product.

2. **The Claude director has never called the API.** `src/director/claude.ts` typechecks
   against `@anthropic-ai/sdk` 1.10 and nothing more. Unknown until the first run: whether
   the prompt produces a lint-clean album, whether 300 px contact-sheet tiles are enough to
   judge a photo, how many photos fit in one call, and the cost per album. It sends the
   `server-side-fallback-2026-07-01` beta with `fallbacks: "default"`.

3. **The WHCC profile is a placeholder, and the API cannot take a finished album yet.** WHCC's
   new API needs albums designed in its hosted editor (see PRINT.md, 2026-11-20). Size, bleed, page range and the JPEG-per-spread
   export are guesses. Needs a WHCC account, API credentials and the product catalog. Open
   questions are in [PRINT.md](PRINT.md): flush mount through the API, file format, and
   duties or surtax on an album shipped to Canada.

4. **The Prodigi profile is unverified.** `prodigi-layflat-297` follows Prodigi's print guide (no
   bleed, 10 mm safe margin; there is no 12x12 in layflat). Still true: Page range (18 or 24 minimum), bleed, safe
   margins and the interior file shape need the API reference and one test order.

5. **No cover and no spine.** Only interior spreads are designed and rendered. Both labs
   need cover art, and Prodigi wants a separate spine whose width depends on page count.

6. **HEIC and RAW files are skipped.** Ingest reports how many. iPhone photos (HEIC) and
   any photographer's RAW delivery need a decode step (libheif, libraw) before ingest.

## Quality

7. **No colour management.** Assets are sRGB JPEG and the PDF is whatever Chromium writes:
   no output intent, no PDF/X-4, no soft proof against a lab profile. Prodigi recommends
   PDF/X-4.

8. **Nothing measures closed eyes.** The `eyes-closed` lint and the cull penalty exist, but
   no stage writes `eyesOpen`. Options: face landmarks in the worker, or the tagging pass.

9. **No per-photo tagging.** Chapters are "Chapter N" split at 30-minute pauses, and the cull
   score is sharpness plus who is in frame. A tagging pass (moment, expression, eyes,
   lead-worthiness) would feed the cull, chapter names and the director's table.

10. **No reviewer.** Nothing looks at the rendered spreads for taste. Planned: one read-only
    vision pass over proof pages against a rubric, then a fresh fixer per flagged spread.

11. **The heuristic director has no taste.** It fits shapes, keeps colour and light together
    and avoids lint errors. It does not know a first kiss from a table setting and will not
    pick a strong opening picture. A spread that is good design needs the model director.

12. **Near-duplicates are caught only inside 20 seconds.** The same pose shot a minute apart,
    or by a second photographer, passes. Image embeddings would catch these.

13. **Camera clocks are trusted.** Two cameras a few minutes apart break burst grouping,
    chapters and the chronology lint. Photos with no EXIF time fall back to file mtime
    (`timeSource: "mtime"`), which is usually the copy time.

14. **A face near the fold on a single page is not flagged.** `face-on-fold` only fires for
    slots that cross the fold; a face at the inner edge of a full-bleed page passes.

## Design

20. **Continuity thresholds are untuned.** `spread-colour` (cast 18), `spread-light`
    (lightness 30) and the black-and-white cut-off (chroma 5) were set on synthetic
    pictures. Mean colour is also blunt: two pictures with the same average can clash. Tune
    on a real wedding, and consider a palette or histogram distance.

21. **Scale variety, one-idea-per-spread and echo are not checked.** They need subject size
    (face size is a start) and scene understanding from the tagging pass (issue 9). Today
    only the model director's prompt carries them. See [DESIGN.md](DESIGN.md).

22. **Print prep is automatic and bounded, not an edit.** `src/prep.ts` lifts shadows on
    backlit pictures, pulls white balance 60% toward each spread's average (at most 6% a
    channel), lifts midtones slightly for print and sharpens at output size. It does not
    straighten horizons, correct wide-angle stretch, retouch, or match a creative grade; that
    is a person's job in Lightroom. The amounts were tuned by eye on one album (Punta Cana
    2022) and have not been checked against a printed proof.

23. **Nothing measures gaze.** The `gaze-off-page` lint and the director's cost exist, but
    the face worker does not write `gaze`. InsightFace reports head pose; mapping its yaw to
    left/right has to be checked on real photos before it is trusted.

24. **Templates have fixed margins.** A theme picks which templates are allowed and the page
    colour, not margin or gap sizes. Type exists only in the editorial templates (title,
    subtitle, date line, caption); no director writes it yet, so words are hand-written in
    `album.json`. Nothing measures whether words fit their box.

## Plumbing

15. **Nothing orders a print.** By design for now: a person uploads `print.pdf` or the
    spreads. Order submission through the Prodigi or WHCC API is not written.

16. **Preflight needs poppler.** Without `pdftoppm` the PDF-versus-layout check fails
    outright. Rendering needs a Chromium that matches the installed Playwright, or
    `ALBUM_CHROMIUM`.

17. **Ingest and asset cutting are serial.** Fine at 90 photos (5 s); a 5,000-photo dump will
    want a worker pool. Not measured at that size.

18. **No spend cap.** `log.jsonl` records dollars per stage, but nothing stops a run at a
    budget. Add before any stage loops over photos with a model.
