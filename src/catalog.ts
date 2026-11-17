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

export interface Template {
  id: string;
  description: string;
  slots: SlotDef[];
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

export function templateById(id: string): Template | undefined {
  return CATALOG.find((t) => t.id === id);
}
