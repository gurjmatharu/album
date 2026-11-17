import type { Layout } from "./layout";
import type { AlbumSpec, Issue, Photo } from "./types";

/** Hamming distance between two 64-bit hashes given as 16 hex chars. */
export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const NEAR_DUPLICATE_BITS = 6;
export const NEAR_DUPLICATE_SECONDS = 20;

/** Two frames of the same moment: almost the same picture, seconds apart. */
export function nearDuplicate(a: Photo, b: Photo): boolean {
  const dt = Math.abs(Date.parse(a.takenAt) - Date.parse(b.takenAt)) / 1000;
  return dt <= NEAR_DUPLICATE_SECONDS && hamming(a.dhash, b.dhash) <= NEAR_DUPLICATE_BITS;
}

/**
 * Every check a script can make. Errors block the build; warnings are printed and go in the
 * proof. Each message names the spread, the slot, the photo and the number.
 */
export function lint(spec: AlbumSpec, layout: Layout): Issue[] {
  const out: Issue[] = [...layout.issues];
  const p = layout.profile;
  const err = (rule: string, message: string, at: Partial<Issue> = {}) => out.push({ severity: "error", rule, message, ...at });
  const warn = (rule: string, message: string, at: Partial<Issue> = {}) => out.push({ severity: "warning", rule, message, ...at });

  const pages = spec.spreads.length * 2;
  if (pages < p.pages.min || pages > p.pages.max) {
    err("page-count", `${pages} pages; ${p.id} takes ${p.pages.min}-${p.pages.max}`);
  }
  if (pages % p.pages.multiple !== 0) err("page-count", `${pages} pages is not a multiple of ${p.pages.multiple}`);
  if (!p.verified) warn("profile-unverified", `print profile ${p.id} has not been checked against the lab's spec: ${p.notes}`);

  const used: { photo: Photo; spread: string; slot: string }[] = [];
  const appearances = new Map<string, number>();
  let lastTime = -Infinity;
  let lastSpread = "";
  let run = 1;

  layout.spreads.forEach((sp, i) => {
    const prev = layout.spreads[i - 1];
    run = prev && prev.template.id === sp.template.id ? run + 1 : 1;
    if (run === 3) warn("pacing", `spread ${sp.id}: third ${sp.template.id} in a row`, { spread: sp.id });

    const times = sp.slots.map((s) => Date.parse(s.photo.takenAt)).sort((a, b) => a - b);
    const mid = times[Math.floor(times.length / 2)];
    if (mid !== undefined) {
      if (mid < lastTime) warn("chronology", `spread ${sp.id} is earlier in the day than spread ${lastSpread}`, { spread: sp.id });
      lastTime = mid;
      lastSpread = sp.id;
    }

    for (const s of sp.slots) {
      const at = { spread: sp.id, slot: s.def.id, photo: s.photo.id };
      const where = `spread ${sp.id} slot ${s.def.id} (${s.photo.path})`;

      for (const u of used) {
        if (u.photo.id === s.photo.id) err("duplicate", `${where}: same photo as spread ${u.spread} slot ${u.slot}`, at);
        else if (nearDuplicate(u.photo, s.photo)) {
          err("near-duplicate", `${where}: near-duplicate of ${u.photo.path} in spread ${u.spread} (hash distance ${hamming(u.photo.dhash, s.photo.dhash)})`, at);
        }
      }
      used.push({ photo: s.photo, spread: sp.id, slot: s.def.id });

      const dpi = Math.round(s.effDpi);
      if (s.effDpi < p.minDpi) err("resolution", `${where}: ${dpi} dpi at printed size, minimum ${p.minDpi}`, at);
      else if (s.effDpi < p.dpi * 0.8) warn("resolution", `${where}: ${dpi} dpi at printed size, target ${p.dpi}`, at);

      if (s.kept < 0.5) warn("heavy-crop", `${where}: only ${Math.round(s.kept * 100)}% of the photo survives the crop`, at);

      const seen = new Set<string>();
      for (const f of s.faces) {
        const who = f.person ?? "a face";
        if (f.onFold) err("face-on-fold", `${where}: ${who} sits on the fold`, at);
        else if (f.cut) err("face-cut", `${where}: ${who} is cut by the crop or the trim`, at);
        else {
          if (f.nearTrim) warn("face-near-trim", `${where}: ${who} is within ${p.safeMm} mm of the trim`, at);
          if (f.person) seen.add(f.person);
        }
        if (f.eyesOpen !== undefined && f.eyesOpen < 0.3) {
          (s.def.hero ? err : warn)("eyes-closed", `${where}: ${who} has eyes closed (${f.eyesOpen.toFixed(2)})`, at);
        }
      }
      for (const id of seen) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    }
  });

  for (const person of spec.people) {
    const n = appearances.get(person.id) ?? 0;
    if (n < person.minAppearances) err("coverage", `${person.name} appears in ${n} slots, needs ${person.minAppearances}`);
  }
  return out;
}

export function summarize(issues: Issue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
