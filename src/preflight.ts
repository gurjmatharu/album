import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { CHECK_WIDTH, type RenderOutput } from "./render";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const PT_PER_MM = 72 / 25.4;
/** Chromium rounds page boxes to whole CSS pixels (1/96 in), so allow one of them. */
const TOLERANCE_PT = 0.8;

async function pdfChecks(label: string, file: string, count: number, widthMm: number, heightMm: number): Promise<Check[]> {
  const pdf = await PDFDocument.load(readFileSync(file));
  const pages = pdf.getPages();
  const wantW = widthMm * PT_PER_MM;
  const wantH = heightMm * PT_PER_MM;
  const off = pages
    .map((p, i) => ({ i: i + 1, ...p.getSize() }))
    .filter((p) => Math.abs(p.width - wantW) > TOLERANCE_PT || Math.abs(p.height - wantH) > TOLERANCE_PT);
  return [
    { name: `${label}: page count`, ok: pages.length === count, detail: `${pages.length} pages, expected ${count}` },
    {
      name: `${label}: page size`,
      ok: off.length === 0,
      detail: off.length ? `page ${off[0]!.i} is ${off[0]!.width.toFixed(1)} x ${off[0]!.height.toFixed(1)} pt, expected ${wantW.toFixed(1)} x ${wantH.toFixed(1)} pt (${off.length} pages off)` : `every page is ${wantW.toFixed(1)} x ${wantH.toFixed(1)} pt (${widthMm.toFixed(1)} x ${heightMm.toFixed(1)} mm)`,
    },
  ];
}

/** Mean absolute difference, 0-255, above which a PDF page does not look like its sheet. */
const MAX_DIFF = 10;

/**
 * The blur takes out resampling noise in fine detail (foliage scored 10.9 unblurred on a
 * correct page, 3.4 blurred) and keeps what the check is for: shifted or scaled content.
 */
async function grey(file: string, w: number, h: number): Promise<Buffer> {
  return sharp(file).flatten({ background: "#fff" }).resize(w, h, { fit: "fill" }).greyscale().blur(2).raw().toBuffer();
}

/**
 * Rasterize print.pdf and compare every page with the screenshot of the sheet it was made
 * from. Page boxes can be right while the content is scaled or shifted; this is the check
 * that sees it. Needs poppler's pdftoppm; without it the check fails and says so.
 */
async function looksLikeSheets(pdf: string): Promise<Check> {
  const name = "print.pdf: pages match the layout";
  const dir = join(dirname(pdf), "check");
  if (!Bun.which("pdftoppm")) return { name, ok: false, detail: "pdftoppm not found (install poppler): the PDF's content was not compared with the layout" };
  const run = Bun.spawnSync(["pdftoppm", "-png", "-scale-to-x", String(CHECK_WIDTH), "-scale-to-y", "-1", pdf, join(dir, "pdf")]);
  if (run.exitCode !== 0) return { name, ok: false, detail: `pdftoppm failed: ${run.stderr.toString().trim()}` };
  const sheets = readdirSync(dir).filter((f) => f.startsWith("sheet-")).sort();
  const pages = readdirSync(dir).filter((f) => f.startsWith("pdf-")).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
  if (sheets.length !== pages.length) return { name, ok: false, detail: `${pages.length} PDF pages against ${sheets.length} sheets` };
  let worst = { page: 0, diff: 0 };
  for (let i = 0; i < sheets.length; i++) {
    const meta = await sharp(join(dir, sheets[i]!)).metadata();
    const [a, b] = await Promise.all([grey(join(dir, sheets[i]!), meta.width!, meta.height!), grey(join(dir, pages[i]!), meta.width!, meta.height!)]);
    let sum = 0;
    for (let k = 0; k < a.length; k++) sum += Math.abs(a[k]! - b[k]!);
    const diff = sum / a.length;
    if (diff > worst.diff) worst = { page: i + 1, diff };
  }
  return { name, ok: worst.diff <= MAX_DIFF, detail: `largest difference ${worst.diff.toFixed(1)} of 255 on page ${worst.page}, limit ${MAX_DIFF}` };
}

/** Open what was written and confirm it is what the profile asked for. */
export async function preflight(out: RenderOutput): Promise<Check[]> {
  const checks: Check[] = [];
  const e = out.expected;
  checks.push(...(await pdfChecks("proof.pdf", out.proof, e.proof.count, e.proof.widthMm, e.proof.heightMm)));
  if (!e.print || !out.print) return checks;
  if (e.print.kind === "pdf") {
    checks.push(...(await pdfChecks("print.pdf", out.print, e.print.count, e.print.widthMm, e.print.heightMm)));
    checks.push(await looksLikeSheets(out.print));
  } else {
    const dir = out.print;
    const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
    checks.push({ name: "spreads: file count", ok: files.length === e.print.count, detail: `${files.length} JPEGs, expected ${e.print.count}` });
    const wantW = Math.round((e.print.widthMm / 25.4) * e.print.dpi);
    const wantH = Math.round((e.print.heightMm / 25.4) * e.print.dpi);
    const bad: string[] = [];
    for (const f of files) {
      const m = await sharp(join(dir, f)).metadata();
      if (Math.abs((m.width ?? 0) - wantW) > 2 || Math.abs((m.height ?? 0) - wantH) > 2) bad.push(`${f} is ${m.width} x ${m.height}`);
    }
    checks.push({ name: "spreads: pixel size", ok: bad.length === 0, detail: bad.length ? `${bad[0]}, expected ${wantW} x ${wantH} px (${bad.length} files off)` : `every spread is ${wantW} x ${wantH} px at ${e.print.dpi} dpi` });
  }
  return checks;
}
