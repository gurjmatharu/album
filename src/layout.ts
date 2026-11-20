import { templateById, type SlotDef, type Template, type TextDef } from "./catalog";
import type { AlbumSpec, Face, Issue, Photo, Profile, Rect } from "./types";

/** A face as it lands on the spread, in mm from the trim box's top-left corner. */
export interface PlacedFace {
  rect: Rect;
  person?: string;
  eyesOpen?: number;
  gaze?: "left" | "right" | "front";
  cut: boolean;
  onFold: boolean;
  nearTrim: boolean;
}

export interface PlacedSlot {
  def: SlotDef;
  photo: Photo;
  /** mm from the trim box's top-left corner; extends into the bleed where the slot bleeds. */
  rect: Rect;
  /** Source pixels kept. */
  crop: Rect;
  /** Source pixels per inch at the printed size. */
  effDpi: number;
  /** Share of the photo's area that survives the crop. */
  kept: number;
  faces: PlacedFace[];
}

export interface PlacedText {
  def: TextDef;
  value: string;
  /** Trim-box mm. */
  rect: Rect;
}

export interface PlacedSpread {
  id: string;
  chapter: string;
  template: Template;
  slots: PlacedSlot[];
  text: PlacedText[];
}

export interface Layout {
  profile: Profile;
  /** Trim size of one spread in mm. */
  spreadMm: { w: number; h: number };
  spreads: PlacedSpread[];
  /** Problems that stop a slot from being placed at all. */
  issues: Issue[];
}

export function slotRectMm(def: SlotDef, profile: Profile): Rect {
  const W = profile.pageMm.w * 2;
  const H = profile.pageMm.h;
  const b = profile.bleedMm;
  let x = def.rect.x * W;
  let y = def.rect.y * H;
  let w = def.rect.w * W;
  let h = def.rect.h * H;
  if (def.bleed.includes("left")) { x -= b; w += b; }
  if (def.bleed.includes("right")) w += b;
  if (def.bleed.includes("top")) { y -= b; h += b; }
  if (def.bleed.includes("bottom")) h += b;
  return { x, y, w, h };
}

function intersects(a: Rect, x0: number, x1: number): boolean {
  return a.x < x1 && a.x + a.w > x0;
}

function placeFaces(photo: Photo, crop: Rect, rect: Rect, profile: Profile): PlacedFace[] {
  const W = profile.pageMm.w * 2;
  const H = profile.pageMm.h;
  const fold = profile.pageMm.w;
  const out: PlacedFace[] = [];
  for (const f of photo.faces) {
    const px = { x: f.x * photo.width, y: f.y * photo.height, w: f.w * photo.width, h: f.h * photo.height };
    // Entirely outside the crop: not in the picture, so not a problem and not an appearance.
    if (px.x + px.w <= crop.x || px.x >= crop.x + crop.w || px.y + px.h <= crop.y || px.y >= crop.y + crop.h) continue;
    const s = rect.w / crop.w;
    const r: Rect = { x: rect.x + (px.x - crop.x) * s, y: rect.y + (px.y - crop.y) * s, w: px.w * s, h: px.h * s };
    const eps = 0.01;
    const cutByCrop = px.x < crop.x - eps || px.y < crop.y - eps || px.x + px.w > crop.x + crop.w + eps || px.y + px.h > crop.y + crop.h + eps;
    const cutByTrim = r.x < -eps || r.y < -eps || r.x + r.w > W + eps || r.y + r.h > H + eps;
    const crossesFold = rect.x < fold && rect.x + rect.w > fold;
    const onFold = crossesFold && intersects(r, fold - profile.gutterSafeMm, fold + profile.gutterSafeMm);
    const s0 = profile.safeMm;
    const nearTrim = !cutByTrim && (r.x < s0 || r.y < s0 || r.x + r.w > W - s0 || r.y + r.h > H - s0);
    out.push({ rect: r, person: f.person, eyesOpen: f.eyesOpen, gaze: f.gaze, cut: cutByCrop || cutByTrim, onFold, nearTrim });
  }
  return out;
}

function facesCentre(faces: Face[]): { x: number; y: number } | undefined {
  if (faces.length === 0) return undefined;
  const x0 = Math.min(...faces.map((f) => f.x));
  const y0 = Math.min(...faces.map((f) => f.y));
  const x1 = Math.max(...faces.map((f) => f.x + f.w));
  const y1 = Math.max(...faces.map((f) => f.y + f.h));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * The largest crop of the slot's shape, slid along its one free axis to the position that
 * cuts no face, puts no face on the fold and stays closest to the point of interest.
 */
export function solveCrop(
  photo: Photo,
  def: SlotDef,
  profile: Profile,
  focus?: { x: number; y: number },
): Omit<PlacedSlot, "def" | "photo"> {
  const rect = slotRectMm(def, profile);
  const aspect = rect.w / rect.h;
  const wide = photo.width / photo.height > aspect;
  const cw = wide ? photo.height * aspect : photo.width;
  const ch = wide ? photo.height : photo.width / aspect;
  const free = wide ? photo.width - cw : photo.height - ch;
  // With nothing to aim at, a vertical crop favours the upper part, where heads usually are.
  const want = focus ?? facesCentre(photo.faces) ?? { x: 0.5, y: wide ? 0.5 : 0.42 };
  const wanted = Math.min(Math.max((wide ? want.x * photo.width - cw / 2 : want.y * photo.height - ch / 2), 0), free);

  let best: { crop: Rect; faces: PlacedFace[]; cost: number } | undefined;
  const steps = free > 0 ? 40 : 0;
  for (let i = 0; i <= steps + 1; i++) {
    const pos = i > steps ? wanted : steps === 0 ? 0 : (free * i) / steps;
    const crop: Rect = wide ? { x: pos, y: 0, w: cw, h: ch } : { x: 0, y: pos, w: cw, h: ch };
    const faces = placeFaces(photo, crop, rect, profile);
    const bad = faces.filter((f) => f.cut || f.onFold).length;
    const lost = photo.faces.length - faces.length;
    const cost = bad * 1000 + lost * 100 + faces.filter((f) => f.nearTrim).length * 10 + (free > 0 ? Math.abs(pos - wanted) / free : 0);
    if (!best || cost < best.cost) best = { crop, faces, cost };
  }
  const { crop, faces } = best!;
  return {
    rect,
    crop,
    effDpi: crop.w / (rect.w / 25.4),
    kept: (crop.w * crop.h) / (photo.width * photo.height),
    faces,
  };
}

export function resolveLayout(spec: AlbumSpec, photos: Map<string, Photo>, profile: Profile): Layout {
  const issues: Issue[] = [];
  const spreads: PlacedSpread[] = [];
  for (const sp of spec.spreads) {
    const template = templateById(sp.template);
    if (!template) {
      issues.push({ severity: "error", rule: "unknown-template", spread: sp.id, message: `spread ${sp.id}: no template "${sp.template}" in the catalog` });
      continue;
    }
    const slots: PlacedSlot[] = [];
    for (const def of template.slots) {
      const fill = sp.slots.find((s) => s.slot === def.id);
      if (!fill) {
        issues.push({ severity: "error", rule: "empty-slot", spread: sp.id, slot: def.id, message: `spread ${sp.id}: slot ${def.id} of ${template.id} has no photo` });
        continue;
      }
      const photo = photos.get(fill.photo);
      if (!photo) {
        issues.push({ severity: "error", rule: "unknown-photo", spread: sp.id, slot: def.id, photo: fill.photo, message: `spread ${sp.id} slot ${def.id}: photo ${fill.photo} is not in photos.json` });
        continue;
      }
      slots.push({ def, photo, ...solveCrop(photo, def, profile, fill.focus) });
    }
    for (const s of sp.slots) {
      if (!template.slots.some((d) => d.id === s.slot)) {
        issues.push({ severity: "error", rule: "unknown-slot", spread: sp.id, slot: s.slot, message: `spread ${sp.id}: template ${template.id} has no slot "${s.slot}"` });
      }
    }
    const text: PlacedText[] = [];
    for (const [id, value] of Object.entries(sp.text ?? {})) {
      const def = template.text?.find((t) => t.id === id);
      if (!def) {
        issues.push({ severity: "error", rule: "unknown-text", spread: sp.id, message: `spread ${sp.id}: template ${template.id} has no text box "${id}"` });
        continue;
      }
      if (value.trim()) text.push({ def, value, rect: { x: def.rect.x * profile.pageMm.w * 2, y: def.rect.y * profile.pageMm.h, w: def.rect.w * profile.pageMm.w * 2, h: def.rect.h * profile.pageMm.h } });
    }
    spreads.push({ id: sp.id, chapter: sp.chapter, template, slots, text });
  }
  return { profile, spreadMm: { w: profile.pageMm.w * 2, h: profile.pageMm.h }, spreads, issues };
}
