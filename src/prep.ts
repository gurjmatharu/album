import sharp from "sharp";

/**
 * Print prep: a light, consistent edit applied to each picture as it is cut for the print
 * file. It never touches the original and never makes a creative choice; it corrects what a
 * printed page does differently from a screen and what makes a spread look uneven:
 *
 * 1. Shadow lift on backlit and dark pictures, so faces in shade print with detail.
 * 2. White balance pulled part of the way toward the spread's average, so pictures that face
 *    each other share one colour of light (the golden hour stays golden).
 * 3. A small midtone lift for print, which reads darker than a lit screen.
 * 4. Output sharpening at the printed size, to offset paper and ink softening.
 *
 * Every number is bounded, so it cannot wreck a picture; the proof lists what was done.
 */

export interface PrepStats {
  /** Mean of each channel, 0..1, sRGB-encoded. */
  mean: [number, number, number];
  /** Luminance percentiles, 0..1. */
  p05: number;
  p25: number;
  p50: number;
  p95: number;
}

export interface Prep {
  /** Per-channel multipliers for white balance (applied in encoded RGB). */
  gain: [number, number, number];
  /** 0..MAX_SHADOW: how much the shadows are lifted. */
  shadow: number;
  /** Midtone exponent, under 1 brightens. */
  gamma: number;
}

/** Largest shadow lift: raises a quarter-tone by about 25 levels of 255 (a fully backlit picture). */
export const MAX_SHADOW = 0.22;
/** A picture whose 25th-percentile luminance is under this gets some shadow lift. */
export const SHADOW_START = 0.3;
/** Share of the gap to the spread's colour average that white balance closes. */
export const WB_PULL = 0.6;
/** No channel moves more than this fraction. */
export const MAX_GAIN = 0.06;
/** Midtone lift for print: 0.94 raises mid grey by about 5 levels. */
export const PRINT_GAMMA = 0.94;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Measure a picture on a small preview: channel means and luminance percentiles. */
export async function measure(file: string): Promise<PrepStats> {
  const { data, info } = await sharp(file).rotate().resize({ width: 512, withoutEnlargement: true }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    hist[Math.round(luma(data[i]!, data[i + 1]!, data[i + 2]!))]!++;
  }
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]!) >= q * n) return v / 255;
    return 1;
  };
  return { mean: [r / n / 255, g / n / 255, b / n / 255], p05: pct(0.05), p25: pct(0.25), p50: pct(0.5), p95: pct(0.95) };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The spread's colour of light: the mean of its pictures' channel means. */
export function spreadMean(stats: PrepStats[]): [number, number, number] {
  const m: [number, number, number] = [0, 0, 0];
  for (const s of stats) for (let c = 0; c < 3; c++) m[c]! += s.mean[c]! / stats.length;
  return m;
}

/** Decide the edit for one picture on a spread whose colour average is `target`. */
export function planPrep(s: PrepStats, target: [number, number, number]): Prep {
  // White balance: move each channel part of the way toward the spread's balance, keeping brightness.
  const own = luma(...s.mean) || 1e-6;
  const tgt = luma(...target) || 1e-6;
  const raw = [0, 1, 2].map((c) => {
    const want = target[c]! / tgt; // the channel's share of brightness on this spread
    const have = s.mean[c]! / own || 1e-6;
    return clamp(1 + WB_PULL * (want / have - 1), 1 - MAX_GAIN, 1 + MAX_GAIN);
  });
  const k = luma(raw[0]!, raw[1]!, raw[2]!); // renormalise so overall brightness is unchanged
  const gain = raw.map((x) => Math.round(clamp(x / k, 1 - MAX_GAIN, 1 + MAX_GAIN) * 1000) / 1000) as [number, number, number];

  // Shadow lift: by how far the quarter-tones sit below SHADOW_START, more when the highlights
  // are bright (a backlit picture) than when the whole picture is dark on purpose.
  const deficit = clamp((SHADOW_START - s.p25) / SHADOW_START, 0, 1);
  const backlit = clamp((s.p95 - 0.6) / 0.3, 0.4, 1);
  const shadow = Math.round(MAX_SHADOW * deficit * backlit * 1000) / 1000;
  return { gain, shadow, gamma: PRINT_GAMMA };
}

/** The tone curve on 0..1: shadow lift (zero at black and white, peak near a quarter-tone), then the print midtone lift. */
export function curve(x: number, p: Prep): number {
  const lifted = x + p.shadow * 4.2 * x * (1 - x) ** 3;
  return clamp(lifted, 0, 1) ** p.gamma;
}

/** One 256-entry lookup table per channel: white balance gain, then the tone curve. */
export function luts(p: Prep): [Uint8Array, Uint8Array, Uint8Array] {
  return [0, 1, 2].map((c) => {
    const t = new Uint8Array(256);
    for (let v = 0; v < 256; v++) t[v] = Math.round(curve(clamp((v / 255) * p.gain[c]!, 0, 1), p) * 255);
    return t;
  }) as [Uint8Array, Uint8Array, Uint8Array];
}

/** Apply the edit to an already cut and resized picture; sharpen for print last. */
export async function applyPrep(img: sharp.Sharp, p: Prep): Promise<sharp.Sharp> {
  const { data, info } = await img.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const [lr, lg, lb] = luts(p);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = lr[data[i]!]!;
    data[i + 1] = lg[data[i + 1]!]!;
    data[i + 2] = lb[data[i + 2]!]!;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.6 });
}

/** One line for the proof: what was done to this picture. */
export function describePrep(p: Prep): string {
  const parts = [`print lift`];
  if (p.shadow > 0.005) parts.push(`shadows +${Math.round((p.shadow / MAX_SHADOW) * 100)}%`);
  const wb = p.gain.map((g) => Math.round((g - 1) * 100));
  if (wb.some((x) => x !== 0)) parts.push(`balance R${wb[0]! >= 0 ? "+" : ""}${wb[0]} G${wb[1]! >= 0 ? "+" : ""}${wb[1]} B${wb[2]! >= 0 ? "+" : ""}${wb[2]}%`);
  return parts.join(", ");
}
