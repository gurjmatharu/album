# Architecture

## The idea

A wedding dump is thousands of photos; an album is 60 to 150 of them on 20 to 40 spreads.
The work splits into what can be measured and what is taste. Everything measurable is code.
Taste is one model role, the director, and it answers in data.

This follows the lesson of the Muninn Shorts pipeline (`pi-ai`,
`docs/architecture/video-system-review-2026-09-25.md`): having agents write fresh rendering
code on every run was the cost and the source of the bugs, and the fix was a typed spec, a
deterministic compiler and a catalog of tested parts. Here that is `album.json`,
`src/layout.ts` + `src/render.ts`, and `src/catalog.ts`.

## Stages

| Stage | Who | In → out | Cost |
|---|---|---|---|
| ingest | code | photo dir → `photos.json` | $0; 90 synthetic 24 MP photos took 5 s |
| faces | Python, local | photos → `faces.json`, cluster crops | $0 (not yet run, issue 1) |
| name people | you | cluster crops → `people.json` | a few minutes, once |
| cull | code | → `selects.json` | $0 |
| direct | heuristic or Claude | kept photos → `album.json` | $0, or one or two model calls (unmeasured, issue 2) |
| lint | code | spec + photos + profile → issues | $0 |
| render | code + Chromium | → `proof.pdf`, print file | $0 |
| preflight | code + poppler | output files → checks | $0 |

Each stage reads and writes files in the work directory, so any stage can be re-run alone
and `album.json` can be edited by hand between `direct` and `build`. Ingest reuses a photo
whose path, size and mtime are unchanged; render names each cropped asset by a hash of its
inputs and reuses it.

## The spec

`album.json` (`SpecSchema` in `src/types.ts`): title, print profile id, the people and their
minimum appearances, and the spreads in order. A spread is `{id, chapter, template, slots}`
and a slot is `{slot, photo, focus?}`. There is no geometry in the spec. Where a photo lands
and how it is cropped is computed.

## Templates and the crop solver

A template (`src/catalog.ts`) is a list of slots, each a rectangle in fractions of the
spread, the edges it bleeds off, and whether it is the spread's lead picture. There are
eight. A new one needs only its rectangles; the catalog test checks slots stay inside the
spread and do not overlap.

`solveCrop` (`src/layout.ts`) takes the largest crop of the slot's shape, which leaves one
free axis. It tries 41 evenly spaced positions along it, plus the wanted one, and keeps the one that cuts no face, puts no face
on the fold, loses the fewest faces, and stays closest to the point of interest (the spec's
`focus`, else the centre of the faces, else slightly above centre for vertical crops). The
same placed geometry feeds the lints, the renderer and the proof's overlays, so what is
checked is what is printed.

## Lints (`src/lints.ts`)

Errors block the print file. Warnings are listed in the proof.

| Rule | Severity | Fails when |
|---|---|---|
| `page-count` | error | pages outside the profile's range or multiple |
| `unknown-template`, `unknown-slot`, `unknown-photo`, `empty-slot` | error | the spec does not resolve |
| `duplicate` | error | a photo is used twice |
| `near-duplicate` | error | two photos within 20 s whose hashes differ by ≤ 6 bits |
| `resolution` | error / warning | under the profile's `minDpi` / under 80% of its `dpi` at printed size |
| `face-on-fold` | error | a face touches the band around the fold in a slot that crosses it |
| `face-cut` | error | a face is partly outside the crop or the trim |
| `eyes-closed` | error on a lead slot, else warning | `eyesOpen < 0.3` (nothing measures this yet, issue 8) |
| `coverage` | error | a named person is fully visible in fewer slots than their minimum |
| `face-near-trim` | warning | a face is inside the safe margin |
| `heavy-crop` | warning | under half the photo survives |
| `chronology` | warning | a spread is earlier in the day than the one before |
| `pacing` | warning | the same template three times running |
| `profile-unverified` | warning | the print profile has `verified: false` |

## Directors

`heuristic` (`src/director/heuristic.ts`): chapters at pauses over 30 minutes, spreads per
chapter by the square root of its size, and for each group of photos the template with the
best shape fit that cuts no face and stays above the minimum resolution. It has no taste. It
exists so the pipeline runs with no API key and as the baseline a model must beat.

`claude` (`src/director/claude.ts`): one `claude-opus-5-5` call at high effort with the
catalog, the people, a table of kept photos and contact sheets labelled with photo ids. It
returns the spreads through structured output. If the lints reject it, one fresh call gets
the rejected album and the error list. Token counts and an approximate dollar figure go to
`log.jsonl`. The server-side refusal fallback is enabled. It has not been run (issue 2).

Model roles not built yet, in the order they are worth adding (issues 9 and 10): a cheap
per-photo tagging pass (`claude-haiku-5-5` through the Batch API, or a local Qwen3-VL or
Gemma 4) for moment, expression and eyes; then a read-only reviewer on rendered spreads.

## Render and preflight

Render cuts every slot's picture to its printed size at the profile's resolution (never
upscaling), lays the spreads out in HTML in millimetres and prints with Chromium. A profile
chooses `pdf-pages` (one PDF page per album page, bleed on all sides), `pdf-spreads` or
`jpg-spreads`. `pdfimages` on the sample output shows the pictures embedded as JPEG at 300
ppi, not downsampled.

Preflight opens what was written: page count and page box for both PDFs, pixel size for JPEG
spreads, and for the print PDF a rasterized comparison of every page against a screenshot of
the sheet it came from. That last check exists because of a real bug during the build:
Chromium shrank each page's content to 66% inside a correctly sized page, and page-box checks
passed. The comparison scored 101 of 255 on that bug and scores about 4 on a correct file.

## Privacy

Face detection and clustering run locally. The Claude director sends contact sheets (300 px
thumbnails) and a metadata table, not originals. Nothing is uploaded by any other stage.
