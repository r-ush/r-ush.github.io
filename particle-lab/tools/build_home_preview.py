"""Generate static surface previews and a local-only copy of the complete homepage."""
from pathlib import Path
import base64
import json
import re
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]


def rotation(roll, pitch, yaw):
    r, p, y = np.deg2rad([roll, pitch, yaw])
    cr, sr, cp, sp, cy, sy = np.cos(r), np.sin(r), np.cos(p), np.sin(p), np.cos(y), np.sin(y)
    return np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
                     [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]])


def main():
    homepage = (ROOT / 'index.html').read_text(encoding='utf-8')
    records = json.loads((ROOT / 'particle-lab/models.js').read_text(encoding='utf-8').split(' = ', 1)[1].rstrip(';\n'))
    c = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])
    view = rotation(np.rad2deg(.18), 0, 0) @ rotation(0, np.rad2deg(-.5), 0)
    images = ROOT / 'assets/images'
    images.mkdir(parents=True, exist_ok=True)
    for index, hex_color in zip([0, 2, 4], ['34596e', '675a78', '3a685d']):
        model, parent = records[index:index + 2]
        points = np.frombuffer(base64.b64decode(model['data']), dtype='<i2').reshape(-1, 6)[::2].astype(float) / 32767
        parent_points = np.frombuffer(base64.b64decode(parent['data']), dtype='<i2').reshape(-1, 6)[::2].astype(float) / 32767
        r = c @ rotation(**model['defaultPose']) @ c.T
        positions = points[:, :3] @ r.T @ view.T
        normals = points[:, 3:] @ r.T @ view.T
        radius = max(np.linalg.norm(points[:, :3], axis=1).max(), np.linalg.norm(parent_points[:, :3], axis=1).max(), 1.35)
        projected = radius * 4.8 / np.sqrt(4.8 ** 2 - radius ** 2)
        scale = min(600 * .45, 560 * .43) / projected
        figure = re.search(r'<figure\b[^>]*data-child="' + model['number'] + r'"[^>]*>', homepage).group(0)
        requested_zoom = float(re.search(r'data-child-scale="([^"]+)"', figure).group(1))
        envelope = np.zeros(4)
        for step in range(72):
            spin_view = rotation(np.rad2deg(.18), 0, 0) @ rotation(0, np.rad2deg(step * np.pi / 36 - .5), 0)
            spun = points[::8, :3] @ r.T @ spin_view.T
            projected_xy = spun[:, :2] * (4.8 / (4.8 - spun[:, 2]))[:, None]
            envelope = np.maximum(envelope, [-projected_xy[:, 0].min(), projected_xy[:, 0].max(),
                                             projected_xy[:, 1].max(), -projected_xy[:, 1].min()])
        room = np.array([300 - 6, 300 - 6, 560 * .47 - 6, 560 * .53 - 6])
        scale *= min(requested_zoom, (room / (envelope * 1.025 * scale)).min())
        perspective = 4.8 / (4.8 - positions[:, 2])
        xy = positions[:, :2] * [1, -1] * perspective[:, None] * scale + [300, 560 * .47]
        shade = np.clip(.42 + normals @ [-.2, .25, .33] + positions[:, 2] * .12, .08, 1)
        color = np.array([int(hex_color[i:i + 2], 16) for i in [0, 2, 4]])
        image = Image.new('RGB', (600, 560), 'white'); draw = ImageDraw.Draw(image)
        for i in np.argsort(positions[:, 2]):
            x, y = xy[i]
            alpha = .25 + shade[i] * .7
            rgb = 255 * (1 - alpha) + color * (.6 + shade[i] * .4) * alpha
            point_size = perspective[i] * 2
            draw.ellipse((x, y, x + point_size, y + point_size), fill=tuple(np.clip(rgb, 0, 255).astype(int)))
        output = images / f"graspical-{model['number']}.webp"
        image.save(output, quality=90)
        print(output.relative_to(ROOT))
    preview = homepage.replace('<html lang="en">', '<html lang="en" data-local-preview>', 1)
    preview = preview.replace('<head>', '<head>\n  <base href="../">', 1)
    (ROOT / 'particle-lab/home-preview.html').write_text(preview, encoding='utf-8')
    print('particle-lab/home-preview.html')


if __name__ == '__main__':
    main()
