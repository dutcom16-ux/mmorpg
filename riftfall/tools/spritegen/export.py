"""Renders every sprite and effect sheet with headless Chrome (Playwright).

Usage: python3 tools/spritegen/export.py [path/to/chrome]
Writes assets/*.webp + assets/atlas.json (used by the game) and assets/png/*.png + assets/png/atlas.json (full-quality pack).
Run tools/inject_atlas.py afterwards to copy the atlas into index.html and sprites.html.
"""
import base64, json, os, sys, time, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent / 'assets'
PNG = ROOT / 'png'
PNG.mkdir(parents=True, exist_ok=True)
chrome = sys.argv[1] if len(sys.argv) > 1 else None

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    pg = b.new_page()
    pg.goto((HERE / 'gen.html').as_uri())
    jobs = pg.evaluate("()=>SpriteGen.jobs()")
    t0 = time.time()
    for j in jobs:
        r = pg.evaluate("(j)=>SpriteGen.renderBoth(j)", j)
        (PNG / f"{j['file']}.png").write_bytes(base64.b64decode(r['png'].split(',')[1]))
        (ROOT / f"{j['file']}.webp").write_bytes(base64.b64decode(r['webp'].split(',')[1]))
    (PNG / 'atlas.json').write_text(json.dumps(pg.evaluate("()=>SpriteGen.atlas('png')"), indent=1))
    (ROOT / 'atlas.json').write_text(json.dumps(pg.evaluate("()=>SpriteGen.atlas('webp')"), indent=1))
    print(len(jobs), 'sheets in', round(time.time() - t0, 1), 's')
    b.close()
