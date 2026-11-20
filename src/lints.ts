import type { Layout } from "./layout";
import { CAST_LIMIT, LIGHT_LIMIT, isMono, themeById, toneGap } from "./themes";
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

  const theme = themeById(spec.theme);
  if (!theme) err("unknown-theme", `no theme "${spec.theme}"`);

  const used: { photo: Photo; spread: string; slot: string }[] = [];
  const appearances = new Map<string, number>();
  let lastTime = -Infinity;
  let lastSpread = "";
  let run = 1;

  layout.spreads.forEach((sp, i) => {
    const prev = layout.spreads[i - 1];
    run = prev && prev.template.id === sp.template.id ? run + 1 : 1;
    if (run === 3) warn("pacing", `spread ${sp.id}: third ${sp.template.id} in a row`, { spread: sp.id });

    // Type inside the safe area and off the fold, or the lab's trim and the binding eat it.
    const W = layout.spreadMm.w, H = layout.spreadMm.h, g = p.gutterSafeMm;
    for (const t of sp.text) {
      const r = t.rect;
      const out = Math.max(p.safeMm - r.x, p.safeMm - r.y, r.x + r.w - (W - p.safeMm), r.y + r.h - (H - p.safeMm));
      if (out > 0.01) err("text-outside-safe", `spread ${sp.id}: text box ${t.def.id} runs ${out.toFixed(1)} mm outside the ${p.safeMm} mm safe margin`, { spread: sp.id });
      if (r.x < W / 2 + g && r.x + r.w > W / 2 - g) err("text-on-fold", `spread ${sp.id}: text box ${t.def.id} crosses the fold band (${g} mm either side)`, { spread: sp.id });
    }

    if (theme && !theme.templates.includes(sp.template.id)) {
      err("off-theme", `spread ${sp.id}: template ${sp.template.id} is not part of the ${theme.id} theme`, { spread: sp.id });
    }

    // Continuity across the two pages: one spread is one picture made of several.
    const mono = sp.slots.filter((s) => isMono(s.photo));
    if (mono.length > 0 && mono.length < sp.slots.length) {
      err("mixed-mono", `spread ${sp.id}: black-and-white (${mono.map((s) => s.photo.path).join(", ")}) mixed with colour`, { spread: sp.id });
    } else {
      let worst: { cast: number; light: number; a: string; b: string } | undefined;
      for (const a of sp.slots) {
        for (const b of sp.slots) {
          const gap = a === b ? undefined : toneGap(a.photo, b.photo);
          if (gap && (!worst || gap.cast / CAST_LIMIT + gap.light / LIGHT_LIMIT > worst.cast / CAST_LIMIT + worst.light / LIGHT_LIMIT)) worst = { ...gap, a: a.photo.path, b: b.photo.path };
        }
      }
      if (worst && worst.cast > CAST_LIMIT) warn("spread-colour", `spread ${sp.id}: ${worst.a} and ${worst.b} differ in colour cast by ${worst.cast.toFixed(0)} (limit ${CAST_LIMIT})`, { spread: sp.id });
      if (worst && worst.light > LIGHT_LIMIT) warn("spread-light", `spread ${sp.id}: ${worst.a} and ${worst.b} differ in lightness by ${worst.light.toFixed(0)} (limit ${LIGHT_LIMIT})`, { spread: sp.id });
    }

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
        const fold = p.pageMm.w;
        const onLeft = s.rect.x + s.rect.w <= fold + 0.01;
        const onRight = s.rect.x >= fold - 0.01;
        if ((onLeft && f.gaze === "left") || (onRight && f.gaze === "right")) {
          warn("gaze-off-page", `${where}: ${who} looks off the ${f.gaze} edge, away from the facing page`, at);
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
