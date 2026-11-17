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

A theme does not regrade photos. If the photographer's edit is inconsistent, the lints will
say so; matching the grade across pictures is not built (issue 22).

## Continuity inside a picture that spans the fold

A `pano` slot is one photograph across both pages, rendered as one image and split at the
fold in the print file, so it is continuous by construction. The risk is what lands on the
fold: the crop solver slides the crop to keep every face clear of a band around it
(`gutterSafeMm` in the print profile) and the build fails if it cannot.
