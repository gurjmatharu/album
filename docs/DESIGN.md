# Design: what makes a spread good

The requirement: every spread should stand up as photographic design, the two pages should
read as one composition, and the album should hold one look from start to finish.

The words for this, so they can be searched and argued about:

| Term | Means | Where it lives here |
|---|---|---|
| **Art direction** (the "theme") | one look held across the whole album: page colour, how much white space, which layouts are allowed | `src/themes.ts`, `--theme`, the `off-theme` lint |
| **Sequencing** | the order of pictures and spreads, so the album reads as a story | the director; `chronology` lint |
| **Pacing / rhythm** | alternating quiet spreads and busy ones | the director; `pacing` lint |
| **Pairing** (a diptych, when it is two) | choosing pictures that say more together than apart | the director |
| **Visual continuity / cohesion** | pictures on a spread share colour, light and subject | `mixed-mono`, `spread-colour`, `spread-light` lints; director cost |
| **Visual flow** | gaze, motion and leading lines carry the eye across the fold | `gaze-off-page` lint; director prompt |
| **Scale variety** | wide, medium and close together | director prompt only (issue 21) |
| **Negative space** | margins that let a picture breathe | fixed in the templates and the theme |

## The principles

These are the instructions the model director gets (`SYSTEM` in `src/director/claude.ts`)
and the rubric the reviewer will score against when it exists.

1. **One idea per spread.** One moment, one place, one light.
2. **Shared colour and light.** Warm with warm, cool with cool. Never black-and-white
   beside colour.
3. **Scale variety.** A wide scene with a close detail or a portrait.
4. **Look into the spread.** People face the fold, not the outer edge. Motion and leading
   lines run toward the facing page.
5. **Nothing important on the fold.** No face, no hands, no rings.
6. **No echo.** The same person at the same size on both pages only when repetition is the
   point.
7. **The best pictures get the fewest neighbours.** A single-picture spread is a statement.
8. **Rhythm.** Quiet, busy, quiet. Open and close each chapter on a strong picture.
9. **One theme throughout.**

## What code enforces and what it cannot

| Principle | Checked by code | How |
|---|---|---|
| 2, black-and-white beside colour | yes, error | mean chroma under 5 counts as black-and-white |
| 2, colour and light | yes, warning | mean CIELAB colour: cast apart by more than 18, or lightness by more than 30 |
| 4, gaze | yes, warning, **when gaze is measured** | a face on a single page looking toward that page's outer edge |
| 5, faces on the fold | yes, error | the crop solver avoids it and the lint fails it |
| 8, same template three times | yes, warning | |
| 9, theme | yes, error | template not in the theme's list |
| 1, 3, 6, 7 and whether a spread is actually good | **no** | taste: the model director and the reviewer |

The thresholds (5, 18, 30) are starting values chosen on synthetic pictures. They need
tuning on a real wedding (issue 20). Mean colour is a blunt measure: two pictures with the
same average can still clash.

A program cannot make a spread a masterclass. It can refuse the spreads that break the rules
a photo editor would call mistakes, and hand everything that passes to a judge with eyes.
That judge is the model director choosing the pictures and the reviewer looking at the
rendered spreads. Neither has run yet (issues 2 and 10), so today's output is rule-abiding,
not artful.

## Themes

| Theme | Page | Layouts | Reads as |
|---|---|---|---|
| `gallery` (default) | white | framed pictures, full bleed only for lead pictures | an exhibition catalogue |
| `cinematic` | near-black | mostly full bleed, few pictures per spread | film stills |
| `journal` | white | everything, up to six per spread | the whole day, busy |
| `editorial` | white | the `ed-*` set and `pano`: offsets, scale contrast, type | a photo book from a good publisher |

### The editorial set

Almost every camera and phone delivers 3:2 to 16:9 landscapes, so the editorial slots are
16:9 and a photo keeps its whole frame (a square or portrait slot throws a third of a
landscape away). The design comes from placement, not from cropping:

- **Offsets, not grids.** Two pictures sit on a diagonal (`ed-offset`, `ed-offset-rise`) or
  step down a page (`ed-stack-*`), so the eye travels across the fold.
- **Scale contrast.** A large picture running off one edge against a small one sharing its
  baseline (`ed-bleed-detail`, `ed-detail-bleed`): the scene and a close look.
- **White space is a picture too.** `ed-quiet` puts one modest picture alone on a page as a
  pause between busy spreads.
- **Statements.** `pano` (full bleed) and `ed-wide` (framed) cross the fold; only pictures
  with nothing important in their middle go there. Without face data nothing checks this, so
  the director has to look.
- **Type.** `ed-opener` sets a date line, the title in Didot and an italic subtitle against
  the picture's edges; `ed-closer` and `ed-quiet` take a line; some spreads take a caption.
  Faces are Didot and Avenir Next (macOS system fonts, embedded in the PDF). The words live in
  the spec (`spread.text`), never in a template. `text-outside-safe` and `text-on-fold` fail
  the build when type lands where the trim or binding would take it.

A theme does not regrade photos. If the photographer's edit is inconsistent, the lints will
say so; matching the grade across pictures is not built (issue 22).

## Continuity inside a picture that spans the fold

A `pano` slot is one photograph across both pages, rendered as one image and split at the
fold in the print file, so it is continuous by construction. The risk is what lands on the
fold: the crop solver slides the crop to keep every face clear of a band around it
(`gutterSafeMm` in the print profile) and the build fails if it cannot.


## Creative direction and review

Borrowed from the Muninn shorts pipeline (`pi-ai`, `docs/architecture/video-system-review-2026-09-25.md`):
the director writes intent as data, code lays it out, and a read-only reviewer judges what
was rendered.

**The brief.** `album.json` carries `brief: {idea, arc, notes}`: the one idea the book serves,
how it unfolds, its motifs. A director writes it before choosing a single picture.

**Each spread** carries a `role` (`opener`, `statement`, `portrait`, `pairing`, `detail`,
`sequence`, `pause`, `closer`) and a one-line `intent`, and may set its own page colour
(`background`), for a chapter or the last light. Intent lives in the spec, never in a
separate prose document, so the plan and the pages cannot disagree.

**Tools a director has beyond templates:**
- `zoom` on a slot pulls a detail from a frame (a flower, the light on water). The resolution
  lint guards it: a 6000 px frame zooms about 2x in a half-page slot and still prints at
  300 dpi; a full-bleed page or panorama cannot zoom at all.
- Sequence templates (`ed-full-contact`, `ed-contact-full`, `ed-filmstrip`) show frames of one
  moment as a run. Near-duplicates are allowed inside such a spread and nowhere else.
- Story order may beat clock order; `chronology` stays a warning.

**The review.** `album pack` writes `out/review/`: `flatplan.jpg` (the book at a glance),
`spreads/` (each spread large), `pairs/` (neighbours, for rhythm and repetition) and
`review.md` (brief, roles and intents, lint results, rubric, answer format). The reviewer
scores ten items 0-10: concept, edit, sequence, pairing, scale, rhythm, flow, colour, type,
print (`RUBRIC` in `src/review.ts`). PASS needs every item at least 6, a mean of at least 7.5
and print at least 8; `parseVerdict` applies the thresholds in code, so a PASS the scores do
not support is a FAIL. Each fix is an `album.json` edit by a fresh call that changes only the
spreads named. At most two rounds.
