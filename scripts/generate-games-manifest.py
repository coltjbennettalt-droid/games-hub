#!/usr/bin/env python3
"""Generate games-manifest.json from the launcher data catalog.
Run from the repository root: python3 scripts/generate-games-manifest.py
"""
from pathlib import Path
import json, re
src = Path('data.js').read_text(encoding='utf-8')
items = []
for section, kind in [('const projects = [', 'project'), ('const classics = [', 'classic')]:
    if section not in src: continue
    body = src.split(section, 1)[1].split('];', 1)[0]
    for block in re.findall(r"\{([\s\S]*?)\n  \},?", body):
        def val(key):
            m = re.search(rf"\b{re.escape(key)}:\s*(['\"])(.*?)\1", block)
            return m.group(2) if m else ''
        title, path = val('title'), val('url')
        if not title or not path: continue
        items.append({
            'title': title,
            'path': path,
            'thumbnail': val('image'),
            'type': val('type') or ('Classic' if kind == 'classic' else 'Game'),
            'status': val('statusKey'),
            'isSwf': False
        })
Path('games-manifest.json').write_text(json.dumps({'version': 'generated', 'generatedAt': __import__('datetime').date.today().isoformat(), 'games': items}, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(items)} games to games-manifest.json')
