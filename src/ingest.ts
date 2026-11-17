import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import type { Photo } from "./types";
import { paths, readJson, writeJson } from "./work";

const READABLE = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
/** Formats a wedding dump contains that this build cannot decode yet. */
const UNSUPPORTED = new Set([".heic", ".heif", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

/** Variance of the 4-neighbour Laplacian. */
export function laplacianVariance(grey: Uint8Array, w: number, h: number): number {
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - w]! - grey[i + w]!;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

/** Difference hash: 8 rows of 8 "left pixel brighter than right" bits. */
export function dhashFromGrey(grey: Uint8Array): string {
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (grey[y * 9 + x]! > grey[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

async function measure(file: string, rel: string): Promise<Photo> {
  const stat = statSync(file);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  const meta = await sharp(file).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;

  const preview = await sharp(file).rotate().resize(512, 512, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const sharpness = laplacianVariance(preview.data, preview.info.width, preview.info.height);
  const tiny = await sharp(file).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();

  let taken: Date | undefined;
  try {
    const exif = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime())) taken = d;
  } catch {
    // No readable EXIF: fall back to the file time below.
  }

  return {
    id: sha.slice(0, 10),
    path: rel,
    sha,
    bytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    width,
    height,
    takenAt: (taken ?? stat.mtime).toISOString(),
    timeSource: taken ? "exif" : "mtime",
    sharpness: Math.round(sharpness * 100) / 100,
    dhash: dhashFromGrey(tiny),
    faces: [],
  };
}

export interface IngestResult {
  photos: Photo[];
  measured: number;
  reused: number;
  unsupported: string[];
  failed: { path: string; error: string }[];
}

/** Read every photo under `dir` into photos.json. A file already measured (same path, size, mtime) is reused. */
export async function ingest(dir: string, work: string): Promise<IngestResult> {
  const p = paths(work);
  const before = new Map<string, Photo>();
  if (existsSync(p.photos)) for (const ph of readJson<Photo[]>(p.photos)) before.set(ph.path, ph);

  const result: IngestResult = { photos: [], measured: 0, reused: 0, unsupported: [], failed: [] };
  for (const file of walk(dir)) {
    const ext = extname(file).toLowerCase();
    const rel = relative(dir, file);
    if (UNSUPPORTED.has(ext)) {
      result.unsupported.push(rel);
      continue;
    }
    if (!READABLE.has(ext)) continue;
    const stat = statSync(file);
    const old = before.get(rel);
    if (old && old.bytes === stat.size && old.mtimeMs === Math.round(stat.mtimeMs)) {
      result.photos.push({ ...old, faces: [] });
      result.reused++;
      continue;
    }
    try {
      result.photos.push(await measure(file, rel));
      result.measured++;
    } catch (e) {
      result.failed.push({ path: rel, error: e instanceof Error ? e.message : String(e) });
    }
  }
  result.photos.sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.path.localeCompare(b.path));
  writeJson(p.photos, result.photos);
  writeJson(p.source, { dir });
  return result;
}
