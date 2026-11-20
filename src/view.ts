import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { AlbumSpec, Photo, Profile } from "./types";

/**
 * A page-turning viewer of the album as it will print. It is built from the print file
 * itself (never re-laid out), so what you flip through is what the lab gets, trimmed at
 * the bleed. Writes `<out>/viewer/index.html` with its pages beside it; open it in any
 * browser, no server needed.
 */
export interface ViewOutput {
  index: string;
  pages: number;
}

/** Display width of one page in pixels: sharp on a 2x screen at a typical spread size. */
const PAGE_PX = 1600;
const THUMB_PX = 200;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** "December 19–24, 2022", "December 30, 2022 – January 2, 2023". Camera time is shown as written in the EXIF. */
export function dateRange(times: string[]): string {
  if (!times.length) return "";
  const sorted = [...times].sort();
  const a = new Date(sorted[0]!);
  const b = new Date(sorted[sorted.length - 1]!);
  const month = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const [ad, bd, ay, by] = [a.getUTCDate(), b.getUTCDate(), a.getUTCFullYear(), b.getUTCFullYear()];
  if (ay !== by) return `${month(a)} ${ad}, ${ay} – ${month(b)} ${bd}, ${by}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${month(a)} ${ad} – ${month(b)} ${bd}, ${ay}`;
  if (ad !== bd) return `${month(a)} ${ad}–${bd}, ${ay}`;
  return `${month(a)} ${ad}, ${ay}`;
}

/** Rasterize the print file into trimmed single pages, in reading order. */
export async function trimmedPages(printPath: string, profile: Profile, tmp: string): Promise<Buffer[]> {
  const { w: pw, h: ph } = profile.pageMm;
  const b = profile.bleedMm;
  let sheets: string[];
  if (profile.export === "jpg-spreads") {
    sheets = readdirSync(printPath).filter((f) => f.endsWith(".jpg")).sort().map((f) => join(printPath, f));
  } else {
    const byPage = profile.export === "pdf-pages";
    const sheetMm = (byPage ? pw : 2 * pw) + 2 * b;
    const px = Math.round(((byPage ? PAGE_PX : 2 * PAGE_PX) * sheetMm) / (sheetMm - 2 * b));
    const run = Bun.spawnSync(["pdftoppm", "-png", "-scale-to-x", String(px), "-scale-to-y", "-1", printPath, join(tmp, "s")]);
    if (run.exitCode !== 0) throw new Error(`pdftoppm failed: ${run.stderr.toString().trim()}`);
    sheets = readdirSync(tmp).filter((f) => f.startsWith("s-")).sort((x, y) => parseInt(x.slice(2)) - parseInt(y.slice(2))).map((f) => join(tmp, f));
  }
  const pages: Buffer[] = [];
  for (const file of sheets) {
    const meta = await sharp(file).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const isSpread = W / H > 1.5;
    const bx = Math.round((b / ((isSpread ? 2 * pw : pw) + 2 * b)) * W);
    const by = Math.round((b / (ph + 2 * b)) * H);
    const tw = W - 2 * bx;
    const th = H - 2 * by;
    const halves = isSpread ? [{ left: bx, width: Math.floor(tw / 2) }, { left: bx + Math.floor(tw / 2), width: tw - Math.floor(tw / 2) }] : [{ left: bx, width: tw }];
    for (const h of halves) pages.push(await sharp(file).extract({ left: h.left, top: by, width: h.width, height: th }).toBuffer());
  }
  return pages;
}

export async function buildViewer(spec: AlbumSpec, profile: Profile, photos: Photo[], sourceDir: string, outDir: string): Promise<ViewOutput> {
  const printPath = profile.export === "jpg-spreads" ? join(outDir, "spreads") : join(outDir, "print.pdf");
  if (!existsSync(printPath)) throw new Error(`no print file at ${printPath}: run build first (the viewer shows the print file, which a lint error withholds)`);
  if (profile.export !== "jpg-spreads" && !Bun.which("pdftoppm")) throw new Error("pdftoppm not found (install poppler): the viewer rasterizes print.pdf");

  const dir = join(outDir, "viewer");
  rmSync(dir, { recursive: true, force: true });
  const tmp = join(dir, ".raw");
  mkdirSync(join(dir, "pages"), { recursive: true });
  mkdirSync(tmp, { recursive: true });

  const pages = await trimmedPages(printPath, profile, tmp);
  if (pages.length !== spec.spreads.length * 2) throw new Error(`the print file has ${pages.length} pages for ${spec.spreads.length} spreads`);
  const names: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const n = String(i + 1).padStart(3, "0");
    await sharp(pages[i]!).resize({ width: PAGE_PX, withoutEnlargement: true }).jpeg({ quality: 84, progressive: true, mozjpeg: true }).toFile(join(dir, "pages", `p${n}.jpg`));
    await sharp(pages[i]!).resize({ width: THUMB_PX }).jpeg({ quality: 72, mozjpeg: true }).toFile(join(dir, "pages", `t${n}.jpg`));
    names.push(n);
  }
  rmSync(tmp, { recursive: true, force: true });

  // The opening image: the first spread's lead picture, from the original file.
  const byId = new Map(photos.map((p) => [p.id, p]));
  const used = spec.spreads.flatMap((s) => s.slots.map((x) => byId.get(x.photo))).filter((p): p is Photo => !!p);
  const hero = used[0];
  if (hero) await sharp(join(sourceDir, hero.path)).rotate().resize({ width: 2400, height: 1600, fit: "cover", position: "attention" }).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toFile(join(dir, "cover.jpg"));

  const data = {
    /** Changes every build, so a browser never shows last build's pages under the same names. */
    build: Date.now().toString(36),
    title: spec.title,
    dates: dateRange(used.map((p) => p.takenAt)),
    photos: new Set(used.map((p) => p.id)).size,
    paper: spec.background,
    cover: hero ? "cover.jpg" : null,
    spreads: spec.spreads.map((s, i) => ({ chapter: s.chapter, left: names[2 * i]!, right: names[2 * i + 1]! })),
  };
  const index = join(dir, "index.html");
  writeFileSync(index, viewerHtml(data));
  return { index, pages: pages.length };
}

interface ViewerData {
  build: string;
  title: string;
  dates: string;
  photos: number;
  paper: string;
  cover: string | null;
  spreads: { chapter: string; left: string; right: string }[];
}

function viewerHtml(d: ViewerData): string {
  const json = JSON.stringify(d).replace(/</g, "\\u003c");
  const t = esc(d.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${t}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#141210; --bg-lift:#2a2420; --ink:#f4eee6; --muted:#a69c90; --faint:rgba(244,238,230,.14);
  --accent:#f0607f; --paper:${esc(d.paper)};
  --serif:"Cormorant Garamond","Iowan Old Style",Georgia,serif;
  --sans:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;
  --ease:cubic-bezier(.45,.05,.2,1);
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  background:radial-gradient(120% 90% at 50% 38%,var(--bg-lift) 0%,var(--bg) 62%);
  color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;
  height:100svh;overflow:hidden;display:grid;grid-template-rows:auto 1fr auto;
  user-select:none;-webkit-user-select:none;
}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}

/* header */
.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px clamp(16px,3vw,32px) 8px}
.home{display:flex;align-items:baseline;gap:12px;min-width:0}
.home .t{font-family:var(--serif);font-style:italic;font-size:22px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .d{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.tools{display:flex;align-items:center;gap:6px}
.count{font-size:12px;letter-spacing:.08em;color:var(--muted);font-variant-numeric:tabular-nums;margin-right:6px;white-space:nowrap}
.count b{color:var(--ink);font-weight:500}
.icon{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:var(--muted);transition:background .2s,color .2s}
.icon:hover{background:var(--faint);color:var(--ink)}
.icon svg{width:18px;height:18px}

/* stage and book */
.stage{position:relative;display:grid;place-items:center;min-height:0;padding:8px 0}
.book{position:relative;width:var(--bw,80vw);height:calc(var(--bw,80vw)/2);perspective:3200px;
  box-shadow:0 2px 3px rgba(0,0,0,.25),0 22px 44px -12px rgba(0,0,0,.55),0 60px 90px -40px rgba(0,0,0,.6);
  border-radius:2px;touch-action:pan-y}
.page{position:absolute;top:0;width:50%;height:100%;background:var(--paper);overflow:hidden;cursor:pointer}
.page.l{left:0;border-radius:2px 0 0 2px}.page.r{right:0;border-radius:0 2px 2px 0}
.page img,.face img{width:100%;height:100%;display:block;object-fit:cover;pointer-events:none}
.spine{position:absolute;left:50%;top:0;bottom:0;width:9%;transform:translateX(-50%);pointer-events:none;z-index:4;
  background:linear-gradient(90deg,transparent,rgba(0,0,0,.05) 35%,rgba(0,0,0,.16) 50%,rgba(0,0,0,.05) 65%,transparent)}
.leaf{position:absolute;top:0;width:50%;height:100%;transform-style:preserve-3d;z-index:6;display:none;will-change:transform}
.leaf.fwd{left:50%;transform-origin:0 50%}.leaf.bwd{left:0;transform-origin:100% 50%}
.face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;background:var(--paper)}
.face.back{transform:rotateY(180deg)}
.shade{position:absolute;inset:0;opacity:0;pointer-events:none}
.leaf.fwd .front .shade,.leaf.bwd .back .shade{background:linear-gradient(90deg,rgba(0,0,0,.28),rgba(0,0,0,0) 60%)}
.leaf.fwd .back .shade,.leaf.bwd .front .shade{background:linear-gradient(270deg,rgba(0,0,0,.28),rgba(0,0,0,0) 60%)}

.nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  color:var(--ink);background:rgba(20,18,16,.35);border:1px solid var(--faint);backdrop-filter:blur(6px);transition:opacity .25s,background .2s;z-index:8}
.nav:hover{background:rgba(20,18,16,.6)}
.nav:disabled{opacity:0;pointer-events:none}
.nav svg{width:20px;height:20px}
.prev{left:clamp(10px,2vw,24px)}.next{right:clamp(10px,2vw,24px)}
.chapter{position:absolute;bottom:2px;left:0;right:0;text-align:center;font-family:var(--serif);font-style:italic;font-size:15px;color:var(--muted);
  opacity:0;transition:opacity .4s;pointer-events:none}
.chapter.on{opacity:1}

/* filmstrip */
.strip{display:flex;gap:10px;overflow-x:auto;padding:12px clamp(16px,3vw,32px) max(16px,env(safe-area-inset-bottom));scrollbar-width:none;scroll-behavior:smooth}
.strip::-webkit-scrollbar{display:none}
.thumb{flex:none;display:flex;height:46px;border-radius:3px;overflow:hidden;opacity:.45;transition:opacity .2s,transform .2s,box-shadow .2s;box-shadow:0 0 0 1px var(--faint)}
.thumb img{height:100%;width:auto;display:block;aspect-ratio:1}
.thumb:hover{opacity:.85}
.thumb[aria-current="true"]{opacity:1;transform:translateY(-3px);box-shadow:0 0 0 2px var(--accent),0 8px 16px -6px rgba(0,0,0,.6)}
.thumb.gap{margin-left:14px}

/* single-page mode on a portrait phone */
body.single .book{height:var(--bw,80vw)}
body.single .page.l{width:100%;border-radius:2px}
body.single .page.r,body.single .spine{display:none}
body.single .thumb img+img{display:none}

/* opening */
.intro{position:fixed;inset:0;z-index:20;display:grid;place-items:center;text-align:center;padding:24px;overflow:hidden;background:var(--bg)}
.intro .ph{position:absolute;inset:-4%;background-size:cover;background-position:center;transform:scale(1.04);animation:drift 24s var(--ease) infinite alternate}
.intro .ph::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,12,10,.35) 0%,rgba(14,12,10,.55) 55%,rgba(14,12,10,.85) 100%)}
@keyframes drift{to{transform:scale(1.1) translate(-1%,-1%)}}
.intro .in{position:relative;max-width:760px;animation:rise 1.1s var(--ease) both}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.kicker{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:rgba(244,238,230,.8)}
.intro h1{font-family:var(--serif);font-weight:400;font-size:clamp(48px,9vw,112px);line-height:.95;margin:18px 0 18px;letter-spacing:-.01em;text-wrap:balance}
.intro .meta{font-size:14px;color:rgba(244,238,230,.82);letter-spacing:.04em}
.open{margin-top:40px;display:inline-flex;align-items:center;gap:10px;padding:14px 26px;border-radius:999px;background:var(--ink);color:#1b1714;font-weight:600;font-size:14px;letter-spacing:.02em;
  box-shadow:0 10px 30px -10px rgba(0,0,0,.6);transition:transform .2s,box-shadow .2s}
.open:hover{transform:translateY(-1px);box-shadow:0 14px 34px -10px rgba(0,0,0,.7)}
.open svg{width:16px;height:16px}
.hint{margin-top:18px;font-size:12px;color:rgba(244,238,230,.55)}
.intro.gone{opacity:0;transform:scale(1.03);transition:opacity .7s var(--ease),transform .9s var(--ease);pointer-events:none}
kbd{font-family:var(--sans);font-size:11px;border:1px solid rgba(244,238,230,.3);border-radius:4px;padding:1px 5px}

@media (max-width:640px){.home .d,.count .of{display:none}.nav{width:38px;height:38px}.hint{display:none}}
@media (prefers-reduced-motion:reduce){.intro .ph,.intro .in{animation:none}}
</style>
</head>
<body>
<header class="bar">
  <button class="home" id="home" aria-label="Back to the cover"><span class="t">${t}</span><span class="d">${esc(d.dates)}</span></button>
  <div class="tools">
    <span class="count" id="count" aria-live="polite"></span>
    <button class="icon" id="fs" aria-label="Full screen (F)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
  </div>
</header>
<main class="stage" id="stage">
  <button class="nav prev" id="prev" aria-label="Previous (←)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
  <div class="book" id="book">
    <div class="page l" id="pl"><img alt=""></div>
    <div class="page r" id="pr"><img alt=""></div>
    <div class="spine"></div>
    <div class="leaf" id="leaf"><div class="face front"><img alt=""><div class="shade"></div></div><div class="face back"><img alt=""><div class="shade"></div></div></div>
  </div>
  <button class="nav next" id="next" aria-label="Next (→)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>
  <div class="chapter" id="chapter"></div>
</main>
<nav class="strip" id="strip" aria-label="Spreads"></nav>

<section class="intro" id="intro" aria-label="Cover">
  <div class="ph" id="ph"></div>
  <div class="in">
    <div class="kicker">A photo album</div>
    <h1>${t}</h1>
    <div class="meta">${esc(d.dates)}${d.dates ? " · " : ""}${d.photos} photographs · ${d.spreads.length} spreads</div>
    <button class="open" id="open">Open the album <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    <div class="hint">Turn pages with <kbd>←</kbd> <kbd>→</kbd>, a swipe, or a click on a page</div>
  </div>
</section>

<script>
const D = ${json};
const $ = (id) => document.getElementById(id);
const src = (n) => "pages/p" + n + ".jpg?v=" + D.build;
const pages = D.spreads.flatMap((s) => [s.left, s.right]);
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const portrait = matchMedia("(max-width: 700px) and (orientation: portrait)");
let single = portrait.matches;
let pg = 0;          // index of the page in view; in spread mode always even (the left page)
let busy = false;
let aim = 0;         // where the turn in progress is going

if (D.cover) $("ph").style.backgroundImage = "url(" + D.cover + "?v=" + D.build + ")";

function fit() {
  const s = $("stage").getBoundingClientRect();
  const side = single ? 16 : Math.max(72, s.width * 0.06);
  const room = s.width - side * 2, tall = s.height - 40;
  const bw = single ? Math.min(room, tall) : Math.min(room, tall * 2);
  document.body.style.setProperty("--bw", Math.max(160, bw) + "px");
}

function setImg(el, n, label) { const i = el.querySelector("img"); if (i.dataset.n !== n) { i.src = src(n); i.dataset.n = n; } i.alt = label || ""; }
function spreadOf(p) { return Math.floor(p / 2); }
function preload(p) { for (const k of [p - 2, p - 1, p + 1, p + 2, p + 3]) if (pages[k]) new Image().src = src(pages[k]); }

function paint() {
  const sp = spreadOf(pg);
  if (single) {
    setImg($("pl"), pages[pg], "Page " + (pg + 1));
  } else {
    setImg($("pl"), pages[pg], "Page " + (pg + 1));
    setImg($("pr"), pages[pg + 1], "Page " + (pg + 2));
  }
  const total = single ? pages.length : D.spreads.length;
  const here = single ? pg + 1 : sp + 1;
  $("count").innerHTML = (single ? "Page " : "Spread ") + "<b>" + here + "</b><span class=of> of " + total + "</span>";
  $("prev").disabled = pg === 0;
  $("next").disabled = single ? pg >= pages.length - 1 : sp >= D.spreads.length - 1;
  const ch = D.spreads[sp].chapter, prevCh = sp > 0 ? D.spreads[sp - 1].chapter : null;
  const named = ch && !/^chapter \\d+$/i.test(ch);
  $("chapter").textContent = named ? ch : "";
  $("chapter").classList.toggle("on", !!named && ch !== prevCh);
  document.querySelectorAll(".thumb").forEach((b, i) => b.setAttribute("aria-current", String(i === sp)));
  const cur = document.querySelector('.thumb[aria-current="true"]');
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce.matches ? "auto" : "smooth" });
  history.replaceState(null, "", "#" + (sp + 1) + (single && pg % 2 ? "b" : ""));
  preload(pg);
}

let settle = null;  // finishes the turn in progress at once, so a fast click is never lost
function go(target) {
  if (busy && settle) settle();
  if (single) target = Math.max(0, Math.min(pages.length - 1, target));
  else target = Math.max(0, Math.min(pages.length - 2, target - (target % 2)));
  if (target === pg) return;
  aim = target;
  const fwd = target > pg;
  if (single || reduce.matches) return fade(target, fwd);
  flip(target, fwd);
}

function fade(target, fwd) {
  busy = true;
  pg = target;
  paint();
  const dx = single && !reduce.matches ? (fwd ? 28 : -28) : 0;
  const a = $("book").animate([{ opacity: 0.25, transform: "translateX(" + dx + "px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "ease-out" });
  settle = () => { settle = null; a.cancel(); busy = false; };
  a.onfinish = () => settle && settle();
}

function flip(target, fwd) {
  busy = true;
  const leaf = $("leaf"), front = leaf.querySelector(".front"), back = leaf.querySelector(".back");
  leaf.className = "leaf " + (fwd ? "fwd" : "bwd");
  if (fwd) {
    setImg(front, pages[pg + 1]); setImg(back, pages[target]);
    setImg($("pr"), pages[target + 1], "Page " + (target + 2));
  } else {
    setImg(front, pages[pg]); setImg(back, pages[target + 1]);
    setImg($("pl"), pages[target], "Page " + (target + 1));
  }
  leaf.style.display = "block";
  const to = fwd ? -180 : 180, T = 950, ease = "cubic-bezier(.42,.0,.22,1)";
  const anim = leaf.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(" + to * 0.5 + "deg) translateZ(1px)", offset: 0.5 }, { transform: "rotateY(" + to + "deg)" }], { duration: T, easing: ease });
  front.querySelector(".shade").animate([{ opacity: 0 }, { opacity: 1 }], { duration: T / 2, easing: "ease-in", fill: "forwards" });
  back.querySelector(".shade").animate([{ opacity: 1 }, { opacity: 0 }], { duration: T / 2, delay: T / 2, easing: "ease-out", fill: "both" });
  const shades = leaf.querySelectorAll(".shade");
  settle = () => {
    settle = null;
    anim.cancel();
    shades.forEach((sh) => sh.getAnimations().forEach((x) => x.cancel()));
    pg = target;
    paint();
    leaf.style.display = "none";
    busy = false;
  };
  anim.onfinish = () => settle && settle();
}

// Count from the page being turned to, so quick presses add up instead of undoing each other.
function step(dir) { go((busy ? aim : pg) + dir * (single ? 1 : 2)); }

// strip
D.spreads.forEach((s, i) => {
  const b = document.createElement("button");
  b.className = "thumb" + (i > 0 && s.chapter !== D.spreads[i - 1].chapter ? " gap" : "");
  b.setAttribute("aria-label", "Spread " + (i + 1) + (s.chapter ? ", " + s.chapter : ""));
  b.title = "Spread " + (i + 1);
  b.innerHTML = '<img loading="lazy" alt="" src="pages/t' + s.left + '.jpg?v=' + D.build + '"><img loading="lazy" alt="" src="pages/t' + s.right + '.jpg?v=' + D.build + '">';
  b.onclick = () => go(i * 2);
  $("strip").appendChild(b);
});

// input
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("pl").onclick = () => (single ? step(1) : step(-1));
$("pr").onclick = () => step(1);
$("fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$("home").onclick = () => { $("intro").style.display = ""; requestAnimationFrame(() => $("intro").classList.remove("gone")); $("open").focus(); };
function openAlbum() { $("intro").classList.add("gone"); setTimeout(() => { $("intro").style.display = "none"; }, 900); $("next").focus({ preventScroll: true }); }
$("open").onclick = openAlbum;
addEventListener("keydown", (e) => {
  const introUp = !$("intro").classList.contains("gone");
  if (introUp) { if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); openAlbum(); } return; }
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); step(-1); }
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(pages.length - 1);
  else if (e.key === "f" || e.key === "F") $("fs").click();
  else if (e.key === "Escape") $("home").click();
});
let sx = null, sy = 0, suppress = false;
$("book").addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
$("book").addEventListener("pointerup", (e) => {
  if (sx === null) return;
  const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { e.stopPropagation(); step(dx < 0 ? 1 : -1); suppress = true; setTimeout(() => (suppress = false), 0); }
});
$("book").addEventListener("click", (e) => { if (suppress) e.stopPropagation(); }, true);

portrait.addEventListener("change", () => { single = portrait.matches; document.body.classList.toggle("single", single); if (!single) pg -= pg % 2; fit(); paint(); });
addEventListener("resize", fit);

// a link to #6 (spread 6) or #6b (its right page, on a phone)
function fromHash() {
  const m = location.hash.match(/^#(\\d+)(b?)$/);
  if (!m) return null;
  return Math.max(0, Math.min(D.spreads.length - 1, Number(m[1]) - 1)) * 2 + (single && m[2] ? 1 : 0);
}
addEventListener("hashchange", () => { const t = fromHash(); if (t !== null && t !== pg) { if ($("intro").style.display !== "none") openAlbum(); go(t); } });

// start
document.body.classList.toggle("single", single);
const first = fromHash();
if (first !== null) { pg = first; $("intro").classList.add("gone"); $("intro").style.display = "none"; }
fit();
paint();
</script>
</body>
</html>`;
}
