"""Face worker: find every face in the ingested photos, group them by person.

    uv run --project cv python cv/cv_worker.py version
    uv run --project cv python cv/cv_worker.py faces <photo dir> <work dir>

`faces` reads <work>/photos.json and writes:
  <work>/faces.json           {photo id: [{x, y, w, h, cluster}]}, boxes in fractions of the photo
  <work>/faces/<cluster>.jpg  up to 8 sample crops per cluster, largest clusters first
  <work>/people.json          only if absent: the clusters to name, all unassigned

Then a person edits people.json: add people and map cluster ids to them.

NOT YET RUN on real photos (docs/OPEN-ISSUES.md #1). The DBSCAN threshold is a starting value.
The buffalo_l weights are licensed for non-commercial use only.
"""
import json
import sys
from pathlib import Path

VERSION = "0.1.0"
MIN_FACE_FRACTION = 0.02  # ignore faces narrower than 2% of the photo: background guests
DBSCAN_EPS = 0.5  # cosine distance; lower splits one person into several clusters
DBSCAN_MIN_SAMPLES = 3


def faces(photo_dir: Path, work: Path) -> None:
    import cv2
    import numpy as np
    from insightface.app import FaceAnalysis
    from sklearn.cluster import DBSCAN

    photos = json.loads((work / "photos.json").read_text())
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))

    found = []  # (photo id, box, embedding, crop)
    for i, photo in enumerate(photos):
        img = cv2.imread(str(photo_dir / photo["path"]))  # applies the EXIF orientation
        if img is None:
            print(f"faces: cannot read {photo['path']}", file=sys.stderr)
            continue
        h, w = img.shape[:2]
        scale = 1600 / max(h, w) if max(h, w) > 1600 else 1.0
        small = cv2.resize(img, None, fx=scale, fy=scale) if scale < 1 else img
        for f in app.get(small):
            x1, y1, x2, y2 = [float(v) / scale for v in f.bbox]
            x1, y1, x2, y2 = max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)
            if (x2 - x1) / w < MIN_FACE_FRACTION:
                continue
            crop = cv2.resize(img[int(y1):int(y2), int(x1):int(x2)], (160, 160))
            box = {"x": x1 / w, "y": y1 / h, "w": (x2 - x1) / w, "h": (y2 - y1) / h}
            found.append((photo["id"], box, f.normed_embedding, crop))
        if (i + 1) % 100 == 0:
            print(f"faces: {i + 1}/{len(photos)} photos, {len(found)} faces", file=sys.stderr)

    out = {p["id"]: [] for p in photos}
    clusters = {}
    if found:
        labels = DBSCAN(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, metric="cosine").fit_predict(np.stack([f[2] for f in found]))
        order = [l for l, _ in sorted(((l, int((labels == l).sum())) for l in set(labels) if l != -1), key=lambda t: -t[1])]
        name = {l: f"c{n + 1:03d}" for n, l in enumerate(order)}
        for (pid, box, _, crop), label in zip(found, labels):
            entry = dict(box)
            if label != -1:
                entry["cluster"] = name[label]
                clusters.setdefault(name[label], []).append(crop)
            out[pid].append(entry)
        (work / "faces").mkdir(exist_ok=True)
        for cid, crops in clusters.items():
            cv2.imwrite(str(work / "faces" / f"{cid}.jpg"), np.hstack(crops[:8]))

    (work / "faces.json").write_text(json.dumps(out, indent=1) + "\n")
    people = work / "people.json"
    if not people.exists():
        people.write_text(json.dumps({"people": [], "clusters": {}, "_unassigned": {c: len(v) for c, v in clusters.items()}}, indent=2) + "\n")
    print(f"faces: {len(found)} faces in {len(photos)} photos, {len(clusters)} clusters -> {work / 'faces.json'}")


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["version"]:
        print(VERSION)
        return 0
    if args[:1] == ["faces"] and len(args) == 3:
        faces(Path(args[1]), Path(args[2]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
