import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { Layout, PlacedSlot, PlacedSpread } from "./layout";
import { applyPrep, describePrep, measure, planPrep, spreadMean, type Prep, type PrepStats } from "./prep";
import type { AlbumSpec, Issue, Profile } from "./types";

const mm = (n: number) => `${n.toFixed(3)}mm`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Cut and resample one slot's picture to its printed size at the profile's resolution.
 * Never upscales. The file name is a hash of everything that decides its pixels, so a second
 * run reuses it.
 */
async function asset(slot: PlacedSlot, profile: Profile, sourceDir: string, cacheDir: string, prep?: Prep): Promise<string> {
  const crop = {
    left: Math.max(0, Math.round(slot.crop.x)),
    top: Math.max(0, Math.round(slot.crop.y)),
    width: Math.round(slot.crop.w),
    height: Math.round(slot.crop.h),
  };
  crop.width = Math.min(crop.width, slot.photo.width - crop.left);
  crop.height = Math.min(crop.height, slot.photo.height - crop.top);
  const target = Math.min(crop.width, Math.round((slot.rect.w / 25.4) * profile.dpi));
  const key = createHash("sha256").update(JSON.stringify([slot.photo.sha, crop, target, 1, prep ?? null])).digest("hex").slice(0, 20);
  const file = join(cacheDir, `${key}.jpg`);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    let img = sharp(join(sourceDir, slot.photo.path)).rotate().extract(crop).resize({ width: target }).toColourspace("srgb");
    if (prep) img = await applyPrep(img, prep);
    await img.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toFile(file);
  }
  return file;
}

/** Ink for type on a page of this colour: near-black on light paper, warm white on dark. */
function ink(bg: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg.trim());
  const l = m ? (0.2126 * parseInt(m[1]!, 16) + 0.7152 * parseInt(m[2]!, 16) + 0.0722 * parseInt(m[3]!, 16)) / 255 : 1;
  return l > 0.5 ? "#1d1b19" : "#f2ede6";
}

function spreadHtml(sp: PlacedSpread, files: Map<PlacedSlot, string>, layout: Layout, guides: boolean, bg: string): string {
  const b = layout.profile.bleedMm;
  const { w: W, h: H } = layout.spreadMm;
  const imgs = sp.slots
    .map((s) => `<img src="${pathToFileURL(files.get(s)!).href}" style="left:${mm(s.rect.x + b)};top:${mm(s.rect.y + b)};width:${mm(s.rect.w)};height:${mm(s.rect.h)}">`)
    .join("");
  const just = { top: "flex-start", bottom: "flex-end", middle: "center" } as const;
  const words = sp.text
    .map((t) => `<div class="tx tx-${t.def.role}" style="left:${mm(t.rect.x + b)};top:${mm(t.rect.y + b)};width:${mm(t.rect.w)};height:${mm(t.rect.h)};text-align:${t.def.align};justify-content:${just[t.def.anchor]};color:${ink(bg)}"><span>${esc(t.value).replace(/\n/g, "<br>")}</span></div>`)
    .join("");
  let over = "";
  if (guides) {
    const g = layout.profile.gutterSafeMm;
    const s = layout.profile.safeMm;
    over += `<div class="g trim" style="left:${mm(b)};top:${mm(b)};width:${mm(W)};height:${mm(H)}"></div>`;
    over += `<div class="g safe" style="left:${mm(b + s)};top:${mm(b + s)};width:${mm(W - 2 * s)};height:${mm(H - 2 * s)}"></div>`;
    over += `<div class="g fold" style="left:${mm(b + W / 2 - g)};top:0;width:${mm(2 * g)};height:${mm(H + 2 * b)}"></div>`;
    for (const sl of sp.slots) {
      for (const f of sl.faces) {
        const bad = f.cut || f.onFold;
        over += `<div class="g face${bad ? " bad" : ""}" style="left:${mm(f.rect.x + b)};top:${mm(f.rect.y + b)};width:${mm(f.rect.w)};height:${mm(f.rect.h)}"></div>`;
      }
    }
  }
  return `<div class="spread" style="width:${mm(W + 2 * b)};height:${mm(H + 2 * b)}">${imgs}${words}${over}</div>`;
}

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff}
/* overflow:clip + contain, not overflow:hidden: with hidden, Chromium's print layout still measures the
   clipped spread and shrinks the whole page to fit it. */
.sheet{position:relative;overflow:clip;contain:layout paint size;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}
.spread{position:absolute;top:0}
.spread img{position:absolute;display:block}
.g{position:absolute;pointer-events:none}
/* Type. System faces on macOS, embedded in the PDF by Chromium; the fallbacks keep it readable elsewhere. */
.tx{position:absolute;display:flex;flex-direction:column;font-kerning:normal;font-variant-ligatures:common-ligatures}
.tx-display{font-family:"Didot","Bodoni 72",Georgia,serif;font-size:92pt;line-height:.92;letter-spacing:-.015em;font-weight:400}
.tx-subtitle{font-family:"Didot","Bodoni 72",Georgia,serif;font-style:italic;font-size:21pt;line-height:1.3}
.tx-kicker{font-family:"Avenir Next","Avenir",Helvetica,sans-serif;font-size:9pt;line-height:1.6;letter-spacing:.34em;text-transform:uppercase;font-weight:500}
.tx-caption{font-family:"Avenir Next","Avenir",Helvetica,sans-serif;font-size:8.5pt;line-height:1.6;letter-spacing:.04em;opacity:.7}
.trim{border:0.3mm solid #e11}
.safe{border:0.3mm dashed #1a4}
.fold{background:rgba(0,90,255,.18)}
.face{border:0.4mm solid #1a4}
.face.bad{border-color:#e11;background:rgba(238,17,17,.25)}
`;

function doc(css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}

/** The file the lab prints: one PDF page per page, or per spread, with bleed and no marks. */
function printHtml(layout: Layout, files: Map<PlacedSlot, string>, bg: string): { html: string; widthMm: number; heightMm: number; sheets: number } {
  const p = layout.profile;
  const b = p.bleedMm;
  const h = layout.spreadMm.h + 2 * b;
  const byPage = p.export === "pdf-pages";
  const w = byPage ? p.pageMm.w + 2 * b : layout.spreadMm.w + 2 * b;
  const sheets: string[] = [];
  for (const sp of layout.spreads) {
    const offsets = byPage ? [0, -p.pageMm.w] : [0];
    for (const off of offsets) {
      const paper = sp.background ?? bg;
      sheets.push(`<div class="sheet" style="width:${mm(w)};height:${mm(h)};background:${paper}">${spreadHtml(sp, files, layout, false, paper).replace('class="spread" style="', `class="spread" style="left:${mm(off)};`)}</div>`);
    }
  }
  return { html: doc(`@page{size:${mm(w)} ${mm(h)};margin:0}`, sheets.join("")), widthMm: w, heightMm: h, sheets: sheets.length };
}

/** The file a person reads: a summary page, then every spread with trim, safe zone, fold and faces drawn on. */
function proofHtml(spec: AlbumSpec, layout: Layout, files: Map<PlacedSlot, string>, issues: Issue[], preps: Map<PlacedSlot, Prep>, before: PlacedSpread[] = [], after: PlacedSpread[] = []): { html: string; widthMm: number; heightMm: number; sheets: number } {
  const p = layout.profile;
  const b = p.bleedMm;
  const pad = 12;
  const foot = 34;
  const w = layout.spreadMm.w + 2 * b + 2 * pad;
  const h = layout.spreadMm.h + 2 * b + 2 * pad + foot;
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const li = (i: Issue) => `<li class="${i.severity}"><b>${esc(i.rule)}</b> ${esc(i.message)}</li>`;
  const photos = layout.spreads.reduce((n, s) => n + s.slots.length, 0);
  const cover = `<div class="sheet text" style="width:${mm(w)};height:${mm(h)}">
<h1>${esc(spec.title)}</h1>
<p>${layout.spreads.length} spreads, ${layout.spreads.length * 2} pages, ${photos} photos. Profile <b>${esc(p.id)}</b>: page ${p.pageMm.w} x ${p.pageMm.h} mm, bleed ${p.bleedMm} mm, ${p.dpi} dpi, export ${p.export}${p.verified ? "" : " (not verified against the lab)"}. Print prep: ${spec.prep === "off" ? "off, pictures as delivered" : "auto (shadow lift, spread white balance, print midtone lift, output sharpening; originals untouched)"}.</p>
<p class="${errors.length ? "error" : "ok"}">${errors.length ? `${errors.length} errors: this album is not ready to print.` : "No lint errors."} ${warnings.length} warnings.</p>
<p>Red line: trim. Green dashes: safe zone. Blue band: fold. Green boxes: faces; red boxes: faces cut or on the fold.</p>
<ul>${[...errors, ...warnings].slice(0, 60).map(li).join("")}</ul></div>`;
  const label = (sp: PlacedSpread) =>
    sp.id === "cover" ? "left page: back cover, right page: front cover" : sp.id === "firstPage" ? "first content page: the right-hand page only (facing the blank inside front cover)" : sp.id === "lastPage" ? "last content page: the left-hand page only (facing the blank inside back cover)" : esc(sp.chapter);
  const sheets = [...before, ...layout.spreads, ...after].map((sp) => {
    const mine = issues.filter((i) => i.spread === sp.id);
    const rows = sp.slots
      .map((s) => `${s.def.id}: ${esc(s.photo.path)} ${Math.round(s.effDpi)} dpi${s.faces.filter((f) => f.person).length ? " [" + s.faces.map((f) => f.person).filter(Boolean).join(", ") + "]" : ""}${preps.get(s) ? ` (${esc(describePrep(preps.get(s)!))})` : ""}`)
      .join(" &nbsp;|&nbsp; ");
    return `<div class="sheet" style="width:${mm(w)};height:${mm(h)}">
<div style="position:absolute;left:${mm(pad)};top:${mm(pad)};width:${mm(layout.spreadMm.w + 2 * b)};height:${mm(layout.spreadMm.h + 2 * b)};background:${sp.background ?? spec.background};outline:0.2mm solid #999">${spreadHtml(sp, files, layout, true, sp.background ?? spec.background)}</div>
<div class="foot" style="left:${mm(pad)};top:${mm(pad + layout.spreadMm.h + 2 * b + 3)};width:${mm(w - 2 * pad)}"><b>${esc(sp.id)}</b> ${label(sp)} · ${esc(sp.template.id)}<br>${rows}${mine.length ? `<ul>${mine.map(li).join("")}</ul>` : ""}</div></div>`;
  });
  const css = `@page{size:${mm(w)} ${mm(h)};margin:0}
body{font:11pt/1.35 system-ui,sans-serif;color:#111}
.text{padding:18mm}.text h1{font-size:30pt;margin-bottom:6mm}.text p{margin-bottom:4mm;max-width:400mm}
ul{margin-left:6mm}li{margin-bottom:1mm}.error{color:#c00}.warning{color:#946200}.ok{color:#0a6b2c}
.foot{position:absolute;font-size:9pt}.spread{left:0}`;
  return { html: doc(css, cover + sheets.join("")), widthMm: w, heightMm: h, sheets: sheets.length + 1 };
}

/** Width in pixels of the comparison images preflight uses. */
export const CHECK_WIDTH = 240;

async function launch(): Promise<Browser> {
  const bundled = "/opt/pw-browsers/chromium";
  const executablePath = process.env.ALBUM_CHROMIUM ?? (existsSync(bundled) ? bundled : undefined);
  return chromium.launch({ executablePath });
}

export interface RenderOutput {
  /** The print file, or the directory of spread JPEGs. Absent when the print file was withheld. */
  print?: string;
  proof: string;
  expected: {
    print?: { kind: "pdf" | "jpg"; count: number; widthMm: number; heightMm: number; dpi: number };
    proof: { count: number; widthMm: number; heightMm: number };
    /** cover.pdf, spine.pdf, book.pdf: each checked for page count and size. */
    extras?: { label: string; file: string; count: number; widthMm: number; heightMm: number }[];
  };
}

/** Pages cut from one spread, in the order given ("R" = right half, "L" = left half), each a page plus bleed. */
function halvesHtml(sp: PlacedSpread, halves: ("L" | "R")[], layout: Layout, files: Map<PlacedSlot, string>, bg: string): { html: string; widthMm: number; heightMm: number } {
  const p = layout.profile;
  const b = p.bleedMm;
  const w = p.pageMm.w + 2 * b;
  const h = layout.spreadMm.h + 2 * b;
  const paper = sp.background ?? bg;
  const sheets = halves.map((side) => (side === "R" ? -p.pageMm.w : 0)).map(
    (off) => `<div class="sheet" style="width:${mm(w)};height:${mm(h)};background:${paper}">${spreadHtml(sp, files, layout, false, paper).replace('class="spread" style="', `class="spread" style="left:${mm(off)};`)}</div>`,
  );
  return { html: doc(`@page{size:${mm(w)} ${mm(h)};margin:0}`, sheets.join("")), widthMm: w, heightMm: h };
}

/** The spine: one page, its width from the lab, the words running top to bottom as the book lies face up. */
function spineHtml(spec: AlbumSpec, layout: Layout): { html: string; widthMm: number; heightMm: number } | undefined {
  const sp = spec.cover?.spine;
  if (!sp) return undefined;
  const b = layout.profile.bleedMm;
  const w = sp.widthMm + 2 * b;
  const h = layout.spreadMm.h + 2 * b;
  const paper = sp.background ?? spec.cover?.background ?? spec.background;
  const size = Math.max(5, Math.min(9, sp.widthMm * 0.45 * 2.835)); // pt: about 45% of the spine's width, 5 to 9 pt
  const words = esc(sp.text ?? spec.title);
  const body = `<div class="sheet" style="width:${mm(w)};height:${mm(h)};background:${paper}"><div class="tx tx-kicker" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;font-size:${size.toFixed(1)}pt;color:${ink(paper)}"><span>${words}</span></div></div>`;
  return { html: doc(`@page{size:${mm(w)} ${mm(h)};margin:0}`, body), widthMm: w, heightMm: h };
}

/** Always writes proof.pdf. Writes the print file only when `withPrint` is set (the caller withholds it on lint errors). */
/** The parts of the book outside the spreads, each laid out like a spread (layout.ts). */
export interface BookParts {
  cover?: Layout;
  firstPage?: Layout;
  lastPage?: Layout;
}

export async function render(spec: AlbumSpec, layout: Layout, issues: Issue[], sourceDir: string, cacheDir: string, outDir: string, withPrint: boolean, parts: BookParts = {}): Promise<RenderOutput> {
  const cover = parts.cover?.spreads[0];
  const first = parts.firstPage?.spreads[0];
  const last = parts.lastPage?.spreads[0];
  const groups = [...layout.spreads, ...[cover, first, last].filter((x): x is PlacedSpread => !!x)];
  const p = layout.profile;
  mkdirSync(outDir, { recursive: true });
  const files = new Map<PlacedSlot, string>();
  // Print prep (prep.ts): measure every picture, balance each spread toward its own colour of light.
  const preps = new Map<PlacedSlot, Prep>();
  if (spec.prep !== "off") {
    const stats = new Map<string, PrepStats>();
    for (const sp of groups) for (const s of sp.slots) if (!stats.has(s.photo.id)) stats.set(s.photo.id, await measure(join(sourceDir, s.photo.path)));
    for (const sp of groups) {
      const target = spreadMean(sp.slots.map((s) => stats.get(s.photo.id)!));
      for (const s of sp.slots) preps.set(s, planPrep(stats.get(s.photo.id)!, target));
    }
  }
  for (const sp of groups) for (const s of sp.slots) files.set(s, await asset(s, p, sourceDir, cacheDir, preps.get(s)));

  const browser = await launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const toPdf = async (html: string, name: string, w: number, h: number) => {
      const htmlPath = join(outDir, name.replace(/\.pdf$/, ".html"));
      writeFileSync(htmlPath, html);
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.pdf({ path: join(outDir, name), width: mm(w), height: mm(h), printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    };

    const proof = proofHtml(spec, layout, files, issues, preps, [cover, first].filter((x): x is PlacedSpread => !!x), last ? [last] : []);
    await toPdf(proof.html, "proof.pdf", proof.widthMm, proof.heightMm);

    const checkDir = join(outDir, "check");
    rmSync(checkDir, { recursive: true, force: true });
    mkdirSync(checkDir, { recursive: true });
    const proofOut = { count: proof.sheets, widthMm: proof.widthMm, heightMm: proof.heightMm };
    rmSync(join(outDir, "print.pdf"), { force: true });
    rmSync(join(outDir, "spreads"), { recursive: true, force: true });
    for (const f of ["cover.pdf", "spine.pdf", "book.pdf", "first.pdf", "last.pdf"]) rmSync(join(outDir, f), { force: true });
    if (!withPrint) return { proof: join(outDir, "proof.pdf"), expected: { proof: proofOut } };

    const pr = printHtml(layout, files, spec.background);
    let printPath = join(outDir, "print.pdf");
    let kind: "pdf" | "jpg" = "pdf";
    if (p.export === "jpg-spreads") {
      kind = "jpg";
      printPath = join(outDir, "spreads");
      mkdirSync(printPath, { recursive: true });
      const htmlPath = join(outDir, "print.html");
      writeFileSync(htmlPath, pr.html);
      const big = await browser.newPage({ deviceScaleFactor: p.dpi / 96 });
      await big.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      const sheets = await big.locator(".sheet").all();
      for (let i = 0; i < sheets.length; i++) {
        const png = await sheets[i]!.screenshot({ type: "png" });
        // A sheet's size in CSS pixels is fractional, so the screenshot lands a few pixels off; labs want exact sizes.
        await sharp(png).flatten({ background: spec.background }).resize(Math.round((pr.widthMm / 25.4) * p.dpi), Math.round((pr.heightMm / 25.4) * p.dpi), { fit: "fill" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).withMetadata({ density: p.dpi }).toFile(join(printPath, `spread-${String(i + 1).padStart(3, "0")}.jpg`));
      }
      await big.close();
    } else {
      await toPdf(pr.html, "print.pdf", pr.widthMm, pr.heightMm);
      // Small screenshots of every sheet as laid out on screen; preflight compares the PDF's pages to them.
      const sheets = await page.locator(".sheet").all();
      for (let i = 0; i < sheets.length; i++) {
        const png = await sheets[i]!.screenshot({ type: "png" });
        await sharp(png).resize({ width: CHECK_WIDTH }).png().toFile(join(checkDir, `sheet-${String(i + 1).padStart(4, "0")}.png`));
      }
    }
    const extras: NonNullable<RenderOutput["expected"]["extras"]> = [];
    if (cover) {
      const c = halvesHtml(cover, ["R", "L"], layout, files, spec.background);
      await toPdf(c.html, "cover.pdf", c.widthMm, c.heightMm);
      extras.push({ label: "cover.pdf", file: join(outDir, "cover.pdf"), count: 2, widthMm: c.widthMm, heightMm: c.heightMm });
      const sp = spineHtml(spec, layout);
      if (sp) {
        await toPdf(sp.html, "spine.pdf", sp.widthMm, sp.heightMm);
        extras.push({ label: "spine.pdf", file: join(outDir, "spine.pdf"), count: 1, widthMm: sp.widthMm, heightMm: sp.heightMm });
      }
      // Labs that bind one PDF (Prodigi layflat, per its print guide): page 1 front cover; the
      // lab adds a blank inside front cover, so page 2 is a right-hand page on its own; spreads
      // follow in pairs; the second-to-last page is a left-hand page on its own facing the
      // lab's blank inside back cover; the last page is the back cover.
      if (p.cover === "in-book" && kind === "pdf" && p.export === "pdf-pages") {
        const single = async (sp: PlacedSpread | undefined, side: "L" | "R", name: string) => {
          if (!sp) return undefined;
          const s = halvesHtml(sp, [side], layout, files, spec.background);
          await toPdf(s.html, name, s.widthMm, s.heightMm);
          extras.push({ label: name, file: join(outDir, name), count: 1, widthMm: s.widthMm, heightMm: s.heightMm });
          return PDFDocument.load(readFileSync(join(outDir, name)));
        };
        const [firstDoc, lastDoc] = [await single(first, "R", "first.pdf"), await single(last, "L", "last.pdf")];
        const book = await PDFDocument.create();
        const [cv, inner] = await Promise.all([PDFDocument.load(readFileSync(join(outDir, "cover.pdf"))), PDFDocument.load(readFileSync(printPath))]);
        const [front, back] = await book.copyPages(cv, [0, 1]);
        const size: [number, number] = [front!.getWidth(), front!.getHeight()];
        const add = async (d: PDFDocument | undefined) => (d ? book.addPage((await book.copyPages(d, [0]))[0]!) : book.addPage(size)); // no page set: a blank white page
        book.addPage(front!);
        await add(firstDoc);
        for (const pg of await book.copyPages(inner, inner.getPageIndices())) book.addPage(pg);
        await add(lastDoc);
        book.addPage(back!);
        writeFileSync(join(outDir, "book.pdf"), await book.save());
        extras.push({ label: "book.pdf", file: join(outDir, "book.pdf"), count: pr.sheets + 4, widthMm: pr.widthMm, heightMm: pr.heightMm });
      }
    }
    return {
      print: printPath,
      proof: join(outDir, "proof.pdf"),
      expected: {
        print: { kind, count: pr.sheets, widthMm: pr.widthMm, heightMm: pr.heightMm, dpi: p.dpi },
        proof: proofOut,
        extras,
      },
    };
  } finally {
    await browser.close();
  }
}

export function readSourceDir(sourceFile: string): string {
  return (JSON.parse(readFileSync(sourceFile, "utf8")) as { dir: string }).dir;
}
