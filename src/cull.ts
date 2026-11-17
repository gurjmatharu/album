import { hamming } from "./lints";
import type { Person, Photo } from "./types";

export interface Select {
  id: string;
  /** Photos shot seconds apart that look alike share a burst id. */
  burst: string;
  /** 0..1, comparable inside one album only. */
  score: number;
  keep: boolean;
  reason: string;
}

export const BURST_SECONDS = 4;
export const BURST_BITS = 12;
/** A photo under this share of the album's median sharpness is dropped as blurred. */
export const BLUR_RATIO = 0.25;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/**
 * Code-only cull: group bursts, drop blurred frames, keep the best frame of each burst.
 * No model sees a photo this stage rejects.
 */
export function cull(photos: Photo[], people: Person[]): Select[] {
  const sorted = [...photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.path.localeCompare(b.path));
  const med = median(sorted.map((p) => p.sharpness)) || 1;
  const vip = new Set(people.filter((p) => p.minAppearances > 0).map((p) => p.id));

  const bursts: Photo[][] = [];
  for (const ph of sorted) {
    const last = bursts[bursts.length - 1];
    const prev = last?.[last.length - 1];
    const close = prev && (Date.parse(ph.takenAt) - Date.parse(prev.takenAt)) / 1000 <= BURST_SECONDS && hamming(ph.dhash, prev.dhash) <= BURST_BITS;
    if (close) last!.push(ph);
    else bursts.push([ph]);
  }

  const score = (ph: Photo): number => {
    const sharp = Math.min(ph.sharpness / (med * 2), 1);
    const known = new Set(ph.faces.map((f) => f.person).filter((x): x is string => !!x && vip.has(x)));
    const closed = ph.faces.filter((f) => f.eyesOpen !== undefined && f.eyesOpen < 0.3).length;
    return Math.max(0, Math.min(1, 0.6 * sharp + 0.1 * Math.min(known.size, 4) - 0.3 * closed));
  };

  const out: Select[] = [];
  for (const burst of bursts) {
    const id = burst[0]!.id;
    const ranked = [...burst].sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path));
    for (const ph of burst) {
      const s = Math.round(score(ph) * 1000) / 1000;
      const blurred = ph.sharpness < med * BLUR_RATIO;
      let reason = "kept";
      if (blurred) reason = `blurred: sharpness ${ph.sharpness} against a median of ${med}`;
      else if (ranked[0] !== ph) reason = `burst of ${burst.length}: ${ranked[0]!.path} scores higher`;
      out.push({ id: ph.id, burst: id, score: s, keep: reason === "kept", reason });
    }
  }
  return out;
}
