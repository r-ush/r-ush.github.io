"""Build the country marker positions used by the homepage visitor map.

Usage: python scripts/build-country-points.py
Positions use the same 720x300 projection as assets/images/world-map.svg.
Natural Earth map data is public domain: https://www.naturalearthdata.com/about/terms-of-use/
"""

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("search_console", ROOT / "scripts/import-search-console.py")
search_console = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search_console)


def main():
    points = {}
    for feature in search_console.natural_earth("50m"):
        props = feature["properties"]
        code = props.get("ISO_A2_EH", props.get("ISO_A2"))
        if not code or len(code) != 2 or not code.isalpha() or code == "AQ" or code in points:
            continue
        points[code] = [round((props["LABEL_X"] + 180) * 2, 1), round((85 - props["LABEL_Y"]) * 2, 1)]
    data = {
        "source": "Natural Earth 1:50m admin-0 label points, public domain",
        "projection": "x = (longitude + 180) * 2, y = (85 - latitude) * 2 in a 720x300 viewBox",
        "points": dict(sorted(points.items())),
    }
    path = ROOT / "assets/data/country-points.json"
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(points)} country marker positions to {path.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
