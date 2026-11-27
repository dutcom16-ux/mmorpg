"""Copies assets/atlas.json into index.html and sprites.html (between /*ATLAS*/ and /*END*/)."""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
atlas = json.dumps(json.loads((root / 'assets/atlas.json').read_text()), separators=(',', ':'))
for name in ('index.html', 'sprites.html'):
    p = root / name; s = p.read_text()
    s2, n = re.subn(r'/\*ATLAS\*/.*?/\*END\*/', lambda m: '/*ATLAS*/' + atlas + '/*END*/', s, flags=re.S)
    assert n == 1, name
    p.write_text(s2); print('atlas ->', name)
