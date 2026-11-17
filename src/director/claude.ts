import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import { z } from "zod";
import { CATALOG } from "../catalog";
import { slotRectMm } from "../layout";
import { isMono, themeById, type Theme } from "../themes";
import type { AlbumSpec, Issue, Photo } from "../types";
import type { DirectOptions } from "./heuristic";

export const DIRECTOR_MODEL = "claude-opus-5-5";
/** List prices in $ per million tokens, for the cost line in log.jsonl only. */
const PRICE = { input: 4, output: 20 };

const Output = z.object({
  title: z.string(),
  spreads: z.array(
    z.object({
      chapter: z.string(),
      template: z.string(),
      slots: z.array(z.object({ slot: z.string(), photo: z.string() })),
    }),
  ),
});

const SYSTEM = `You design the interior of a printed wedding album. You are given the day's kept photos (a table and contact sheets labelled with photo ids), the people who matter, and a catalog of spread templates. You return the album as data: an ordered list of spreads, each naming one template and the photo for every slot. A program renders it; you never write layout code.

What makes a good album: it tells the day in order, in chapters (getting ready, ceremony, portraits, reception, dancing, or whatever this day had). It opens and closes each chapter on a strong picture. It alternates quiet spreads (one or two pictures) with busy ones, and does not use the same template three times running. The lead slot of a spread gets the picture a person would stop on.

Design each spread as one composition across both pages, the way a photo editor pairs pictures:
- One idea per spread: one moment, one place, one light. Do not put the ceremony beside the dance floor.
- The pictures on a spread share colour and light. Warm with warm, cool with cool, never black-and-white beside colour. The table gives each photo's tone.
- Vary scale inside a spread: a wide scene with a close detail or a portrait says more than three pictures at the same distance.
- People look into the spread, toward the fold, not off the outer edge. Motion and leading lines run toward the facing page.
- Do not repeat the same person at the same size on both pages unless the repetition is the point.
- Give the strongest pictures the fewest neighbours. A spread with one picture is a statement; use it for the pictures that deserve it.
- Hold the album's theme from first spread to last. You may only use the theme's templates.

A program checks your album and rejects it for any of these, so avoid them:
- a photo used twice, or two frames of the same burst
- a face cut by the crop or sitting on the fold (a template whose slot crosses the fold needs a photo with no face in the middle)
- a small photo in a large slot (the table gives each photo's pixel size)
- a named person appearing in fewer slots than their minimum
- a slot left empty, a template outside the theme, or a template or photo id that does not exist
- black-and-white and colour pictures on the same spread
Match each photo's shape to its slot's shape; the crop keeps the largest area of the slot's shape and loses the rest.`;

async function contactSheets(photos: Photo[], sourceDir: string): Promise<Buffer[]> {
  const cell = 300;
  const cols = 6;
  const rows = 5;
  const sheets: Buffer[] = [];
  for (let i = 0; i < photos.length; i += cols * rows) {
    const batch = photos.slice(i, i + cols * rows);
    const tiles = await Promise.all(
      batch.map(async (ph, k) => {
        const thumb = await sharp(join(sourceDir, ph.path)).rotate().resize(cell, cell - 30, { fit: "contain", background: "#222" }).toBuffer();
        const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="30"><rect width="100%" height="100%" fill="#000"/><text x="6" y="21" font-family="monospace" font-size="18" fill="#fff">${ph.id}</text></svg>`);
        const left = (k % cols) * cell;
        const top = Math.floor(k / cols) * cell;
        return [{ input: thumb, left, top }, { input: label, left, top: top + cell - 30 }];
      }),
    );
    sheets.push(
      await sharp({ create: { width: cols * cell, height: Math.ceil(batch.length / cols) * cell, channels: 3, background: "#222" } })
        .composite(tiles.flat())
        .jpeg({ quality: 80 })
        .toBuffer(),
    );
  }
  return sheets;
}

function brief(photos: Photo[], scores: Map<string, number>, opts: DirectOptions, theme: Theme): string {
  const p = opts.profile;
  const catalog = CATALOG.filter((t) => theme.templates.includes(t.id)).map((t) => ({
    id: t.id,
    description: t.description,
    slots: t.slots.map((s) => {
      const r = slotRectMm(s, p);
      return { slot: s.id, lead: s.hero, width_mm: Math.round(r.w), height_mm: Math.round(r.h), crosses_fold: r.x < p.pageMm.w && r.x + r.w > p.pageMm.w, min_width_px: Math.ceil((r.w / 25.4) * p.minDpi) };
    }),
  }));
  const table = photos
    .map((ph) => {
      const who = ph.faces.map((f) => (f.person ?? "guest") + (f.gaze && f.gaze !== "front" ? `(looks ${f.gaze})` : "")).join(",") || "-";
      const tone = !ph.tone ? "?" : isMono(ph) ? "b&w" : `${ph.tone.b > 8 ? "warm" : ph.tone.b < -4 ? "cool" : "neutral"}/${ph.tone.l > 62 ? "light" : ph.tone.l < 38 ? "dark" : "mid"}`;
      return `${ph.id} ${ph.takenAt.slice(11, 16)} ${ph.width}x${ph.height} score=${(scores.get(ph.id) ?? 0).toFixed(2)} tone=${tone} faces=${who}`;
    })
    .join("\n");
  return `Album: "${opts.title}". Make exactly ${opts.spreads} spreads (${opts.spreads * 2} pages). Page ${p.pageMm.w} x ${p.pageMm.h} mm.

Theme: ${theme.id}. ${theme.description} Page colour ${theme.background}.

People and the minimum number of slots each must be fully visible in:
${opts.people.map((x) => `- ${x.id} (${x.name}): ${x.minAppearances}`).join("\n") || "- none named"}

Template catalog:
${JSON.stringify(catalog, null, 1)}

Photos (id, time of day, pixel size, cull score 0-1, tone, faces left to right):
${table}`;
}

export interface ClaudeResult {
  spec: AlbumSpec;
  calls: { model: string; input: number; output: number; usd: number; repair: boolean }[];
}

async function ask(client: Anthropic, content: Anthropic.Beta.BetaContentBlockParam[], repair: boolean): Promise<{ out: z.infer<typeof Output>; call: ClaudeResult["calls"][number] }> {
  // Streamed: a long thinking pass on a few hundred photos can outlast a plain request's timeout.
  const message = await client.beta.messages
    .stream({
      model: DIRECTOR_MODEL,
      max_tokens: 32000,
      // If a safety classifier declines the request, the API re-runs it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "high", format: zodOutputFormat(Output) },
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  if (message.stop_reason === "refusal") throw new Error(`director: the model declined the request (${message.stop_details?.category ?? "no category"})`);
  if (message.stop_reason === "max_tokens") throw new Error("director: the reply hit max_tokens before the album was complete");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = Output.parse(JSON.parse(text));
  const input = message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
  const output = message.usage.output_tokens;
  return { out, call: { model: message.model, input, output, usd: Math.round(((input * PRICE.input + output * PRICE.output) / 1e6) * 1000) / 1000, repair } };
}

/**
 * The model director. One call writes the album; if the lints reject it, one fresh call
 * (not a continuation) gets the rejected album and the error list and writes it again.
 * Needs ANTHROPIC_API_KEY. Not yet run against the live API: see docs/OPEN-ISSUES.md.
 */
export async function directClaude(photos: Photo[], scores: Map<string, number>, opts: DirectOptions, sourceDir: string, check: (spec: AlbumSpec) => Issue[]): Promise<ClaudeResult> {
  const client = new Anthropic();
  const sheets = await contactSheets(photos, sourceDir);
  const images: Anthropic.Beta.BetaContentBlockParam[] = sheets.map((s) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: s.toString("base64") } }));
  const theme = themeById(opts.theme);
  if (!theme) throw new Error(`no theme "${opts.theme}"`);
  const text = brief(photos, scores, opts, theme);
  const toSpec = (o: z.infer<typeof Output>): AlbumSpec => ({
    version: 1,
    title: o.title,
    profile: opts.profile.id,
    theme: theme.id,
    background: theme.background,
    people: opts.people,
    spreads: o.spreads.map((s, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, ...s })),
  });

  const first = await ask(client, [...images, { type: "text", text }], false);
  let spec = toSpec(first.out);
  const calls = [first.call];
  const errors = check(spec).filter((i) => i.severity === "error");
  if (errors.length > 0) {
    const fix = `${text}\n\nA previous attempt was rejected. Here it is, then the errors. Return the whole album again with every error fixed and nothing else changed without reason.\n\nRejected album:\n${JSON.stringify(first.out)}\n\nErrors:\n${errors.map((e) => `- ${e.rule}: ${e.message}`).join("\n")}`;
    const second = await ask(client, [...images, { type: "text", text: fix }], true);
    spec = toSpec(second.out);
    calls.push(second.call);
  }
  return { spec, calls };
}
