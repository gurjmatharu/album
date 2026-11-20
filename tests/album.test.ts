import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSample } from "../scripts/make-sample";
import { CATALOG } from "../src/catalog";
import { cull } from "../src/cull";
import { allocate, chapters, directHeuristic } from "../src/director/heuristic";
import { ingest, laplacianVariance } from "../src/ingest";
import { resolveLayout, solveCrop } from "../src/layout";
import { hamming, lint } from "../src/lints";
import { preflight } from "../src/preflight";
import { render } from "../src/render";
import type { AlbumSpec, Photo, Profile } from "../src/types";
import { buildViewer, dateRange } from "../src/view";
import { loadPeople, loadPhotos, loadProfile, paths } from "../src/work";

const profile: Profile = loadProfile("proof-10x10");

function photo(id: string, over: Partial<Photo> = {}): Photo {
  return { id, path: `${id}.jpg`, sha: id, bytes: 1, mtimeMs: 0, width: 6000, height: 4000, takenAt: "2026-06-20T15:00:00.000Z", timeSource: "exif", sharpness: 100, dhash: "0000000000000000", faces: [], ...over };
}

function spec(spreads: AlbumSpec["spreads"], people: AlbumSpec["people"] = []): AlbumSpec {
  return { version: 1, title: "t", profile: profile.id, theme: "journal", background: "#ffffff", people, spreads };
}

const rules = (s: AlbumSpec, photos: Photo[]) => lint(s, resolveLayout(s, new Map(photos.map((p) => [p.id, p])), profile)).filter((i) => i.severity === "error").map((i) => i.rule);

describe("catalog", () => {
  test("every slot is inside the spread and no two slots of a template overlap", () => {
    for (const t of CATALOG) {
      for (const a of t.slots) {
        expect(a.rect.x).toBeGreaterThanOrEqual(0);
        expect(a.rect.y).toBeGreaterThanOrEqual(0);
        expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(1 + 1e-9);
        for (const b of t.slots) {
          if (a === b) continue;
          const apart = a.rect.x + a.rect.w <= b.rect.x + 1e-9 || b.rect.x + b.rect.w <= a.rect.x + 1e-9 || a.rect.y + a.rect.h <= b.rect.y + 1e-9 || b.rect.y + b.rect.h <= a.rect.y + 1e-9;
          expect(apart).toBe(true);
        }
      }
    }
  });
});

describe("editorial templates", () => {
  const apart = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;

  test("a text box is on one page, clear of every picture and of the fold", () => {
    for (const t of CATALOG) {
      for (const box of t.text ?? []) {
        expect(box.rect.x).toBeGreaterThanOrEqual(0.03);
        expect(box.rect.y).toBeGreaterThanOrEqual(0.03);
        expect(box.rect.x + box.rect.w).toBeLessThanOrEqual(0.97);
        expect(box.rect.y + box.rect.h).toBeLessThanOrEqual(0.97);
        expect(box.rect.x + box.rect.w <= 0.47 || box.rect.x >= 0.53).toBe(true);
        for (const s of t.slots) expect(apart(box.rect, s.rect)).toBe(true);
      }
    }
  });

  test("a 16:9 photo fills an editorial landscape slot without losing any of it", () => {
    const off = CATALOG.find((t) => t.id === "ed-offset")!.slots[0]!;
    const r = solveCrop(photo("a", { width: 6000, height: 3375 }), off, profile);
    expect((r.crop.w * r.crop.h) / (6000 * 3375)).toBeGreaterThan(0.99);
  });

  test("words for a text box the template does not have are an error", () => {
    const s = spec([{ id: "s01", chapter: "c", template: "ed-quiet", text: { nope: "x" }, slots: [{ slot: "a", photo: "a" }] }]);
    const out = lint({ ...s, theme: "editorial" }, resolveLayout({ ...s, theme: "editorial" }, new Map([["a", photo("a")]]), profile));
    expect(out.map((i) => i.rule)).toContain("unknown-text");
  });
});

describe("crop", () => {
  const pano = CATALOG.find((t) => t.id === "pano")!.slots[0]!;
  const left = CATALOG.find((t) => t.id === "full-pair")!.slots[0]!;

  test("the crop has the slot's shape and stays inside the photo", () => {
    const r = solveCrop(photo("a"), left, profile);
    expect(r.crop.w / r.crop.h).toBeCloseTo(r.rect.w / r.rect.h, 5);
    expect(r.crop.x).toBeGreaterThanOrEqual(0);
    expect(r.crop.x + r.crop.w).toBeLessThanOrEqual(6000 + 1e-6);
  });

  test("a portrait crop of a landscape slides to keep the face whole", () => {
    const p = photo("a", { faces: [{ x: 0.8, y: 0.3, w: 0.1, h: 0.15, person: "bride" }] });
    const r = solveCrop(p, left, profile);
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0]!.cut).toBe(false);
  });

  test("a face in the middle of a full-spread picture is on the fold", () => {
    const p = photo("a", { width: 8000, height: 4000, faces: [{ x: 0.47, y: 0.3, w: 0.06, h: 0.12 }] });
    expect(solveCrop(p, pano, profile).faces[0]!.onFold).toBe(true);
    const off = photo("b", { width: 8000, height: 4000, faces: [{ x: 0.2, y: 0.3, w: 0.06, h: 0.12 }] });
    expect(solveCrop(off, pano, profile).faces[0]!.onFold).toBe(false);
  });
});

describe("lints", () => {
  const pair = (a: string, b: string, id = "s01") => ({ id, chapter: "c", template: "full-pair", slots: [{ slot: "a", photo: a }, { slot: "b", photo: b }] });

  test("a clean spread passes", () => {
    expect(rules(spec([pair("a", "b")]), [photo("a", { dhash: "ffff000000000000" }), photo("b")])).toEqual([]);
  });

  test("the same photo twice, and two frames of one moment", () => {
    expect(rules(spec([pair("a", "a")]), [photo("a")])).toContain("duplicate");
    const near = [photo("a"), photo("b", { dhash: "0000000000000003", takenAt: "2026-06-20T15:00:02.000Z" })];
    expect(rules(spec([pair("a", "b")]), near)).toContain("near-duplicate");
  });

  test("a small photo in a full page", () => {
    expect(rules(spec([pair("a", "b")]), [photo("a", { width: 900, height: 600, dhash: "ffff000000000000" }), photo("b")])).toContain("resolution");
  });

  test("a named person short of their minimum", () => {
    const people = [{ id: "bride", name: "Bride", minAppearances: 2 }];
    const ps = [photo("a", { dhash: "ffff000000000000", faces: [{ x: 0.45, y: 0.3, w: 0.1, h: 0.15, person: "bride" }] }), photo("b")];
    expect(rules(spec([pair("a", "b")], people), ps)).toContain("coverage");
    people[0]!.minAppearances = 1;
    expect(rules(spec([pair("a", "b")], people), ps)).toEqual([]);
  });

  test("an empty slot, an unknown template, an unknown photo", () => {
    const s = spec([{ id: "s01", chapter: "c", template: "full-pair", slots: [{ slot: "a", photo: "zz" }] }, { id: "s02", chapter: "c", template: "nope", slots: [] }]);
    const got = rules(s, []);
    expect(got).toContain("unknown-photo");
    expect(got).toContain("empty-slot");
    expect(got).toContain("unknown-template");
  });

  test("page count against the profile", () => {
    const tight = { ...profile, pages: { min: 20, max: 40, multiple: 2 } };
    const s = spec([pair("a", "b")]);
    const out = lint(s, resolveLayout(s, new Map([photo("a", { dhash: "ffff000000000000" }), photo("b")].map((p) => [p.id, p])), tight));
    expect(out.some((i) => i.rule === "page-count")).toBe(true);
  });

  test("black-and-white beside colour, and a template outside the theme", () => {
    const grey = { l: 50, a: 0, b: 0, chroma: 1 };
    const warm = { l: 55, a: 8, b: 22, chroma: 24 };
    const ps = [photo("a", { dhash: "ffff000000000000", tone: grey }), photo("b", { tone: warm })];
    expect(rules(spec([pair("a", "b")]), ps)).toContain("mixed-mono");
    expect(rules(spec([pair("a", "b")]), [photo("a", { dhash: "ffff000000000000", tone: warm }), photo("b", { tone: warm })])).toEqual([]);
    const gallery = { ...spec([pair("a", "b")]), theme: "gallery" };
    const out = lint(gallery, resolveLayout(gallery, new Map(ps.map((p) => [p.id, p])), profile));
    expect(out.some((i) => i.rule === "off-theme")).toBe(true);
  });

  test("clashing colour casts and a subject looking off the page are warned about", () => {
    const warm = { l: 55, a: 8, b: 25, chroma: 26 };
    const cool = { l: 55, a: -4, b: -15, chroma: 16 };
    const ps = [
      photo("a", { dhash: "ffff000000000000", tone: warm, faces: [{ x: 0.45, y: 0.3, w: 0.1, h: 0.15, gaze: "left" }] }),
      photo("b", { tone: cool }),
    ];
    const s = spec([pair("a", "b")]);
    const got = lint(s, resolveLayout(s, new Map(ps.map((p) => [p.id, p])), profile)).map((i) => i.rule);
    expect(got).toContain("spread-colour");
    expect(got).toContain("gaze-off-page");
  });

  test("hamming distance", () => {
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
  });
});

describe("cull and director", () => {
  test("a burst keeps its sharpest frame and a blurred frame is dropped", () => {
    const ps = [
      photo("a", { sharpness: 80, takenAt: "2026-06-20T15:00:00.000Z" }),
      photo("b", { sharpness: 120, takenAt: "2026-06-20T15:00:01.000Z" }),
      photo("c", { sharpness: 100, takenAt: "2026-06-20T16:00:00.000Z", dhash: "ffffffff00000000" }),
      photo("d", { sharpness: 5, takenAt: "2026-06-20T17:00:00.000Z", dhash: "00000000ffffffff" }),
    ];
    const keep = cull(ps, []).filter((s) => s.keep).map((s) => s.id);
    expect(keep).toEqual(["b", "c"]);
  });

  test("the cull keeps one of two frames the near-duplicate lint would reject", () => {
    // 6 s apart: outside the 4 s burst window, inside the lint's 20 s near-duplicate window.
    const ps = [
      photo("a", { sharpness: 90, dhash: "177b7f3353537727", takenAt: "2026-06-20T15:00:00.000Z" }),
      photo("b", { sharpness: 100, dhash: "177b7f3393537627", takenAt: "2026-06-20T15:00:06.000Z" }),
    ];
    expect(cull(ps, []).filter((s) => s.keep).map((s) => s.id)).toEqual(["b"]);
  });

  test("laplacian variance is zero on a flat image and positive on an edge", () => {
    expect(laplacianVariance(new Uint8Array(100).fill(90), 10, 10)).toBe(0);
    const edge = new Uint8Array(100).map((_, i) => (i % 10 < 5 ? 0 : 255));
    expect(laplacianVariance(edge, 10, 10)).toBeGreaterThan(0);
  });

  test("chapters split at long pauses and spreads are shared out", () => {
    const ps = [0, 1, 2, 120, 121, 300].map((m, i) => photo(`p${i}`, { takenAt: new Date(Date.UTC(2026, 5, 20, 12, m)).toISOString() }));
    expect(chapters(ps, 30, 10).map((c) => c.length)).toEqual([3, 2, 1]);
    expect(chapters(ps, 30, 2).map((c) => c.length)).toEqual([5, 1]);
    expect(allocate([40, 10, 10], 6).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe("viewer", () => {
  test("date range reads naturally", () => {
    expect(dateRange(["2022-12-20T22:39:25.000Z", "2022-12-19T19:07:10.000Z"])).toBe("December 19–20, 2022");
    expect(dateRange(["2022-12-30T10:00:00.000Z", "2023-01-02T10:00:00.000Z"])).toBe("December 30, 2022 – January 2, 2023");
    expect(dateRange(["2022-12-19T10:00:00.000Z"])).toBe("December 19, 2022");
  });
});

describe("end to end on the synthetic sample", () => {
  test("ingest, cull, direct, lint, render and preflight", async () => {
    const dir = mkdtempSync(join(tmpdir(), "album-"));
    const work = join(dir, "work");
    const n = await makeSample(join(dir, "photos"), work, { longEdge: 3000, every: 2 });
    const r = await ingest(join(dir, "photos"), work);
    expect(r.photos).toHaveLength(n);
    expect(r.photos.every((p) => p.timeSource === "exif")).toBe(true);

    const photos = loadPhotos(work);
    const people = loadPeople(work).people;
    const selects = cull(photos, people);
    const kept = photos.filter((p) => selects.find((s) => s.id === p.id)!.keep);
    expect(kept.length).toBeLessThan(photos.length);

    const small = { ...profile, pageMm: { w: 150, h: 150 } };
    const album = directHeuristic(kept, new Map(selects.map((s) => [s.id, s.score])), { title: "Test", profile: small, spreads: 5, people: [], theme: "journal" });
    expect(album.spreads).toHaveLength(5);
    const layout = resolveLayout(album, new Map(photos.map((p) => [p.id, p])), small);
    const issues = lint(album, layout);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);

    const p = paths(work);
    const out = await render(album, layout, issues, join(dir, "photos"), p.assets, p.out, true);
    const checks = await preflight(out);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(5);

    const view = await buildViewer(album, small, photos, join(dir, "photos"), p.out);
    expect(view.pages).toBe(10);
    const html = await Bun.file(view.index).text();
    expect(html).toContain('"spreads":[');
    expect(await Bun.file(join(p.out, "viewer", "pages", "p010.jpg")).exists()).toBe(true);
  }, 180_000);
});
