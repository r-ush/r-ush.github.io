"""Locate the standalone grippers in their parent STL assemblies.

Matches rotation-invariant triangle edge lengths, then verifies each rigid
transform against the parent vertices. This is an offline build tool (NumPy,
SciPy); the browser only receives the resulting normalized transforms.
"""
from pathlib import Path
import json
import numpy as np
from scipy.spatial import cKDTree
from build_points import ROOT, SOURCES, TRIANGLE


def load_mesh(number):
    filename = next(s[0] for s in SOURCES if s[3] == number)
    path = ROOT / "Robot STL" / filename
    with path.open("rb") as stream:
        stream.seek(80)
        count = int.from_bytes(stream.read(4), "little")
    return np.memmap(path, dtype=TRIANGLE, mode="r", offset=84, shape=(count,))["v"].astype(np.float64)


def edge_features(v):
    # Edge i is opposite vertex i, allowing a rotation-invariant vertex order.
    lengths = np.linalg.norm(v[:, [1, 2, 0]] - v[:, [2, 0, 1]], axis=2)
    order = np.argsort(lengths, axis=1)
    return np.sort(lengths, axis=1), order


def rigid_fit(source, target):
    a, b = source.mean(axis=0), target.mean(axis=0)
    u, _, vt = np.linalg.svd((source - a).T @ (target - b))
    rotation = vt.T @ u.T
    if np.linalg.det(rotation) < 0:
        vt[-1] *= -1
        rotation = vt.T @ u.T
    return rotation, b - rotation @ a


def register(child_number, parent_number, mirrored=False, excluded_center=None):
    child, parent = load_mesh(child_number), load_mesh(parent_number)
    reflection = np.diag([-1., 1., 1.])
    if mirrored:
        child = child @ reflection.T
    child_center = (child.min(axis=(0, 1)) + child.max(axis=(0, 1))) / 2
    child_edges, child_order = edge_features(child)
    parent_edges, parent_order = edge_features(parent)
    feature_tree = cKDTree(parent_edges)
    target_tree = cKDTree(parent.reshape(-1, 3))
    rng = np.random.default_rng(451)
    # Larger triangles avoid unstable frames and repetitive tessellation noise.
    eligible = np.flatnonzero((child_edges[:, 0] > 2) & (child_edges[:, -1] > 8))
    chosen = rng.choice(eligible, min(10000, len(eligible)), replace=False)
    distances, indices = feature_tree.query(child_edges[chosen], k=4, distance_upper_bound=.045)
    candidates = np.argwhere(np.isfinite(distances))
    rng.shuffle(candidates)
    vertices = child.reshape(-1, 3)
    probe = vertices[rng.choice(len(vertices), 160, replace=False)]
    verification = vertices[rng.choice(len(vertices), 5000, replace=False)]
    best = []
    seen = set()
    for row, col in candidates[:2500]:
        ci, pi = chosen[row], indices[row, col]
        a, b = child[ci][child_order[ci]], parent[pi][parent_order[pi]]
        # Reject nearly collinear triangles.
        if np.linalg.norm(np.cross(a[1] - a[0], a[2] - a[0])) < 1:
            continue
        rotation, translation = rigid_fit(a, b)
        if excluded_center is not None and np.linalg.norm(rotation @ child_center + translation - excluded_center) < 300:
            continue
        key = tuple(np.round(rotation.reshape(-1), 2)) + tuple(np.round(translation, 0))
        if key in seen:
            continue
        seen.add(key)
        d, _ = target_tree.query(probe @ rotation.T + translation, distance_upper_bound=.8)
        score = np.mean(d < .15)
        if score > .25:
            dv, _ = target_tree.query(verification @ rotation.T + translation)
            final_score = float(np.mean(dv < .15))
            best.append((final_score, float(np.median(dv)), rotation, translation))
    if not best:
        raise RuntimeError(f"No supported match for {child_number} -> {parent_number}")
    best.sort(key=lambda result: (-result[0], result[1]))
    score, median, rotation, translation = best[0]
    # Refine on matched vertices only, keeping the CAD units fixed (no scaling).
    for _ in range(5):
        moved = verification @ rotation.T + translation
        dist, nearest = target_tree.query(moved)
        keep = dist < .5
        rotation, translation = rigid_fit(verification[keep], parent.reshape(-1, 3)[nearest[keep]])
    final_d, _ = target_tree.query(verification @ rotation.T + translation)
    result = dict(child=child_number, parent=parent_number, rotation=rotation.tolist(),
                  translation=translation.tolist(), inlierFraction=float(np.mean(final_d < .15)),
                  medianError=float(np.median(final_d)),
                  p90Error=float(np.quantile(final_d, .9)))
    if mirrored:
        result["reflection"] = reflection.tolist()
        result["centerDistanceFromOtherHand"] = float(np.linalg.norm(rotation @ child_center + translation - excluded_center))
    print(json.dumps(result), flush=True)
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mirror-only", action="store_true", help="Reuse existing primary registrations")
    args = parser.parse_args()
    output = Path(__file__).with_name("part-transforms.json")
    results = json.loads(output.read_text(encoding="utf-8")) if args.mirror_only else [register(a, b) for a, b in [("01", "02"), ("03", "04"), ("05", "06")]]
    hand = next(result for result in results if result["child"] == "05")
    mesh = load_mesh("05")
    center = (mesh.min(axis=(0, 1)) + mesh.max(axis=(0, 1))) / 2
    mounted_center = np.asarray(hand["rotation"]) @ center + np.asarray(hand["translation"])
    hand["mirror"] = register("05", "06", mirrored=True, excluded_center=mounted_center)
    output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
