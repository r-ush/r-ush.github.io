"""Read native PDF character positions for a selectable, invisible web text layer."""

def extract_text_runs(page, links, media):
    runs = []
    line_number = 0
    eligible = [(i, item) for i, item in enumerate(links) if not any(
        item['rect'][0] < box['rect'][0] + box['rect'][2] and item['rect'][0] + item['rect'][2] > box['rect'][0]
        and item['rect'][1] < box['rect'][1] + box['rect'][3] and item['rect'][1] + item['rect'][3] > box['rect'][1]
        for box in media)]
    for block in page.get_text('rawdict')['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            if tuple(line['dir']) != (1.0, 0.0):
                raise ValueError('Review rotated text before exporting its selection layer')
            for span in line['spans']:
                current = None
                for char in span['chars']:
                    x0, y0, x1, y1 = char['bbox']
                    x, y = (x0 + x1) / 2, (y0 + y1) / 2
                    hit = [(item['rect'][2] * item['rect'][3], i) for i, item in eligible
                           if item['rect'][0] <= x <= item['rect'][0] + item['rect'][2]
                           and item['rect'][1] <= y <= item['rect'][1] + item['rect'][3]]
                    link = min(hit)[1] if hit else None
                    if current is None or current['link'] != link:
                        current = {'line': line_number, 'text': '', 'x': [],
                                   'y': round(span['origin'][1], 4), 'size': round(span['size'], 4),
                                   'bold': bool(span['flags'] & 16), 'link': link}
                        runs.append(current)
                    current['text'] += char['c']
                    current['x'].append(round(char['origin'][0], 4))
            line_number += 1
    copied = '\n'.join(''.join(run['text'] for run in runs if run['line'] == number) for number in range(line_number)) + '\n'
    if copied != page.get_text():
        raise ValueError('Selection layer differs from the original PDF text')
    return runs


if __name__ == '__main__':
    import argparse
    import hashlib
    import json
    from pathlib import Path
    import re
    import fitz

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', required=True, type=Path)
    args = parser.parse_args()
    root = args.dist.resolve()
    page_count = run_count = 0
    for variant in ['', 'hardware-first']:
        folder = root/variant
        html_path = folder/'index.html'
        html = html_path.read_text(encoding='utf-8')
        match = re.search(r'(<script id="deck-data" type="application/json">)(.*?)(</script>)', html, re.S)
        bundle = json.loads(match[2])
        for language in ['ko', 'en']:
            name = 'deck-en.json' if language == 'en' else 'deck.json'
            path = folder/name
            deck = json.loads(path.read_text(encoding='utf-8'))
            pdf_path = folder/('portfolio-en.pdf' if language == 'en' else 'portfolio.pdf')
            before = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
            if deck['pdf_sha256'] != before:
                raise ValueError(f'Stale deck: {path}')
            pdf = fitz.open(pdf_path)
            payload = bundle if language == 'ko' else bundle['translations']['en']
            for page, entry, embedded in zip(pdf, deck['pages'], payload['pages'], strict=True):
                if entry['id'] != embedded['id']:
                    raise ValueError('Embedded page order differs')
                runs = extract_text_runs(page, entry['links'], entry['media'])
                entry['text_runs'] = embedded['text_runs'] = runs
                page_count += 1
                run_count += len(runs)
            pdf.close()
            if hashlib.sha256(pdf_path.read_bytes()).hexdigest() != before:
                raise ValueError('Original PDF changed')
            path.write_text(json.dumps(deck, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        payload = json.dumps(bundle, ensure_ascii=False).replace('<', '\\u003c')
        html = html[:match.start(2)] + payload + html[match.end(2):]
        prefix = '../' if variant else ''
        if 'src="'+prefix+'text-layer.js?' not in html:
            html = html.replace('<script src="'+prefix+'app.js?', '<script src="'+prefix+'text-layer.js?v=initial" defer></script><script src="'+prefix+'app.js?')
        for name in ['text-layer.js', 'app.js', 'evidence-viewer.js', 'style.css']:
            digest = hashlib.sha256((root/name).read_bytes()).hexdigest()[:10]
            html = re.sub(re.escape(name)+r'\?v=[a-z0-9]+', name+'?v='+digest, html)
        html_path.write_text(html, encoding='utf-8')
    print(f'Added exact selectable text to {page_count} pages ({run_count} runs); PDFs unchanged')
