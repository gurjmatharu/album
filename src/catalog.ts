import type { Rect } from "./types";

export type Edge = "left" | "right" | "top" | "bottom";

export interface SlotDef {
  id: string;
  /** Fractions of the spread's trim box: x 0..1 spans both pages, the fold is at 0.5. */
  rect: Rect;
  /** Trim edges this slot runs off; it is extended by the bleed there. */
  bleed: Edge[];
  /** The spread's lead picture: stricter lints apply. */
  hero: boolean;
}

/**
 * A box of type. The role fixes the face, size and case (render.ts); the template fixes where
 * it sits; the spec supplies the words. Never placed under a picture.
 */
export interface TextDef {
  id: string;
  rect: Rect;
  role: "display" | "subtitle" | "kicker" | "caption";
  align: "left" | "center" | "right";
  /** Where the words sit inside the box: against its top or its bottom edge. */
  anchor: "top" | "bottom" | "middle";
}

export interface Template {
  id: string;
  description: string;
  slots: SlotDef[];
  text?: TextDef[];
  /** Only for the album's first or last spread (an opener, a closer). */
  place?: "first" | "last";
  /** Frames of one moment shown as a run; near-duplicates are allowed within the spread. */
  sequence?: boolean;
  /** A cover layout (left page = back cover, right page = front cover); never an interior spread. */
  cover?: boolean;
}

const M = 0.07; // page margin, fraction of a page
const G = 0.025; // gap between pictures, fraction of a page

/** A rect given in fractions of one page, converted to spread fractions. */
function page(side: "L" | "R", x: number, y: number, w: number, h: number): Rect {
  return { x: (side === "R" ? 0.5 : 0) + x / 2, y, w: w / 2, h };
}

function slot(id: string, rect: Rect, opts: { bleed?: Edge[]; hero?: boolean } = {}): SlotDef {
  return { id, rect, bleed: opts.bleed ?? [], hero: opts.hero ?? false };
}

const inner = 1 - 2 * M;
const half = (inner - G) / 2;

export const CATALOG: Template[] = [
  {
    id: "pano",
    description: "One picture across both pages, full bleed. Needs a wide landscape with no face on the fold.",
    slots: [slot("a", { x: 0, y: 0, w: 1, h: 1 }, { bleed: ["left", "right", "top", "bottom"], hero: true })],
  },
  {
    id: "full-pair",
    description: "Two full-bleed pages, one picture each.",
    slots: [
      slot("a", page("L", 0, 0, 1, 1), { bleed: ["left", "top", "bottom"], hero: true }),
      slot("b", page("R", 0, 0, 1, 1), { bleed: ["right", "top", "bottom"] }),
    ],
  },
  {
    id: "hero-left-two-right",
    description: "Full-bleed lead picture on the left page, two framed landscapes stacked on the right.",
    slots: [
      slot("a", page("L", 0, 0, 1, 1), { bleed: ["left", "top", "bottom"], hero: true }),
      slot("b", page("R", M, M, inner, half)),
      slot("c", page("R", M, M + half + G, inner, half)),
    ],
  },
  {
    id: "two-left-hero-right",
    description: "Two framed landscapes stacked on the left, full-bleed lead picture on the right page.",
    slots: [
      slot("a", page("R", 0, 0, 1, 1), { bleed: ["right", "top", "bottom"], hero: true }),
      slot("b", page("L", M, M, inner, half)),
      slot("c", page("L", M, M + half + G, inner, half)),
    ],
  },
  {
    id: "framed-pair",
    description: "One framed picture per page with wide white margins. Quiet, for portraits and details.",
    slots: [
      slot("a", page("L", 0.14, 0.14, 0.72, 0.72), { hero: true }),
      slot("b", page("R", 0.14, 0.14, 0.72, 0.72)),
    ],
  },
  {
    id: "grid-4",
    description: "Two framed landscapes stacked on each page.",
    slots: [
      slot("a", page("L", M, M, inner, half)),
      slot("b", page("L", M, M + half + G, inner, half)),
      slot("c", page("R", M, M, inner, half)),
      slot("d", page("R", M, M + half + G, inner, half)),
    ],
  },
  {
    id: "portrait-4",
    description: "Two framed portraits side by side on each page.",
    slots: [
      slot("a", page("L", M, M, half, inner)),
      slot("b", page("L", M + half + G, M, half, inner)),
      slot("c", page("R", M, M, half, inner)),
      slot("d", page("R", M + half + G, M, half, inner)),
    ],
  },
  {
    id: "grid-6",
    description: "A landscape over two small pictures on each page. For busy moments: dancing, guests, details.",
    slots: [
      slot("a", page("L", M, M, inner, half)),
      slot("b", page("L", M, M + half + G, half, half)),
      slot("c", page("L", M + half + G, M + half + G, half, half)),
      slot("d", page("R", M, M, inner, half)),
      slot("e", page("R", M, M + half + G, half, half)),
      slot("f", page("R", M + half + G, M + half + G, half, half)),
    ],
  },
];

/*
 * Editorial set: built around 3:2-to-16:9 landscapes, the shape almost every camera and phone
 * delivers, so a slot keeps the whole photograph. Pictures are large and margins tight (4-6% of
 * a page); white space is kept for the few spreads that are meant as pauses (the opener, the
 * quiet page, the closer). Asymmetry and scale contrast do the rest: a full-bleed page against
 * a stack, a picture running off one edge, offsets instead of grids.
 *
 * A 16:9 picture across the full width of a square page fills at most 56% of it, so the dense
 * layouts stack two per page or go full bleed (a square crop around the subject: set `focus`).
 */
const L169 = 9 / 16;
/** A 16:9 landscape slot on one page: x, y, width in page fractions. */
function land(id: string, side: "L" | "R", x: number, y: number, w: number, opts: { bleed?: Edge[]; hero?: boolean } = {}): SlotDef {
  return slot(id, page(side, x, y, w, w * L169), opts);
}
function words(id: string, side: "L" | "R", x: number, y: number, w: number, h: number, role: TextDef["role"], align: TextDef["align"] = "left", anchor: TextDef["anchor"] = "top"): TextDef {
  return { id, rect: page(side, x, y, w, h), role, align, anchor };
}
/** A full-bleed page: the landscape is cropped square around its subject. */
function fullPage(id: string, side: "L" | "R"): SlotDef {
  return slot(id, page(side, 0, 0, 1, 1), { bleed: [side === "L" ? "left" : "right", "top", "bottom"], hero: true });
}
// Two landscapes stacked on one page: nearly fills it, a little more room on the outer edge than at the fold.
const SW = 0.78;
const SH = SW * L169;
const SG = 0.03;
const STOP = (1 - 2 * SH - SG) / 2;
function stack(ids: [string, string], side: "L" | "R"): SlotDef[] {
  const x = side === "L" ? 0.14 : 0.08;
  return [land(ids[0], side, x, STOP, SW), land(ids[1], side, x, STOP + SH + SG, SW)];
}
// Six frames on one page, two columns by three rows, like a contact sheet.
const CW = 0.41;
const CH = CW * L169;
const CG = 0.03;
function contact(ids: string[], side: "L" | "R"): SlotDef[] {
  const x0 = side === "L" ? 0.08 : 0.07;
  const y0 = (1 - 3 * CH - 2 * CG) / 2;
  return ids.map((id, i) => land(id, side, x0 + (i % 2) * (CW + CG), y0 + Math.floor(i / 2) * (CH + CG), CW));
}
const BIG = 0.92; // one large landscape on a page
const WIDE_H = 0.9;
const WIDE_W = (WIDE_H / L169) / 2; // spread fraction
const OPEN = 0.9;

export const EDITORIAL: Template[] = [
  {
    id: "ed-opener",
    place: "first",
    description: "Title spread. Left page: date line, the title large in Didot, an italic subtitle, set against the picture's edges. Right page: one large landscape. Opens the album; its white space is the point.",
    slots: [land("a", "R", 0.05, (1 - OPEN * L169) / 2, OPEN, { hero: true })],
    text: [
      words("kicker", "L", 0.14, (1 - OPEN * L169) / 2, 0.66, 0.08, "kicker"),
      words("title", "L", 0.14, 0.36, 0.74, (1 + OPEN * L169) / 2 - 0.36, "display", "left", "bottom"),
      words("subtitle", "L", 0.14, (1 + OPEN * L169) / 2 + 0.02, 0.66, 0.1, "subtitle"),
    ],
  },
  {
    id: "ed-wide",
    description: "One landscape across both pages, nearly full height, in a thin white frame. A statement. The picture crosses the fold: nothing important in its middle.",
    slots: [slot("a", { x: (1 - WIDE_W) / 2, y: (1 - WIDE_H) / 2, w: WIDE_W, h: WIDE_H }, { hero: true })],
  },
  {
    id: "ed-offset",
    description: "Two large landscapes on a diagonal: high on the left page, low on the right. Two moments that lead into each other.",
    slots: [land("a", "L", 0.06, 0.06, 0.9, { hero: true }), land("b", "R", 0.04, 0.94 - 0.9 * L169, 0.9)],
    text: [words("caption", "L", 0.06, 0.06 + 0.9 * L169 + 0.025, 0.5, 0.08, "caption")],
  },
  {
    id: "ed-offset-rise",
    description: "Two large landscapes on the other diagonal: low on the left page, high on the right.",
    slots: [land("a", "L", 0.06, 0.94 - 0.9 * L169, 0.9, { hero: true }), land("b", "R", 0.04, 0.06, 0.9)],
    text: [words("caption", "R", 0.44, 0.06 + 0.9 * L169 + 0.025, 0.5, 0.08, "caption", "right")],
  },
  {
    id: "ed-bleed-detail",
    description: "A large landscape running off the left edge, and a smaller one on the right page sharing its bottom line. Scale contrast: the scene and a closer look.",
    slots: [land("a", "L", 0, 0.23, 0.96, { bleed: ["left"], hero: true }), land("b", "R", 0.1, 0.23 + 0.96 * L169 - 0.76 * L169, 0.76)],
    text: [words("caption", "R", 0.1, 0.23 + 0.96 * L169 + 0.02, 0.76, 0.08, "caption")],
  },
  {
    id: "ed-detail-bleed",
    description: "A smaller landscape on the left page and a large one running off the right edge, sharing a top line.",
    slots: [land("a", "R", 0.04, 0.23, 0.96, { bleed: ["right"], hero: true }), land("b", "L", 0.14, 0.23, 0.76)],
    text: [words("caption", "L", 0.14, 0.23 - 0.1, 0.76, 0.08, "caption", "left", "bottom")],
  },
  {
    id: "ed-full-left",
    description: "A full-bleed left page (cropped square around its subject: set focus) and a large landscape low on the right page. Bold; for a face that holds a page.",
    slots: [fullPage("a", "L"), land("b", "R", 0.08, 0.92 - 0.84 * L169, 0.84)],
    text: [words("caption", "R", 0.08, 0.92 - 0.84 * L169 - 0.1, 0.84, 0.08, "caption", "left", "bottom")],
  },
  {
    id: "ed-full-right",
    description: "A large landscape high on the left page and a full-bleed right page (cropped square around its subject: set focus).",
    slots: [fullPage("a", "R"), land("b", "L", 0.08, 0.08, 0.84)],
    text: [words("caption", "L", 0.08, 0.08 + 0.84 * L169 + 0.02, 0.84, 0.08, "caption")],
  },
  {
    id: "ed-full-stack",
    description: "A full-bleed left page (square crop: set focus) facing two landscapes stacked on the right. The densest spread: a portrait and two moments around it.",
    slots: [fullPage("a", "L"), ...stack(["b", "c"], "R")],
  },
  {
    id: "ed-stack-full",
    description: "Two landscapes stacked on the left page facing a full-bleed right page (square crop: set focus).",
    slots: [fullPage("a", "R"), ...stack(["b", "c"], "L")],
  },
  {
    id: "ed-full-contact",
    sequence: true,
    description: "A full-bleed left page (square crop: set focus) facing six frames of one moment as a contact sheet, two columns by three rows. The run of a burst: laughter, a gesture, the light changing.",
    slots: [fullPage("a", "L"), ...contact(["b", "c", "d", "e", "f", "g"], "R")],
  },
  {
    id: "ed-contact-full",
    sequence: true,
    description: "Six frames of one moment as a contact sheet on the left page facing a full-bleed right page (square crop: set focus).",
    slots: [fullPage("a", "R"), ...contact(["b", "c", "d", "e", "f", "g"], "L")],
  },
  {
    id: "ed-filmstrip",
    sequence: true,
    description: "Four frames of one moment in a single band across the spread, like a strip of film. Time slowed down; read left to right.",
    slots: [land("a", "L", 0.06, 0.5 - (0.44 * L169) / 2, 0.44, { hero: true }), land("b", "L", 0.53, 0.5 - (0.44 * L169) / 2, 0.44), land("c", "R", 0.03, 0.5 - (0.44 * L169) / 2, 0.44), land("d", "R", 0.5, 0.5 - (0.44 * L169) / 2, 0.44)],
    text: [words("caption", "L", 0.06, 0.5 + (0.44 * L169) / 2 + 0.03, 0.6, 0.08, "caption")],
  },
  {
    id: "ed-stack-right",
    description: "One large landscape on the left page; two stacked on the right. A moment and what followed.",
    slots: [land("a", "L", 0.04, (1 - BIG * L169) / 2, BIG, { hero: true }), ...stack(["b", "c"], "R")],
  },
  {
    id: "ed-stack-left",
    description: "Two landscapes stacked on the left page; one large landscape on the right.",
    slots: [land("a", "R", 0.04, (1 - BIG * L169) / 2, BIG, { hero: true }), ...stack(["b", "c"], "L")],
  },
  {
    id: "ed-columns",
    description: "Four landscapes, two stacked on each page. For a run of moments from one place.",
    slots: [...stack(["a", "b"], "L"), ...stack(["c", "d"], "R")].map((s, i) => (i === 0 ? { ...s, hero: true } : s)),
  },
  {
    id: "ed-portrait",
    description: "A tall portrait-format picture on the left page; a large landscape on the right page sharing its bottom line.",
    slots: [
      slot("a", page("L", (1 - 0.9 * L169) / 2, 0.05, 0.9 * L169, 0.9), { hero: true }),
      land("b", "R", 0.04, 0.95 - BIG * L169, BIG),
    ],
  },
  {
    id: "ed-quiet",
    description: "One modest landscape alone on the right page, a line of italic on the left. A deliberate pause between busy spreads; use it once or twice an album.",
    slots: [land("a", "R", 0.15, (1 - 0.7 * L169) / 2, 0.7, { hero: true })],
    text: [words("line", "L", 0.14, 0.4, 0.66, (1 + 0.7 * L169) / 2 - 0.4, "subtitle", "left", "bottom")],
  },
  {
    id: "ed-closer",
    place: "last",
    description: "Closing spread: one large landscape on the left page, a centred line of type on the right.",
    slots: [land("a", "L", 0.05, (1 - OPEN * L169) / 2, OPEN, { hero: true })],
    text: [words("kicker", "R", 0.2, 0.44, 0.6, 0.05, "kicker", "center", "bottom"), words("line", "R", 0.2, 0.5, 0.6, 0.08, "subtitle", "center", "top")],
  },
];

CATALOG.push(...EDITORIAL);

/*
 * Covers. Laid out as a flat wraparound without the spine: left page = back cover, right page
 * = front cover. Type stays well inside the edges, because a printed hardcover wraps round its
 * boards and the lab's wrap margin is not confirmed yet.
 */
export const COVERS: Template[] = [
  {
    id: "cover-inset",
    cover: true,
    description: "Front: one landscape set high in white, the title in Didot below it, a subtitle and a date line. Back: one quiet line. Gallery-catalogue restraint.",
    slots: [land("a", "R", 0.12, 0.12, 0.76, { hero: true })],
    text: [
      words("title", "R", 0.12, 0.12 + 0.76 * L169 + 0.05, 0.76, 0.16, "display"),
      words("subtitle", "R", 0.12, 0.12 + 0.76 * L169 + 0.19, 0.76, 0.07, "subtitle"),
      words("kicker", "R", 0.12, 0.84, 0.76, 0.05, "kicker"),
      words("line", "L", 0.2, 0.8, 0.6, 0.07, "caption", "center"),
    ],
  },
  {
    id: "cover-full",
    cover: true,
    description: "Front: one picture full bleed (square crop: set focus), no type; the title is on the spine and the back. Back: title and line centred. For a picture strong enough to be the whole cover.",
    slots: [fullPage("a", "R")],
    text: [words("title", "L", 0.15, 0.38, 0.7, 0.16, "display", "center", "bottom"), words("line", "L", 0.15, 0.56, 0.7, 0.07, "subtitle", "center")],
  },
];

CATALOG.push(...COVERS);

export function templateById(id: string): Template | undefined {
  return CATALOG.find((t) => t.id === id);
}
