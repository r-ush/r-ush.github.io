"""Build particle identities shared by a gripper and its parent assembly."""
import base64
import numpy as np
from scipy.spatial import cKDTree

CAD_TO_SCENE = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)


def surface_distances(points, triangles):
    """Distance to nearby triangle surfaces, including large planar faces.

    Candidates come from both triangle centroids and vertices. This is used only
    to select shared surfaces, not to alter the rigid CAD registration.
    """
    centroid_tree = cKDTree(triangles.mean(axis=1))
    vertex_tree = cKDTree(triangles.reshape(-1, 3))
    output = np.empty(len(points))
    for start in range(0, len(points), 512):
        query = points[start:start + 512]
        _, centroid_ids = centroid_tree.query(query, k=24)
        _, vertex_ids = vertex_tree.query(query, k=16)
        ids = np.concatenate((centroid_ids, vertex_ids // 3), axis=1)
        tri = triangles[ids]
        a, b, c = tri[:, :, 0], tri[:, :, 1], tri[:, :, 2]
        p = query[:, None, :]
        ab, ac, ap = b - a, c - a, p - a
        dot = lambda x, y: np.sum(x * y, axis=-1)
        aa, bb, cc = dot(ab, ab), dot(ab, ac), dot(ac, ac)
        denominator = aa * cc - bb * bb
        valid = denominator > 1e-14
        safe = np.where(valid, denominator, 1)
        u = (cc * dot(ap, ab) - bb * dot(ap, ac)) / safe
        v = (aa * dot(ap, ac) - bb * dot(ap, ab)) / safe
        projected = a + u[:, :, None] * ab + v[:, :, None] * ac
        inside = valid & (u >= 0) & (v >= 0) & (u + v <= 1)
        dist2 = np.where(inside, dot(p - projected, p - projected), np.inf)
        for x, y in [(a, b), (b, c), (c, a)]:
            edge = y - x
            t = np.clip(dot(p - x, edge) / np.maximum(dot(edge, edge), 1e-20), 0, 1)
            delta = p - x - t[:, :, None] * edge
            dist2 = np.minimum(dist2, dot(delta, delta))
        output[start:start + len(query)] = np.sqrt(dist2.min(axis=1))
    return output


def decode(model):
    return np.frombuffer(base64.b64decode(model["data"]), dtype="<i2").reshape(-1, 6).astype(float) / 32767


def link(models, registrations, load_mesh):
    by_number = {model["number"]: model for model in models}
    for registration in registrations:
        child, parent = by_number[registration["child"]], by_number[registration["parent"]]
        child_points, parent_points = decode(child), decode(parent)
        rotation = np.asarray(registration["rotation"])
        translation = np.asarray(registration["translation"])
        child_center, parent_center = np.asarray(child["center"]), np.asarray(parent["center"])
        child_raw = child_points[:, :3] @ CAD_TO_SCENE * child["scale"] + child_center
        moved = child_raw @ rotation.T + translation
        parent_mesh = load_mesh(parent["number"])
        distances = surface_distances(moved, parent_mesh)
        eligible = np.flatnonzero(distances < .8)
        mirror = registration.get("mirror")
        if mirror:
            mirror_rotation = np.asarray(mirror["rotation"])
            reflection = np.asarray(mirror["reflection"])
            mirror_transform = mirror_rotation @ reflection
            mirror_translation = np.asarray(mirror["translation"])
            mirror_distances = surface_distances(child_raw @ mirror_transform.T + mirror_translation, parent_mesh)
            eligible = np.flatnonzero((distances < .8) & (mirror_distances < .8))
        if len(eligible) < child["count"] * .2:
            raise ValueError(f"Insufficient shared surfaces for {child['number']} -> {parent['number']}")
        anchor_count = min(9000 if mirror else 12000, len(eligible))
        anchor_ids = eligible[np.linspace(0, len(eligible) - 1, anchor_count).astype(int)]
        mask = np.zeros(child["count"], dtype=np.uint8)
        mask[anchor_ids] = 1
        if mirror:
            # The same samples form both hands. Destination/source parity is
            # matched so the every-other-point mobile subset remains exact.
            mirror_sources = np.arange(child["count"], dtype=np.uint16)
            for parity in (0, 1):
                selected = anchor_ids[anchor_ids % 2 == parity]
                available = np.flatnonzero((mask == 0) & (np.arange(child["count"]) % 2 == parity))
                destinations = available[np.linspace(0, len(available) - 1, len(selected)).astype(int)]
                mask[destinations] = 2
                mirror_sources[destinations] = selected
            mirror_ids = np.flatnonzero(mask == 2)
        normalized_rotation = CAD_TO_SCENE @ rotation @ CAD_TO_SCENE.T
        normalized_scale = child["scale"] / parent["scale"]
        normalized_translation = CAD_TO_SCENE @ (rotation @ child_center + translation - parent_center) / parent["scale"]
        anchor_points = child_points[anchor_ids].copy()
        anchor_points[:, :3] = anchor_points[:, :3] @ normalized_rotation.T * normalized_scale + normalized_translation
        anchor_points[:, 3:] = anchor_points[:, 3:] @ normalized_rotation.T
        # Draw the parent context from surfaces outside the matched gripper.
        parent_raw = parent_points[:, :3] @ CAD_TO_SCENE * parent["scale"] + parent_center
        in_child = (parent_raw - translation) @ rotation
        parent_distances = surface_distances(in_child, load_mesh(child["number"]))
        context_mask = parent_distances > 1.0
        if mirror:
            in_mirrored_child = (parent_raw - mirror_translation) @ mirror_transform
            other_hand_distances = surface_distances(in_mirrored_child, load_mesh(child["number"]))
            context_mask &= other_hand_distances > 1.0
        context = parent_points[context_mask]
        if len(context) < 1000:
            raise ValueError("Parent context is unexpectedly empty")
        context_count = int(np.sum(mask == 0))
        # Sampling with replacement preserves the ordered surface distribution.
        context = context[np.linspace(0, len(context) - 1, context_count).astype(int)]
        linked = np.empty_like(parent_points)
        linked[mask == 1] = anchor_points
        if mirror:
            mirror_normalized_rotation = CAD_TO_SCENE @ mirror_rotation @ CAD_TO_SCENE.T
            normalized_reflection = CAD_TO_SCENE @ reflection @ CAD_TO_SCENE.T
            mirror_normalized_transform = mirror_normalized_rotation @ normalized_reflection
            mirror_normalized_translation = CAD_TO_SCENE @ (mirror_transform @ child_center + mirror_translation - parent_center) / parent["scale"]
            mirror_points = child_points[mirror_sources[mirror_ids]].copy()
            mirror_points[:, :3] = mirror_points[:, :3] @ mirror_normalized_transform.T * normalized_scale + mirror_normalized_translation
            mirror_points[:, 3:] = mirror_points[:, 3:] @ mirror_normalized_transform.T
            linked[mask == 2] = mirror_points
        linked[mask == 0] = context
        if np.max(np.abs(linked)) > 1.001:
            raise ValueError("Linked geometry exceeds normalized parent bounds")
        parent["data"] = base64.b64encode(np.rint(linked * 32767).astype("<i2").tobytes()).decode("ascii")
        parent["attachment"] = {
            "child": child["number"],
            "anchors": base64.b64encode(mask.tobytes()).decode("ascii"),
            "anchorCount": int(np.count_nonzero(mask)),
            "primaryAnchorCount": anchor_count,
            "rotation": normalized_rotation.reshape(-1).tolist(),
            "translation": normalized_translation.tolist(),
            "scale": normalized_scale,
            "surfaceMatchFraction": float(len(eligible) / child["count"]),
            "anchorMaxErrorMm": float(distances[anchor_ids].max()),
        }
        if mirror:
            parent["attachment"]["mirror"] = {
                "rotation": mirror_normalized_rotation.reshape(-1).tolist(),
                "reflection": normalized_reflection.reshape(-1).tolist(),
                "translation": mirror_normalized_translation.tolist(),
                "sourceIndices": base64.b64encode(mirror_sources.astype("<u2").tobytes()).decode("ascii"),
                "anchorCount": len(mirror_ids),
                "anchorMaxErrorMm": float(mirror_distances[anchor_ids].max()),
            }
        child["parent"] = parent["number"]
        print(f"{child['number']} -> {parent['number']}: {anchor_count:,} shared particles, "
              f"{len(eligible) / child['count']:.1%} surface match, scale {normalized_scale:.3f}", flush=True)
        if mirror:
            print(f"  mirrored copy: {len(mirror_ids):,} points; parent context: {context_count:,} points", flush=True)
    return models
