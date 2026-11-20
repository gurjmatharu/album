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
 * delivers, so a slot keeps the whole photograph. Asymmetry, white space and scale contrast do
 * the design work: one large picture against a small one, offsets instead of grids, a picture
 * running off one edge only, and type set where a book designer would set it.
 */
const L169 = 9 / 16;
/** A 16:9 landscape slot on one page: x, y, width in page fractions. */
function land(id: string, side: "L" | "R", x: number, y: number, w: number, opts: { bleed?: Edge[]; hero?: boolean } = {}): SlotDef {
  return slot(id, page(side, x, y, w, w * L169), opts);
}
function words(id: string, side: "L" | "R", x: number, y: number, w: number, h: number, role: TextDef["role"], align: TextDef["align"] = "left", anchor: TextDef["anchor"] = "top"): TextDef {
  return { id, rect: page(side, x, y, w, h), role, align, anchor };
}
const WIDE_H = 0.8;
const WIDE_W = (WIDE_H / L169) / 2; // spread fraction
const WIDE_X = (1 - WIDE_W) / 2;
const BAND = 0.9 * L169; // height of a 0.9-page-wide band

export const EDITORIAL: Template[] = [
  {
    id: "ed-opener",
    place: "first",
    description: "Title spread. Left page: date line, the title large in Didot, an italic subtitle, set against the picture's edges. Right page: one large landscape. Opens the album.",
    slots: [land("a", "R", 0.07, (1 - 0.86 * L169) / 2, 0.86, { hero: true })],
    text: [
      words("kicker", "L", 0.14, (1 - 0.86 * L169) / 2, 0.66, 0.08, "kicker"),
      words("title", "L", 0.14, 0.36, 0.74, (1 + 0.86 * L169) / 2 - 0.36, "display", "left", "bottom"),
      words("subtitle", "L", 0.14, (1 + 0.86 * L169) / 2 + 0.02, 0.66, 0.1, "subtitle"),
    ],
  },
  {
    id: "ed-wide",
    description: "One landscape, large and framed in white, across both pages. A statement. The picture crosses the fold: nothing important in its middle.",
    slots: [slot("a", { x: WIDE_X, y: 0.09, w: WIDE_W, h: WIDE_H }, { hero: true })],
    text: [words("caption", "R", 0.2, 0.09 + WIDE_H + 0.02, (WIDE_X + WIDE_W - 0.5) * 2 - 0.2, 0.05, "caption", "right")],
  },
  {
    id: "ed-offset",
    description: "Two landscapes on a diagonal: high on the left page, low on the right. Two moments that lead into each other.",
    slots: [land("a", "L", 0.1, 0.1, 0.84, { hero: true }), land("b", "R", 0.06, 1 - 0.1 - 0.84 * L169, 0.84)],
    text: [words("caption", "L", 0.1, 0.1 + 0.84 * L169 + 0.025, 0.5, 0.08, "caption")],
  },
  {
    id: "ed-offset-rise",
    description: "Two landscapes on the other diagonal: low on the left page, high on the right.",
    slots: [land("a", "L", 0.1, 1 - 0.1 - 0.84 * L169, 0.84, { hero: true }), land("b", "R", 0.06, 0.1, 0.84)],
    text: [words("caption", "R", 0.4, 0.1 + 0.84 * L169 + 0.025, 0.5, 0.08, "caption", "right")],
  },
  {
    id: "ed-bleed-detail",
    description: "A large landscape running off the left edge, and a small detail on the right page sharing its bottom line. Scale contrast: the scene and a close look.",
    slots: [land("a", "L", 0, 0.2, 0.92, { bleed: ["left"], hero: true }), land("b", "R", 0.2, 0.2 + 0.92 * L169 - 0.58 * L169, 0.58)],
    text: [words("caption", "R", 0.2, 0.2 + 0.92 * L169 + 0.025, 0.58, 0.08, "caption")],
  },
  {
    id: "ed-detail-bleed",
    description: "A small detail on the left page and a large landscape running off the right edge, sharing a top line.",
    slots: [land("a", "R", 0.08, 0.28, 0.92, { bleed: ["right"], hero: true }), land("b", "L", 0.22, 0.28, 0.58)],
    text: [words("caption", "L", 0.22, 0.28 - 0.11, 0.58, 0.085, "caption", "left", "bottom")],
  },
  {
    id: "ed-full-left",
    description: "A full-bleed left page (the landscape cropped square around its subject: set focus) and a landscape low on the white right page. Bold; for a portrait or a face that holds a page.",
    slots: [slot("a", page("L", 0, 0, 1, 1), { bleed: ["left", "top", "bottom"], hero: true }), land("b", "R", 0.14, 0.88 - 0.68 * L169, 0.68)],
    text: [words("caption", "R", 0.14, 0.88 - 0.68 * L169 - 0.1, 0.68, 0.08, "caption", "left", "bottom")],
  },
  {
    id: "ed-full-right",
    description: "A landscape high on the white left page and a full-bleed right page (cropped square around its subject: set focus).",
    slots: [slot("a", page("R", 0, 0, 1, 1), { bleed: ["right", "top", "bottom"], hero: true }), land("b", "L", 0.18, 0.12, 0.68)],
    text: [words("caption", "L", 0.18, 0.12 + 0.68 * L169 + 0.025, 0.68, 0.08, "caption")],
  },
  {
    id: "ed-stack-right",
    description: "One large landscape on the left page; two smaller ones stepping down the right page. A moment and what followed.",
    slots: [
      land("a", "L", 0.08, (1 - 0.84 * L169) / 2, 0.84, { hero: true }),
      land("b", "R", 0.1, 0.12, 0.62),
      land("c", "R", 0.28, 0.12 + 0.62 * L169 + 0.05, 0.62),
    ],
  },
  {
    id: "ed-stack-left",
    description: "Two smaller landscapes stepping down the left page; one large landscape on the right page.",
    slots: [
      land("a", "R", 0.08, (1 - 0.84 * L169) / 2, 0.84, { hero: true }),
      land("b", "L", 0.28, 0.12, 0.62),
      land("c", "L", 0.1, 0.12 + 0.62 * L169 + 0.05, 0.62),
    ],
  },
  {
    id: "ed-columns",
    description: "Four landscapes, two per page, set toward the outer edges with the fold left open. For a run of moments from one place.",
    slots: [
      land("a", "L", 0.12, 0.115, 0.66, { hero: true }),
      land("b", "L", 0.12, 0.115 + 0.66 * L169 + 0.04, 0.66),
      land("c", "R", 0.22, 0.115, 0.66),
      land("d", "R", 0.22, 0.115 + 0.66 * L169 + 0.04, 0.66),
    ],
  },
  {
    id: "ed-portrait",
    description: "A tall portrait-format picture on the left page; a landscape on the right page sharing its bottom line.",
    slots: [
      slot("a", page("L", 0.3, 0.12, 0.76 * L169, 0.76), { hero: true }),
      land("b", "R", 0.08, 0.88 - 0.84 * L169, 0.84),
    ],
  },
  {
    id: "ed-quiet",
    description: "One modest landscape alone on the right page, a line of italic on the left. A pause between busy spreads; sunsets, empty places, a look.",
    slots: [land("a", "R", 0.15, (1 - 0.7 * L169) / 2, 0.7, { hero: true })],
    text: [words("line", "L", 0.14, 0.4, 0.66, (1 + 0.7 * L169) / 2 - 0.4, "subtitle", "left", "bottom")],
  },
  {
    id: "ed-closer",
    place: "last",
    description: "Closing spread: one large landscape on the left page, a centred line of type on the right.",
    slots: [land("a", "L", 0.07, (1 - 0.86 * L169) / 2, 0.86, { hero: true })],
    text: [words("kicker", "R", 0.2, 0.44, 0.6, 0.05, "kicker", "center", "bottom"), words("line", "R", 0.2, 0.5, 0.6, 0.08, "subtitle", "center", "top")],
  },
];

CATALOG.push(...EDITORIAL);

export function templateById(id: string): Template | undefined {
  return CATALOG.find((t) => t.id === id);
}
