# cv: the face worker

Finds faces in the ingested photos and groups them by person, locally. Not yet run on real
photos: see [../docs/OPEN-ISSUES.md](../docs/OPEN-ISSUES.md) issue 1.

```bash
uv run --project cv python cv/cv_worker.py version
uv run --project cv python cv/cv_worker.py faces <photo dir> <work dir>
```

It reads `<work>/photos.json` and writes `<work>/faces.json`, a strip of sample crops per
cluster in `<work>/faces/`, and a starter `<work>/people.json` if none exists. Then you name
the people:

```json
{
  "people": [
    { "id": "bride", "name": "Simran", "minAppearances": 12 },
    { "id": "nani", "name": "Nani", "minAppearances": 3 }
  ],
  "clusters": { "c001": "bride", "c007": "nani", "c019": "nani" }
}
```

One person often lands in two or three clusters (glasses, profile shots); map them all to
the same id. Faces in no cluster stay anonymous: they are still protected from the fold and
the crop, but count for nobody.

The first run downloads the InsightFace `buffalo_l` weights, which are licensed for
non-commercial use only.
