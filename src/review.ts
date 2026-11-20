import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Layout } from "./layout";
import type { AlbumSpec, Issue, Profile } from "./types";
import { trimmedPages } from "./view";

/**
 * The reviewer's evidence pack and rubric. Borrowed from the Muninn shorts pipeline: a
 * read-only judge looks at what was actually rendered, scores it against a fixed rubric with
 * hard floors, and every fix it asks for is a spec edit, made by a fresh call that changes
 * only the spreads it names. A person can run the same review by reading review.md and the
 * images beside it.
 *
 * The pack is cut from the print file, so the judge sees exactly what will be printed.
 */

export const RUBRIC = [
  ["concept", "The book serves its brief: one idea holds it together, and each spread's intent is visible on the page."],
  ["edit", "Every picture earns its place. No weak, redundant or near-repeat frame outside a sequence spread."],
  ["sequence", "It reads as a story: a strong opening, chapters that open and close on strong pictures, an arc you can feel."],
  ["pairing", "Pictures on a spread say more together than apart: a rhyme of gesture, colour, shape or light, or a meaningful contrast."],
  ["scale", "Wide, medium and close alternate. Details and faces punctuate the scenes. No run of same-size pictures."],
  ["rhythm", "Busy and quiet spreads alternate; statements land because quiet surrounds them; no layout fatigue."],
  ["flow", "The eye moves into the spread: gaze and lines lead toward the fold; nothing important sits on it."],
  ["colour", "Each spread holds one light; page colour changes mark chapters, not whims."],
  ["type", "Type is quiet, well set and sparing; white space looks chosen, not left over."],
  ["print", "Nothing will disappoint on paper: resolution, faces near trim or fold, muddy shadows, over-pulled details."],
] as const;

/** PASS needs every item at least this, the mean at least PASS_MEAN, and print at least PASS_PRINT. */
export const PASS_FLOOR = 6;
export const PASS_MEAN = 7.5;
export const PASS_PRINT = 8;

const OUTPUT = `Answer in exactly this form:

SCORES
concept: n
edit: n
sequence: n
pairing: n
scale: n
rhythm: n
flow: n
colour: n
type: n
print: n
VERDICT: PASS or FAIL
SPREADS
sNN: what is wrong -> the spec edit that fixes it (template, photo, focus, zoom, order, background)
(at most 8 lines; only spreads that need a change)
TOP 3 FIXES
1. ...
2. ...
3. ...`;

export interface PackOutput {
  dir: string;
  brief: string;
}

async function sideBySide(left: Buffer, right: Buffer, pagePx: number): Promise<Buffer> {
  const [l, r] = await Promise.all([sharp(left).resize(pagePx, pagePx).toBuffer(), sharp(right).resize(pagePx, pagePx).toBuffer()]);
  return sharp({ create: { width: 2 * pagePx, height: pagePx, channels: 3, background: "#ffffff" } })
    .composite([{ input: l, left: 0, top: 0 }, { input: r, left: pagePx, top: 0 }])
    .png()
    .toBuffer();
}

/** Write out/review/: flatplan.jpg, spreads/sNN.jpg, pairs/sNN-sMM.jpg and review.md. */
export async function buildPack(spec: AlbumSpec, profile: Profile, layout: Layout, issues: Issue[], outDir: string): Promise<PackOutput> {
  const printPath = profile.export === "jpg-spreads" ? join(outDir, "spreads") : join(outDir, "print.pdf");
  const dir = join(outDir, "review");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "spreads"), { recursive: true });
  mkdirSync(join(dir, "pairs"), { recursive: true });
  const tmp = join(dir, ".raw");
  mkdirSync(tmp);
  const pages = await trimmedPages(printPath, profile, tmp);
  rmSync(tmp, { recursive: true, force: true });

  const n = spec.spreads.length;
  const big: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const s = await sideBySide(pages[2 * i]!, pages[2 * i + 1]!, 800);
    big.push(s);
    await sharp(s).jpeg({ quality: 85 }).toFile(join(dir, "spreads", `${spec.spreads[i]!.id}.jpg`));
  }
  // Neighbouring spreads one above the other: rhythm, echo and repetition show here.
  for (let i = 0; i + 1 < n; i++) {
    const [a, b] = await Promise.all([sharp(big[i]!).resize(1200).toBuffer(), sharp(big[i + 1]!).resize(1200).toBuffer()]);
    await sharp({ create: { width: 1200, height: 1240, channels: 3, background: "#3a3836" } })
      .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 0, top: 640 }])
      .jpeg({ quality: 82 })
      .toFile(join(dir, "pairs", `${spec.spreads[i]!.id}-${spec.spreads[i + 1]!.id}.jpg`));
  }
  // The flatplan: the whole book at a glance, in reading order, four spreads to a row.
  const W = 480, H = 240, G = 14, cols = 4;
  const tiles = await Promise.all(big.map((b) => sharp(b).resize(W, H).toBuffer()));
  const rows = Math.ceil(n / cols);
  await sharp({ create: { width: cols * (W + G) + G, height: rows * (H + G) + G, channels: 3, background: "#3a3836" } })
    .composite(tiles.map((t, i) => ({ input: t, left: G + (i % cols) * (W + G), top: G + Math.floor(i / cols) * (H + G) })))
    .jpeg({ quality: 82 })
    .toFile(join(dir, "flatplan.jpg"));

  const byId = new Map(layout.spreads.map((s) => [s.id, s]));
  const lines = spec.spreads.map((s, i) => {
    const placed = byId.get(s.id);
    const photos = placed ? placed.slots.map((x) => `${x.def.id}=${x.photo.path}${x.zoom ? ` zoom ${x.zoom}` : ""} ${Math.round(x.effDpi)}dpi`).join(", ") : "";
    return `- **${s.id}** (${i * 2 + 1}-${i * 2 + 2}) \`${s.template}\`${s.role ? ` · ${s.role}` : ""}${s.background ? ` · page ${s.background}` : ""}${s.intent ? `: ${s.intent}` : ""}\n  ${photos}`;
  });
  const lint = issues.filter((i) => i.rule !== "profile-unverified").map((i) => `- ${i.severity} ${i.rule}: ${i.message}`);
  const md = `# Review: ${spec.title}

You are the reviewer: a photo-book editor with a designer's eye. Look at flatplan.jpg first,
then every image in spreads/ and pairs/. Judge only what you see against the brief and the
rubric. You do not lay pages out; every fix you ask for must be a change to album.json.

## Brief

${spec.brief ? `**Idea.** ${spec.brief.idea}\n\n${spec.brief.arc ? `**Arc.** ${spec.brief.arc}\n\n` : ""}${spec.brief.notes ? `**Notes.** ${spec.brief.notes}\n` : ""}` : "_No brief: score concept at most 4._"}

## Spreads

${lines.join("\n")}

## What the scripts already found

${lint.length ? lint.join("\n") : "Nothing: lint is clean."}

## Rubric (0-10 each)

${RUBRIC.map(([k, v]) => `- **${k}**: ${v}`).join("\n")}

PASS needs every score at least ${PASS_FLOOR}, a mean of at least ${PASS_MEAN}, and print at least ${PASS_PRINT}. Anything else is FAIL. Do not round up.

${OUTPUT}
`;
  const brief = join(dir, "review.md");
  writeFileSync(brief, md);
  return { dir, brief };
}

export interface Verdict {
  scores: Record<string, number>;
  pass: boolean;
  mean: number;
}

/** Parse a reviewer's answer and apply the thresholds in code: a PASS the numbers do not support is a FAIL. */
export function parseVerdict(text: string): Verdict {
  const scores: Record<string, number> = {};
  for (const [k] of RUBRIC) {
    const m = new RegExp(`^${k}:\\s*(\\d+(?:\\.\\d+)?)`, "mi").exec(text);
    if (m) scores[k] = Number(m[1]);
  }
  const vals = RUBRIC.map(([k]) => scores[k]);
  const complete = vals.every((v) => v !== undefined);
  const mean = complete ? vals.reduce((a, b) => a! + b!, 0)! / vals.length : 0;
  const said = /VERDICT:\s*PASS/i.test(text);
  const pass = said && complete && vals.every((v) => v! >= PASS_FLOOR) && mean >= PASS_MEAN && (scores.print ?? 0) >= PASS_PRINT;
  return { scores, pass, mean: Math.round(mean * 100) / 100 };
}
