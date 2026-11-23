"""Copy a standalone portfolio export here and attach the private portfolio tracker.

Usage: python scripts/sync-portfolio.py --source PATH/TO/static-export-*/dist
Run the portfolio author's export_static.py with --base-url
https://r-ush.github.io/portfolio --noindex first. This script never publishes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve()
dest = ROOT/'portfolio'
if source == dest.resolve() or not (source/'index.html').is_file():
    parser.error('Use a separate, completed standalone export directory')
html = (source/'index.html').read_text(encoding='utf-8')
if 'https://r-ush.github.io/portfolio/' not in html or 'name="robots" content="noindex, nofollow"' not in html:
    parser.error('Expected a homepage export with noindex enabled')
for file in source.rglob('*'):
    if not file.is_file():
        continue
    relative = file.relative_to(source)
    if any(part.startswith('.') for part in relative.parts):
        continue
    if file.suffix.lower() not in {'.html','.js','.css','.json','.svg','.pdf','.png','.jpg','.jpeg','.mp4','.webp'}:
        raise ValueError(f'Unexpected public file type: {relative}')
    target = dest/relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, target)
deck = json.loads((dest/'deck.json').read_text(encoding='utf-8'))
captions = {clip['video']: clip['caption'] for page in deck['pages'] for clip in page['extras']}
videos = {f'video-{i+1:02}': url for i, url in enumerate(sorted(captions))}
config = {
    'endpoint': 'https://rush-analytics.r-ush.workers.dev/collect/portfolio',
    'paths': ['/portfolio/', '/portfolio/hardware-first/'],
    'slides': {page['id']: page['title'] for page in deck['pages']},
    'sources': {item['id']: item['label'] for page in deck['pages'] for item in page['evidence']},
    'videos': videos, 'videoLabels': {key: captions[url] for key, url in videos.items()},
    'downloads': {'cv-ko': '국문 CV', 'cv-en': 'English CV', 'portfolio-ko': '국문 포트폴리오', 'portfolio-en': 'English portfolio'},
}
(dest/'analytics-config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
for variant in ['', 'hardware-first']:
    page = dest/variant/'index.html'
    content = page.read_text(encoding='utf-8')
    content = re.sub(r'<script src="[^"]*analytics\.js[^\"]*" defer></script>', '', content)
    content = re.sub(r'<link rel="stylesheet" href="[^"]*analytics\.css[^\"]*">', '', content)
    prefix = '../' if variant else ''
    for name in ['analytics.css', 'analytics.js']:
        digest = hashlib.sha256((dest/name).read_bytes()).hexdigest()[:10]
        url = prefix+name+'?v='+digest
        if name.endswith('.css'):
            content = content.replace('</head>', f'<link rel="stylesheet" href="{url}"></head>')
        else:
            content = content.replace('</body>', f'<script src="{url}" defer></script></body>')
    page.write_text(content, encoding='utf-8')
print(f'Synced standalone portfolio: {len(deck["pages"])} pages, {len(videos)} videos; not published')
