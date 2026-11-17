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

export const SpecSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  profile: z.string(),
  /** The album's art direction: an id from src/themes.ts. */
  theme: z.string(),
  background: z.string(),
  people: z.array(z.object({ id: z.string(), name: z.string(), minAppearances: z.number().int().min(0) })),
  spreads: z.array(
    z.object({
      id: z.string(),
      chapter: z.string(),
      template: z.string(),
      slots: z.array(
        z.object({
          slot: z.string(),
          photo: z.string(),
          /** Optional point of interest, fractions of the photo. Overrides the face centre. */
          focus: z.object({ x: z.number(), y: z.number() }).optional(),
        }),
      ),
    }),
  ),
});
export type AlbumSpec = z.infer<typeof SpecSchema>;
export type SpreadSpec = AlbumSpec["spreads"][number];

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
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
