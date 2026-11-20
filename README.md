# album

Turn a folder of wedding photos into a print-ready album. Code culls the photos and checks
the result; a director (a model, or a free heuristic) decides which photo goes where; a
compiler renders the pages. The director writes **data, never layout code**.

```
photos/ ─ ingest ─ faces ─ cull ─ direct ─ lint ─ render ─ preflight ─▶ proof.pdf + print file
           code    cv/     code   model    code    code     code
```

## Quick start

```bash
bun install
bun run album sample sample/photos        # 90 synthetic photos + faces.json + people.json
bun run album run sample/photos --spreads 12 --title "Sample wedding"
open work/out/proof.pdf                   # every spread with trim, safe zone, fold and faces drawn on
bun run album view                        # page-turning viewer of the print file -> work/out/viewer/index.html
```

Every picture gets a light, bounded print prep as it is cut for the print file (shadow lift
on backlit faces, white balance matched within each spread, a midtone lift for paper,
sharpening); originals are untouched and `"prep": "off"` in `album.json` turns it off. See
`src/prep.ts`.

The viewer is built from the print file itself, trimmed at the bleed, so what you flip
through is what the lab gets. It needs a web server for its images (`python3 -m http.server
--directory work/out/viewer`); `.claude/launch.json` has one for the Punta Cana work dir.

Put `ALBUM_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` in a
local `.env` (gitignored, bun loads it) to render with an installed Chrome.

With real photos:

```bash
bun run album ingest ~/Pictures/wedding
uv run --project cv python cv/cv_worker.py faces ~/Pictures/wedding work   # see cv/README.md
# edit work/people.json: name the clusters, set each person's minimum appearances
bun run album cull
bun run album direct --profile prodigi-layflat-297 --theme gallery --spreads 30 --title "..." [--director claude]
bun run album build
```

`build` exits 1 and **withholds the print file** when a lint fails; `proof.pdf` is always
written and lists what failed. `bun test` runs the unit tests and one end-to-end build.

## What is in the work directory

| File | Written by | What |
|---|---|---|
| `photos.json` | `ingest` | id (sha), size, capture time, sharpness, difference hash, mean colour |
| `faces.json`, `faces/` | face worker | face boxes with a cluster id; sample crops per cluster |
| `people.json` | you | who matters, their minimum appearances, cluster → person |
| `selects.json` | `cull` | burst id, score, keep or the reason it was dropped |
| `album.json` | `direct` | the spec: spreads, each a template plus a photo per slot. Hand-editable |
| `out/proof.pdf` | `build` | summary and lint list, then every spread with guides |
| `out/print.pdf` or `out/spreads/*.jpg` | `build` | what the lab gets, per the print profile |
| `out/lint.json`, `out/preflight.json` | `build` | the checks, as data |
| `out/viewer/` | `view` | the page-turning viewer: `index.html`, trimmed pages, cover image |
| `log.jsonl` | every stage | one line per stage: wall time, dollars |

## Layout of the repo

```
src/cli.ts             the verbs
src/types.ts           Photo, AlbumSpec, Profile (zod schemas)
src/catalog.ts         the spread templates (8)
src/layout.ts          spec + photos + profile -> placed slots; the crop solver
src/lints.ts           every check a script can make
src/render.ts          assets at print size, HTML, PDF / JPEG spreads, proof
src/preflight.ts       opens the output and confirms it is what was asked for
src/view.ts            the page-turning viewer, built from the print file
src/ingest.ts          measure photos       src/cull.ts   bursts, blur, best-of
src/director/          heuristic.ts ($0 baseline), claude.ts (model director)
src/print/profiles/    one JSON per lab product
cv/                    Python face worker (InsightFace), run with uv
scripts/make-sample.ts the synthetic wedding
src/themes.ts          art direction: gallery, cinematic, journal; colour-continuity helpers
docs/                  ARCHITECTURE.md, DESIGN.md, PRINT.md, OPEN-ISSUES.md
```

## Status

The deterministic spine (ingest, cull, heuristic director, lints, render, preflight) runs and
is tested on synthetic photos. The face worker and the Claude director are written but have
**not been run**. No lab profile is verified and nothing orders a print. Read
[docs/OPEN-ISSUES.md](docs/OPEN-ISSUES.md) before trusting an album to it.
