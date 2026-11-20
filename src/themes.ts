import type { Photo } from "./types";

/**
 * A theme is the album's art direction: one look held from the first spread to the last.
 * It fixes the page colour and which spread templates may be used, so the album cannot
 * drift between styles.
 */
export interface Theme {
  id: string;
  description: string;
  background: string;
  templates: string[];
}

export const THEMES: Theme[] = [
  {
    id: "gallery",
    description: "White pages, pictures framed by generous margins, full-bleed pictures kept for the moments that earn them. Reads like an exhibition catalogue.",
    background: "#ffffff",
    templates: ["pano", "hero-left-two-right", "two-left-hero-right", "framed-pair", "grid-4", "portrait-4"],
  },
  {
    id: "cinematic",
    description: "Black pages, mostly full-bleed pictures, few per spread. Reads like film stills.",
    background: "#0b0b0b",
    templates: ["pano", "full-pair", "hero-left-two-right", "two-left-hero-right", "framed-pair"],
  },
  {
    id: "editorial",
    description: "White pages and a modern book designer's layouts: offsets instead of grids, one large picture against a small one, pictures that keep their whole frame, type set for a title and a close. Reads like a photo book from a good publisher.",
    background: "#ffffff",
    templates: ["pano", "full-pair", "ed-full-left", "ed-full-right", "ed-full-stack", "ed-stack-full", "ed-full-contact", "ed-contact-full", "ed-filmstrip", "ed-opener", "ed-wide", "ed-offset", "ed-offset-rise", "ed-bleed-detail", "ed-detail-bleed", "ed-stack-right", "ed-stack-left", "ed-columns", "ed-portrait", "ed-quiet", "ed-closer"],
  },
  {
    id: "journal",
    description: "White pages, every template allowed, more pictures per spread. For telling a busy day in full.",
    background: "#ffffff",
    templates: ["pano", "full-pair", "hero-left-two-right", "two-left-hero-right", "framed-pair", "grid-4", "portrait-4", "grid-6"],
  },
];

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Mean chroma under this reads as black and white. */
export const MONO_CHROMA = 5;
/** Colour-cast distance (CIELAB a,b) between two pictures on one spread that starts to clash. */
export const CAST_LIMIT = 18;
/** Lightness difference (CIELAB L) between two pictures on one spread that starts to clash. */
export const LIGHT_LIMIT = 30;

export function isMono(p: Photo): boolean {
  return p.tone !== undefined && p.tone.chroma < MONO_CHROMA;
}

/** How far apart two pictures sit in colour cast and in lightness. Undefined when either was not measured. */
export function toneGap(a: Photo, b: Photo): { cast: number; light: number } | undefined {
  if (!a.tone || !b.tone) return undefined;
  return { cast: Math.hypot(a.tone.a - b.tone.a, a.tone.b - b.tone.b), light: Math.abs(a.tone.l - b.tone.l) };
}
