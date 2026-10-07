"""Build public country totals and a map from a Search Console XLSX export.

Usage: python scripts/import-search-console.py path/to/export.xlsx
The source workbook is read only. No queries or individual records are published.
Natural Earth map data is public domain: https://www.naturalearthdata.com/about/terms-of-use/
"""

import argparse
import html
import json
import math
from pathlib import Path
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COUNTRY_CODES = {
    "한국": "KR", "미국": "US", "캐나다": "CA", "홍콩": "HK", "중국": "CN",
    "일본": "JP", "인도": "IN", "러시아": "RU", "핀란드": "FI", "싱가포르": "SG",
    "대만": "TW", "이탈리아": "IT", "프랑스": "FR", "오스트리아": "AT", "우즈베키스탄": "UZ",
}


def read_sheets(path):
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(n.itertext()) for n in ET.fromstring(
                archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        links = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(
            archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).findall("m:sheets/m:sheet", NS):
            target = links[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            rows = []
            for row in ET.fromstring(archive.read(target)).findall("m:sheetData/m:row", NS):
                values = {}
                for cell in row.findall("m:c", NS):
                    column = re.match(r"[A-Z]+", cell.attrib["r"])[0]
                    value = cell.find("m:v", NS)
                    value = value.text if value is not None else ""
                    if cell.get("t") == "s":
                        value = strings[int(value)]
                    elif cell.get("t") == "inlineStr":
                        value = "".join(cell.find("m:is", NS).itertext())
                    elif value and cell.get("t") != "str":
                        value = float(value)
                    values[column] = value
                rows.append(values)
            sheets[sheet.attrib["name"]] = rows
        return sheets


def natural_earth(scale):
    cache = Path(tempfile.gettempdir()) / "rush-visitor-preview"
    cache.mkdir(exist_ok=True)
    filename = "ne_" + scale + "_admin_0_countries.geojson"
    path = cache / filename
    if not path.exists():
        url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/" + filename
        request = urllib.request.Request(url, headers={"User-Agent": "Website-maintenance"})
        with urllib.request.urlopen(request, timeout=30) as response:
            path.write_bytes(response.read())
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def map_svg(features, countries):
    by_code = {c["code"]: c for c in countries}
    highest = max((c["clicks"] for c in countries), default=1)
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 300" role="img" aria-labelledby="title description">',
        '<title id="title">' + ("Google search clicks by country and region" if countries else "World map") + '</title>',
        '<desc id="description">Country totals from Google Search Console. Shading shows search clicks, not individual visitor locations.</desc>',
        '<metadata>Map geometry: Natural Earth, public domain. https://www.naturalearthdata.com/</metadata>',
        '<rect width="720" height="300" rx="10" fill="#f6f9fc"/>',
    ]
    for feature in features:
        props = feature["properties"]
        code = props.get("ISO_A2_EH", props.get("ISO_A2"))
        if code == "AQ":
            continue
        country = by_code.get(code)
        clicks = country["clicks"] if country else 0
        fill = "#dce4eb"
        if clicks:
            weight = math.log1p(clicks) / math.log1p(highest)
            fill = "#" + "".join(f"{round(a + (b - a) * weight):02x}" for a, b in
                                  zip((186, 214, 239), (23, 114, 208)))
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        paths = []
        for polygon in polygons:
            for ring in polygon:
                points = [f"{(lon + 180) * 2:.1f},{(85 - lat) * 2:.1f}" for lon, lat in ring]
                paths.append("M" + "L".join(points) + "Z")
        name = html.escape(props.get("NAME_EN", props["ADMIN"]))
        title = f"{name}: {clicks} Google search clicks" if countries else name
        parts.append(f'<path data-country="{code}" d="{"".join(paths)}" fill="{fill}" fill-rule="evenodd" stroke="#fff" stroke-width="0.55"><title>{title}</title></path>')
        if country and code in {"SG", "HK"}:
            x, y = (props["LABEL_X"] + 180) * 2, (85 - props["LABEL_Y"]) * 2
            parts.append(f'<circle data-region="{code}" cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{fill}" stroke="#fff" stroke-width="0.8"><title>{title}</title></circle>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()
    sheets = read_sheets(args.workbook)
    daily = sheets["차트"][1:]
    rows = sheets["국가"][1:]
    filters = {row["A"]: row["B"] for row in sheets["필터"][1:]}
    if filters.get("검색 유형") != "웹":
        raise ValueError("This view expects a Web search export.")
    clicks = sum(int(row["B"]) for row in daily)
    impressions = sum(int(row["C"]) for row in daily)
    if clicks != sum(int(row["B"]) for row in rows) or impressions != sum(int(row["C"]) for row in rows):
        raise ValueError("Country totals do not reconcile with the chart. Review this export before publishing.")
    features = natural_earth("110m")
    detail = natural_earth("50m")
    lookup = {f["properties"].get("ISO_A2_EH"): f for f in detail}
    countries = []
    for row in rows:
        if not row["B"]:
            continue
        if row["A"] not in COUNTRY_CODES:
            raise ValueError("Add an explicit country-code mapping for: " + row["A"])
        code = COUNTRY_CODES[row["A"]]
        countries.append({"code": code, "name": lookup[code]["properties"]["NAME_EN"], "clicks": int(row["B"])})
    countries.sort(key=lambda c: (-c["clicks"], c["name"]))
    present = {f["properties"].get("ISO_A2_EH") for f in features}
    features += [lookup[c["code"]] for c in countries if c["code"] not in present]
    exported = re.search(r"\d{4}-\d{2}-\d{2}(?=\.xlsx$)", args.workbook.name)
    if exported is None:
        raise ValueError("Expected the export date in the workbook filename.")
    dates = sorted(row["A"] for row in daily)
    data = {
        "source": "Google Search Console",
        "sourceFile": args.workbook.name,
        "exportedOn": exported[0],
        "startDate": dates[0],
        "endDate": dates[-1],
        "searchType": "Web",
        "clicks": clicks,
        "impressions": impressions,
        "countriesWithClicks": len(countries),
        "countries": countries,
    }
    data_dir, image_dir = ROOT / "assets/data", ROOT / "assets/images"
    data_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "search-history.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (image_dir / "search-history-map.svg").write_text(map_svg(features, countries), encoding="utf-8")
    (image_dir / "world-map.svg").write_text(map_svg(features, []), encoding="utf-8")
    print(f"Imported {clicks} search clicks from {len(countries)} countries/regions ({dates[0]} to {dates[-1]}).")


if __name__ == "__main__":
    main()
