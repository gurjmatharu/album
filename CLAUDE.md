# album: agent rules

Read [README.md](README.md) first, then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Open
work is in [docs/OPEN-ISSUES.md](docs/OPEN-ISSUES.md); update it in the same commit that
closes or adds an issue.

- **Models write `album.json`, never layout code.** A new look is a new template in
  `src/catalog.ts` with a test, not HTML written per album.
- **Design rules live in [docs/DESIGN.md](docs/DESIGN.md).** A rule a script can measure
  becomes a lint; the rest goes in the director's prompt and the reviewer's rubric, in the
  same words.
- **Scripts judge what a script can check.** Anything measurable (resolution, duplicates,
  faces on the fold, coverage, page count) is a lint in `src/lints.ts`. A model judges taste
  only. Every lint message names the spread, slot, photo and the number.
- **A lint error is never soft-passed.** `build` withholds the print file; `--force` is for a
  person, not for an agent or a script.
- **A model fix is a fresh call** with the rejected spec and the error list, never a resumed
  conversation.
- **No model sees a photo the cull dropped,** and face recognition stays on this machine.
  Only contact sheets and metadata go to an API.
- **Print profiles carry `verified: false`** until their numbers were checked against the
  lab's own spec. Do not flip it from a blog post or a search result.
- **Nothing here places an order.** A person uploads or orders. Adding order submission needs
  an explicit go-ahead.
- Never commit `work/` or `sample/`, or anyone's photos.
- Runtime: bun. `bun test` and `bun run typecheck` before a commit. The face worker is Python
  under `cv/`, run with `uv`.
- Rendering needs Chromium: Playwright's own, or `ALBUM_CHROMIUM=/path/to/chrome`.
  Preflight needs poppler (`pdftoppm`).
