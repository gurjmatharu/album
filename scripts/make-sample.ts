import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Face, PeopleFile } from "../src/types";
import { paths, writeJson } from "../src/work";

/** Deterministic PRNG so the sample is the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = [
  { id: "bride", name: "Bride", minAppearances: 3 },
  { id: "groom", name: "Groom", minAppearances: 3 },
  { id: "mom", name: "Mom", minAppearances: 1 },
  { id: "dad", name: "Dad", minAppearances: 1 },
];
const MOMENTS = [
  { name: "prep", hour: 13, frames: 10, hue: 30 },
  { name: "ceremony", hour: 15, frames: 14, hue: 200 },
  { name: "portraits", hour: 16.5, frames: 12, hue: 120 },
  { name: "dinner", hour: 18.5, frames: 10, hue: 280 },
  { name: "dancing", hour: 21, frames: 14, hue: 340 },
];

export interface SampleOptions {
  /** Long edge of a full-size frame in pixels. */
  longEdge?: number;
  /** Keep only every nth frame, for a quick small set. */
  every?: number;
}

/**
 * Write a synthetic wedding dump: five moments, bursts, a few blurred and low-resolution
 * frames, and drawn "faces" at known positions with matching faces.json and people.json.
 * It stands in for real photos and a real face worker so the whole pipeline can run anywhere.
 */
export async function makeSample(photoDir: string, work: string, opts: SampleOptions = {}): Promise<number> {
  const long = opts.longEdge ?? 6000;
  const every = opts.every ?? 1;
  const rand = rng(7);
  rmSync(photoDir, { recursive: true, force: true });
  mkdirSync(photoDir, { recursive: true });
  const faces: Record<string, Face[]> = {};
  let n = 0;
  let frame = 0;

  for (const m of MOMENTS) {
    for (let i = 0; i < m.frames; i++) {
      frame++;
      const portrait = rand() < 0.35;
      const lowRes = frame % 17 === 0;
      const blurred = frame % 13 === 0;
      const burst = frame % 4 === 0 ? 3 : 1;
      const count = Math.floor(rand() * 4);
      const cast = [...PEOPLE.map((p) => p.id), "", ""].sort(() => rand() - 0.5).slice(0, count);
      const boxes: Face[] = cast.map((person, k) => {
        const w = 0.07 + rand() * 0.05;
        const x = 0.08 + ((k + rand() * 0.6) / Math.max(count, 1)) * 0.8;
        return { x: Math.min(x, 0.9 - w), y: 0.2 + rand() * 0.25, w, h: 0, cluster: person ? `c-${person}` : `c-guest${frame}${k}` };
      });
      const texture = Array.from({ length: 260 }, () => ({ x: rand(), y: rand(), w: 0.004 + rand() * 0.03, h: 0.004 + rand() * 0.03, l: 25 + rand() * 55 }));
      if (frame % every !== 0) continue;

      const W = Math.round((lowRes ? long / 5 : long) * (portrait ? 2 / 3 : 1));
      const H = Math.round((lowRes ? long / 5 : long) * (portrait ? 1 : 2 / 3));
      for (const b of boxes) b.h = (b.w * W) / H;

      for (let shot = 0; shot < burst; shot++) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${m.hue},55%,72%)"/><stop offset="1" stop-color="hsl(${m.hue + 40},50%,28%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
${texture.map((t) => `<rect x="${t.x * W}" y="${t.y * H}" width="${t.w * W}" height="${t.h * H}" fill="hsl(${m.hue + 20},40%,${t.l}%)"/>`).join("")}
<text x="${W * 0.04}" y="${H * 0.95}" font-family="sans-serif" font-size="${H * 0.09}" fill="#fff">${m.name} ${String(frame).padStart(3, "0")}${shot ? "." + shot : ""}</text>
${boxes.map((b) => `<ellipse cx="${(b.x + b.w / 2) * W + shot * 2}" cy="${(b.y + b.h / 2) * H}" rx="${(b.w / 2) * W}" ry="${(b.h / 2) * H}" fill="#f2c9a5" stroke="#3a2a20" stroke-width="${W * 0.003}"/><text x="${(b.x + b.w / 2) * W}" y="${(b.y + b.h * 0.62) * H}" text-anchor="middle" font-family="sans-serif" font-size="${b.h * H * 0.3}" fill="#3a2a20">${(b.cluster ?? "").replace("c-", "").slice(0, 5)}</text>`).join("")}
</svg>`;
        const when = new Date(Date.UTC(2026, 5, 20, 0, 0, 0) + (m.hour * 3600 + i * 240 + shot) * 1000);
        const stamp = when.toISOString().slice(0, 19).replace("T", " ").replace(/-/g, ":");
        const file = join(photoDir, `${m.name}-${String(frame).padStart(3, "0")}${shot ? "-" + shot : ""}.jpg`);
        let img = sharp(Buffer.from(svg));
        if (blurred) img = img.blur(Math.max(2, W / 500));
        await img.jpeg({ quality: 88 }).withExif({ IFD2: { DateTimeOriginal: stamp } } as never).toFile(file);
        utimesSync(file, when, when);
        const id = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
        faces[id] = boxes.map((b) => ({ ...b }));
        n++;
      }
    }
  }

  const p = paths(work);
  const people: PeopleFile = { people: PEOPLE, clusters: Object.fromEntries(PEOPLE.map((x) => [`c-${x.id}`, x.id])) };
  writeJson(p.faces, faces);
  writeJson(p.people, people);
  return n;
}
