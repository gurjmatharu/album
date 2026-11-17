import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PeopleFileSchema, ProfileSchema, SpecSchema, type AlbumSpec, type Face, type PeopleFile, type Photo, type Profile } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(here, "print", "profiles");

export function listProfiles(): Profile[] {
  return readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ProfileSchema.parse(JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8"))));
}

export function loadProfile(id: string): Profile {
  const p = listProfiles().find((x) => x.id === id);
  if (!p) throw new Error(`no print profile "${id}". Known: ${listProfiles().map((x) => x.id).join(", ")}`);
  return p;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** The files one album run keeps in its work directory. */
export function paths(work: string) {
  return {
    work,
    source: join(work, "source.json"),
    photos: join(work, "photos.json"),
    faces: join(work, "faces.json"),
    people: join(work, "people.json"),
    selects: join(work, "selects.json"),
    album: join(work, "album.json"),
    assets: join(work, "cache", "assets"),
    out: join(work, "out"),
    log: join(work, "log.jsonl"),
  };
}

export function loadPeople(work: string): PeopleFile {
  const p = paths(work).people;
  return existsSync(p) ? PeopleFileSchema.parse(readJson(p)) : { people: [], clusters: {} };
}

/** photos.json with faces.json merged in and face clusters resolved to people. */
export function loadPhotos(work: string): Photo[] {
  const p = paths(work);
  if (!existsSync(p.photos)) throw new Error(`${p.photos} not found: run "album ingest <photo dir>" first`);
  const photos = readJson<Photo[]>(p.photos);
  const faces = existsSync(p.faces) ? readJson<Record<string, Face[]>>(p.faces) : {};
  const { clusters } = loadPeople(work);
  for (const photo of photos) {
    photo.faces = (faces[photo.id] ?? []).map((f) => ({ ...f, person: f.person ?? (f.cluster ? clusters[f.cluster] : undefined) }));
  }
  return photos;
}

export function loadSpec(work: string): AlbumSpec {
  const p = paths(work).album;
  if (!existsSync(p)) throw new Error(`${p} not found: run "album direct" first`);
  return SpecSchema.parse(readJson(p));
}

/** One line per stage per run: what ran, how long, what it cost. */
export function logStage(work: string, stage: string, fields: Record<string, unknown>): void {
  mkdirSync(work, { recursive: true });
  appendFileSync(paths(work).log, JSON.stringify({ at: new Date().toISOString(), stage, ...fields }) + "\n");
}
