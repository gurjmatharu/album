#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cull, type Select } from "./cull";
import { directClaude } from "./director/claude";
import { directHeuristic, type DirectOptions } from "./director/heuristic";
import { ingest } from "./ingest";
import { resolveLayout } from "./layout";
import { lint, summarize } from "./lints";
import { preflight } from "./preflight";
import { readSourceDir, render } from "./render";
import { THEMES } from "./themes";
import { buildViewer } from "./view";
import type { AlbumSpec, Issue, Photo } from "./types";
import { listProfiles, loadPeople, loadPhotos, loadProfile, loadSpec, logStage, paths, readJson, writeJson } from "./work";

const USAGE = `album <verb> [options]

  sample <photo dir>     write a synthetic wedding dump plus faces.json and people.json
  ingest <photo dir>     measure every photo into photos.json
  cull                   group bursts, drop blurred frames, keep the best of each burst
  direct                 write album.json (the spread-by-spread spec)
  lint                   check album.json; exit 1 on any error
  build                  lint, render proof.pdf and the print file, preflight them
  run <photo dir>        ingest, cull, direct, build
  view                   write out/viewer/index.html: a page-turning viewer of the print file
  profiles               list print profiles
  themes                 list themes

options
  --work <dir>           work directory (default ./work)
  --profile <id>         print profile (default proof-10x10)
  --spreads <n>          number of spreads (default 20)
  --title <text>         album title
  --theme <id>           art direction: gallery (default), cinematic or journal
  --director <name>      heuristic (default, no API) or claude (needs ANTHROPIC_API_KEY)
  --force                build: write the print file even with lint errors`;

function parse(argv: string[]) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--force") flags.force = "1";
    else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
    else rest.push(a);
  }
  return { flags, rest };
}

function printIssues(issues: Issue[]): void {
  for (const i of issues) console.log(`  ${i.severity === "error" ? "ERROR  " : "warning"} ${i.rule}: ${i.message}`);
  const s = summarize(issues);
  console.log(`lint: ${s.errors} errors, ${s.warnings} warnings`);
}

function checker(photos: Photo[]) {
  const byId = new Map(photos.map((p) => [p.id, p]));
  return (spec: AlbumSpec): Issue[] => lint(spec, resolveLayout(spec, byId, loadProfile(spec.profile)));
}

async function main(): Promise<number> {
  const [verb, ...argv] = process.argv.slice(2);
  const { flags, rest } = parse(argv);
  const work = resolve(flags.work ?? "work");
  const p = paths(work);
  const started = Date.now();
  const done = (stage: string, fields: Record<string, unknown> = {}) => logStage(work, stage, { wall_ms: Date.now() - started, usd: 0, ...fields });

  const doIngest = async (dir: string) => {
    const r = await ingest(resolve(dir), work);
    console.log(`ingest: ${r.photos.length} photos (${r.measured} measured, ${r.reused} reused) -> ${p.photos}`);
    if (r.unsupported.length) console.log(`ingest: skipped ${r.unsupported.length} files in formats not decoded yet (HEIC/RAW), e.g. ${r.unsupported[0]}`);
    for (const f of r.failed) console.log(`ingest: FAILED ${f.path}: ${f.error}`);
    done("ingest", { photos: r.photos.length, measured: r.measured, unsupported: r.unsupported.length, failed: r.failed.length });
    return r.failed.length ? 1 : 0;
  };

  const doCull = () => {
    const photos = loadPhotos(work);
    const selects = cull(photos, loadPeople(work).people);
    writeJson(p.selects, selects);
    const kept = selects.filter((s) => s.keep).length;
    const faces = photos.filter((x) => x.faces.length).length;
    console.log(`cull: kept ${kept} of ${selects.length} -> ${p.selects}`);
    if (!existsSync(p.faces)) console.log("cull: no faces.json, so nobody is recognised: run the face worker (cv/README.md) before trusting crops or coverage");
    done("cull", { kept, of: selects.length, photos_with_faces: faces });
    return 0;
  };

  const doDirect = async () => {
    const photos = loadPhotos(work);
    if (!existsSync(p.selects)) throw new Error(`${p.selects} not found: run "album cull" first`);
    const selects = readJson<Select[]>(p.selects);
    const scores = new Map(selects.map((s) => [s.id, s.score]));
    const keep = new Set(selects.filter((s) => s.keep).map((s) => s.id));
    const kept = photos.filter((x) => keep.has(x.id));
    const profile = loadProfile(flags.profile ?? "proof-10x10");
    const opts: DirectOptions = { title: flags.title ?? "Album", profile, spreads: Number(flags.spreads ?? 20), people: loadPeople(work).people, theme: flags.theme ?? "gallery" };
    const who = flags.director ?? "heuristic";
    let spec: AlbumSpec;
    let usd = 0;
    if (who === "claude") {
      const r = await directClaude(kept, scores, opts, readSourceDir(p.source), checker(photos));
      spec = r.spec;
      usd = r.calls.reduce((a, c) => a + c.usd, 0);
      for (const c of r.calls) console.log(`direct: ${c.model}${c.repair ? " (repair)" : ""} ${c.input} in / ${c.output} out tokens, about $${c.usd}`);
    } else if (who === "heuristic") {
      spec = directHeuristic(kept, scores, opts);
    } else {
      throw new Error(`unknown director "${who}": use heuristic or claude`);
    }
    writeJson(p.album, spec);
    console.log(`direct (${who}): ${spec.spreads.length} spreads from ${kept.length} kept photos -> ${p.album}`);
    if (spec.spreads.length !== opts.spreads) console.log(`direct: asked for ${opts.spreads} spreads, got ${spec.spreads.length}`);
    done("direct", { director: who, spreads: spec.spreads.length, usd });
    return 0;
  };

  const doBuild = async (renderToo: boolean) => {
    const spec = loadSpec(work);
    const photos = loadPhotos(work);
    const layout = resolveLayout(spec, new Map(photos.map((x) => [x.id, x])), loadProfile(spec.profile));
    const issues = lint(spec, layout);
    writeJson(`${p.out}/lint.json`, issues);
    printIssues(issues);
    const errors = summarize(issues).errors;
    if (!renderToo) {
      done("lint", { errors });
      return errors ? 1 : 0;
    }
    const withPrint = errors === 0 || flags.force === "1";
    const out = await render(spec, layout, issues, readSourceDir(p.source), p.assets, p.out, withPrint);
    const checks = await preflight(out);
    writeJson(`${p.out}/preflight.json`, checks);
    for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
    console.log(`proof: ${out.proof}`);
    console.log(out.print ? `print: ${out.print}` : "print: withheld, the album has lint errors (--force writes it anyway)");
    const failed = checks.filter((c) => !c.ok).length;
    done("build", { errors, preflight_failed: failed, print: !!out.print });
    return errors || failed ? 1 : 0;
  };

  switch (verb) {
    case "sample": {
      const { makeSample } = await import("../scripts/make-sample");
      const n = await makeSample(resolve(rest[0] ?? "sample/photos"), work);
      console.log(`sample: ${n} photos -> ${resolve(rest[0] ?? "sample/photos")}, faces.json and people.json -> ${work}`);
      return 0;
    }
    case "ingest":
      if (!rest[0]) throw new Error("ingest needs a photo directory");
      return doIngest(rest[0]);
    case "cull":
      return doCull();
    case "direct":
      return doDirect();
    case "lint":
      return doBuild(false);
    case "build":
      return doBuild(true);
    case "run": {
      if (!rest[0]) throw new Error("run needs a photo directory");
      const a = await doIngest(rest[0]);
      doCull();
      await doDirect();
      const b = await doBuild(true);
      return a || b;
    }
    case "view": {
      const spec = loadSpec(work);
      const v = await buildViewer(spec, loadProfile(spec.profile), loadPhotos(work), readSourceDir(p.source), p.out);
      console.log(`view: ${v.pages} pages -> ${v.index}`);
      done("view", { pages: v.pages });
      return 0;
    }
    case "profiles":
      for (const pr of listProfiles()) console.log(`${pr.id}  ${pr.pageMm.w}x${pr.pageMm.h} mm  ${pr.export}  ${pr.verified ? "verified" : "UNVERIFIED"}  ${pr.name}`);
      return 0;
    case "themes":
      for (const t of THEMES) console.log(`${t.id}  ${t.description}\n    templates: ${t.templates.join(", ")}`);
      return 0;
    default:
      console.log(USAGE);
      return verb ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`album: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  },
);
