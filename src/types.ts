import { z } from "zod";

/** A face box in fractions of the (orientation-corrected) photo. */
export const FaceSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** Cluster id from the cv worker; `people.json` maps it to a person. */
  cluster: z.string().optional(),
  person: z.string().optional(),
  /** 0 = closed, 1 = open. Absent means not measured. */
  eyesOpen: z.number().optional(),
  /** Which way the person looks, as seen in the picture. Absent means not measured. */
  gaze: z.enum(["left", "right", "front"]).optional(),
});
export type Face = z.infer<typeof FaceSchema>;

export interface Photo {
  /** First 10 hex chars of the file's sha256: stable across runs and renames. */
  id: string;
  /** Path relative to the source directory. */
  path: string;
  sha: string;
  bytes: number;
  mtimeMs: number;
  /** Pixel size after applying the EXIF orientation. */
  width: number;
  height: number;
  takenAt: string;
  timeSource: "exif" | "mtime";
  /** Variance of the Laplacian on a 512 px grey preview. Higher is sharper. */
  sharpness: number;
  /** 64-bit difference hash, 16 hex chars. */
  dhash: string;
  /** Mean colour of the picture in CIELAB, and mean chroma (0 = grey). Absent on photos ingested before this was measured. */
  tone?: { l: number; a: number; b: number; chroma: number };
  faces: Face[];
}

export interface Person {
  id: string;
  name: string;
  /** Minimum number of album slots this person must be fully visible in. */
  minAppearances: number;
}

export const PeopleFileSchema = z.object({
  people: z.array(z.object({ id: z.string(), name: z.string(), minAppearances: z.number().int().min(0) })),
  /** cluster id -> person id */
  clusters: z.record(z.string(), z.string()),
});
export type PeopleFile = z.infer<typeof PeopleFileSchema>;

export const SlotSpecSchema = z.object({
  slot: z.string(),
  photo: z.string(),
  /** Optional point of interest, fractions of the photo. Overrides the face centre. */
  focus: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Pull a detail: crop this many times tighter around `focus` (1 = the whole fitted frame). The resolution lint guards it. */
  zoom: z.number().min(1).max(4).optional(),
});

/**
 * The cover, laid out flat like a wraparound without its spine: the back cover is the left
 * page, the front cover the right. Uses a `cover-*` template. The spine is its own file.
 */
export const CoverSchema = z.object({
  template: z.string(),
  slots: z.array(SlotSpecSchema),
  text: z.record(z.string(), z.string()).optional(),
  background: z.string().optional(),
  spine: z
    .object({
      /** From the lab for this page count (Prodigi: GET /catalogue/variants/{sku}/spine). */
      widthMm: z.number().positive(),
      /** True until the width came from the lab; the build warns. */
      estimated: z.boolean().optional(),
      text: z.string().optional(),
      background: z.string().optional(),
    })
    .optional(),
});

/**
 * A single page outside the spreads: the first content page (a right-hand page facing the
 * blank inside front cover) or the last (a left-hand page facing the blank inside back cover),
 * where a lab binds the PDF that way (Prodigi layflat). Uses a `page-*` template.
 */
export const PageSpecSchema = z.object({
  template: z.string(),
  slots: z.array(SlotSpecSchema).default([]),
  text: z.record(z.string(), z.string()).optional(),
  background: z.string().optional(),
});

export const SpecSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  profile: z.string(),
  /** The album's art direction: an id from src/themes.ts. */
  theme: z.string(),
  background: z.string(),
  /** The creative brief: one idea the whole book serves, and how it unfolds. Directors write it first. */
  brief: z
    .object({
      idea: z.string(),
      arc: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  cover: CoverSchema.optional(),
  /** First content page, a right-hand page on its own (a title page). */
  firstPage: PageSpecSchema.optional(),
  /** Last content page, a left-hand page on its own (a colophon). */
  lastPage: PageSpecSchema.optional(),
  /** Print prep (src/prep.ts): "auto" when absent; "off" prints the pictures exactly as delivered. */
  prep: z.enum(["auto", "off"]).optional(),
  people: z.array(z.object({ id: z.string(), name: z.string(), minAppearances: z.number().int().min(0) })),
  spreads: z.array(
    z.object({
      id: z.string(),
      chapter: z.string(),
      template: z.string(),
      /** The spread's job in the sequence; the reviewer judges it against this. */
      role: z.enum(["opener", "statement", "portrait", "pairing", "detail", "sequence", "pause", "closer"]).optional(),
      /** One line: what this spread should make the reader feel or notice. */
      intent: z.string().optional(),
      /** Page colour for this spread when it differs from the album's (a dark chapter, say). */
      background: z.string().optional(),
      /** Words for the template's text boxes, by box id (a title, a date, a short caption). */
      text: z.record(z.string(), z.string()).optional(),
      slots: z.array(SlotSpecSchema),
    }),
  ),
});
export type AlbumSpec = z.infer<typeof SpecSchema>;
export type SpreadSpec = AlbumSpec["spreads"][number];

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  /** The lab's product code, when it has one (Prodigi catalogue SKU). */
  sku: z.string().optional(),
  pageMm: z.object({ w: z.number().positive(), h: z.number().positive() }),
  bleedMm: z.number().min(0),
  /** Faces closer than this to a trim edge are warned about. */
  safeMm: z.number().min(0),
  /** Half-width of the band around the fold where no face may sit. */
  gutterSafeMm: z.number().min(0),
  /** Resolution assets are resampled to. */
  dpi: z.number().positive(),
  /** A slot under this effective resolution fails the lint. */
  minDpi: z.number().positive(),
  pages: z.object({ min: z.number().int(), max: z.number().int(), multiple: z.number().int().positive() }),
  export: z.enum(["pdf-pages", "pdf-spreads", "jpg-spreads"]),
  /** "in-book": the lab wants the front cover as page 1 and the back cover last in one PDF (book.pdf). Else cover.pdf on its own. */
  cover: z.enum(["in-book", "separate"]).optional(),
  /** False until the numbers were checked against the lab's own spec. */
  verified: z.boolean(),
  notes: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Severity = "error" | "warning";
export interface Issue {
  severity: Severity;
  rule: string;
  spread?: string;
  slot?: string;
  photo?: string;
  message: string;
}
