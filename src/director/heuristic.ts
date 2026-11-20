import { CATALOG, type SlotDef, type Template } from "../catalog";
import { slotRectMm, solveCrop } from "../layout";
import { CAST_LIMIT, LIGHT_LIMIT, isMono, themeById, toneGap } from "../themes";
import type { AlbumSpec, Person, Photo, Profile } from "../types";

export interface DirectOptions {
  title: string;
  profile: Profile;
  /** Number of spreads to fill. */
  spreads: number;
  people: Person[];
  /** Theme id from src/themes.ts. */
  theme: string;
  /** A pause longer than this many minutes starts a new chapter. */
  chapterGapMin?: number;
}

/** Split the day into chapters at the longest pauses, never more chapters than spreads. */
export function chapters(photos: Photo[], gapMin: number, max: number): Photo[][] {
  const sorted = [...photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.path.localeCompare(b.path));
  const gaps = sorted.slice(1).map((p, i) => ({ at: i + 1, min: (Date.parse(p.takenAt) - Date.parse(sorted[i]!.takenAt)) / 60000 }));
  const cuts = gaps
    .filter((g) => g.min > gapMin)
    .sort((a, b) => b.min - a.min)
    .slice(0, Math.max(0, max - 1))
    .map((g) => g.at)
    .sort((a, b) => a - b);
  const out: Photo[][] = [];
  let start = 0;
  for (const c of [...cuts, sorted.length]) {
    if (c > start) out.push(sorted.slice(start, c));
    start = c;
  }
  return out;
}

/** Spreads per chapter: by the square root of its size, at least one, summing to `total`. */
export function allocate(sizes: number[], total: number): number[] {
  const weights = sizes.map((n) => Math.sqrt(n));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const cap = sizes.map((n) => Math.max(1, Math.floor(n / 2)));
  const out = weights.map((w, i) => Math.min(cap[i]!, Math.max(1, Math.round((total * w) / sum))));
  const room = (i: number) => cap[i]! - out[i]!;
  for (let guard = 0; guard < 1000; guard++) {
    const have = out.reduce((a, b) => a + b, 0);
    if (have === total) break;
    if (have < total) {
      const i = out.map((_, j) => j).filter((j) => room(j) > 0).sort((a, b) => sizes[b]! / out[b]! - sizes[a]! / out[a]!)[0];
      if (i === undefined) break; // not enough photos for more spreads
      out[i]!++;
    } else {
      const i = out.map((_, j) => j).filter((j) => out[j]! > 1).sort((a, b) => sizes[a]! / out[a]! - sizes[b]! / out[b]!)[0];
      if (i === undefined) break;
      out[i]!--;
    }
  }
  return out;
}

function split<T>(items: T[], parts: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < parts; i++) out.push(items.slice(Math.floor((i * items.length) / parts), Math.floor(((i + 1) * items.length) / parts)));
  return out;
}

interface Fill {
  template: Template;
  slots: { slot: string; photo: string }[];
  cost: number;
}

function fill(template: Template, group: Photo[], score: (id: string) => number, profile: Profile): Fill {
  const order = [...template.slots].sort((a, b) => Number(b.hero) - Number(a.hero) || b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  const pool = [...group].sort((a, b) => score(b.id) - score(a.id));
  const chosen = new Map<string, Photo>();
  let cost = 0;
  /** How badly a photo would break the spread's continuity with the photos already on it. */
  const clash = (ph: Photo): number => {
    let c = 0;
    for (const other of chosen.values()) {
      if (isMono(ph) !== isMono(other)) c += 5;
      const gap = toneGap(ph, other);
      if (gap) c += gap.cast / CAST_LIMIT + gap.light / LIGHT_LIMIT;
    }
    return chosen.size ? c / chosen.size : 0;
  };
  const slotCost = (def: SlotDef, ph: Photo): number => {
    const r = slotRectMm(def, profile);
    const placed = solveCrop(ph, def, profile);
    const bad = placed.faces.filter((f) => f.cut || f.onFold).length;
    const lowRes = placed.effDpi < profile.minDpi ? 5 : 0;
    const away = placed.faces.filter((f) => (r.x + r.w <= profile.pageMm.w + 0.01 && f.gaze === "left") || (r.x >= profile.pageMm.w - 0.01 && f.gaze === "right")).length;
    return Math.abs(Math.log(ph.width / ph.height / (r.w / r.h))) + (1 - placed.kept) + 5 * bad + lowRes + 0.4 * away + clash(ph) - (def.hero ? 1 : 0.5) * score(ph.id);
  };
  for (const def of order) {
    let best: { ph: Photo; c: number } | undefined;
    for (const ph of pool) {
      if ([...chosen.values()].includes(ph)) continue;
      const c = slotCost(def, ph);
      if (!best || c < best.c) best = { ph, c };
    }
    if (!best) break;
    chosen.set(def.id, best.ph);
    cost += best.c;
  }
  return {
    template,
    slots: template.slots.filter((d) => chosen.has(d.id)).map((d) => ({ slot: d.id, photo: chosen.get(d.id)!.id })),
    cost: cost / template.slots.length - 0.12 * template.slots.length,
  };
}

/**
 * The $0 director: chapters by time, spreads by chapter size, the theme's template that fits
 * each group's shapes with no face cut or on the fold, filled with pictures that sit together
 * in colour and light. It has no taste; it is the baseline a model
 * director has to beat, and what the pipeline runs on with no API key.
 */
export function directHeuristic(photos: Photo[], scores: Map<string, number>, opts: DirectOptions): AlbumSpec {
  const score = (id: string) => scores.get(id) ?? 0;
  const theme = themeById(opts.theme);
  if (!theme) throw new Error(`no theme "${opts.theme}"`);
  const parts = chapters(photos, opts.chapterGapMin ?? 30, opts.spreads);
  const counts = allocate(parts.map((p) => p.length), opts.spreads);
  const spreads: AlbumSpec["spreads"] = [];
  const recent: string[] = [];

  parts.forEach((part, ci) => {
    const groups = split(part, counts[ci]!);
    groups.forEach((group, gi) => {
      const first = spreads.length === 0;
      const last = ci === parts.length - 1 && gi === groups.length - 1;
      let best: Fill | undefined;
      for (const t of CATALOG) {
        if (!theme.templates.includes(t.id) || t.slots.length > group.length) continue;
        if ((t.place === "first" && !first) || (t.place === "last" && !last)) continue;
        if (t.sequence || t.cover) continue; // a run of one moment is a director's choice, not a shape fit
        const f = fill(t, group, score, opts.profile);
        if (f.slots.length < t.slots.length) continue;
        if (recent[recent.length - 1] === t.id) f.cost += 1.5;
        else if (recent[recent.length - 2] === t.id) f.cost += 0.5;
        if (!best || f.cost < best.cost) best = f;
      }
      if (!best) return;
      recent.push(best.template.id);
      spreads.push({
        id: `s${String(spreads.length + 1).padStart(2, "0")}`,
        chapter: `Chapter ${ci + 1}`,
        template: best.template.id,
        ...(best.template.place === "first" && best.template.text?.some((x) => x.id === "title") ? { text: { title: opts.title } } : {}),
        slots: best.slots,
      });
    });
  });

  return { version: 1, title: opts.title, profile: opts.profile.id, theme: theme.id, background: theme.background, people: opts.people, spreads };
}
