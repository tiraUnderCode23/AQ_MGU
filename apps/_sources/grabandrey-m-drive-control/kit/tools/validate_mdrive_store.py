#!/usr/bin/env python3
"""Validate the M Drive repo-tree contract, tool payloads and ID7/ID8 UI generation."""
import json
from pathlib import Path
import struct
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'kit/tools'))
import build

repo = json.loads((root/'mgu-repo.json').read_text())
assert repo['schema'] == 1
assert len(repo['components']) == 1
entry = repo['components'][0]
appdir = root/entry['path']
spec = json.loads((appdir/entry['manifest']).read_text())
assert entry['id'] == spec['id'] == 'andrei_mdrive'
assert entry['version'] == spec['version']
assert entry['requires'] == spec['requires']
assert entry['mguHmi'] == spec['mguHmi'] == ['ID7', 'ID8']
assert entry['build']['args'] == ['{id}']
assert entry['build']['output'] == 'dist/{id}@{version}.tgz'
assert entry['build']['sdk'] == 'oap-sdk'
assert (root/entry['build']['python']).is_file()
for path in entry['build']['shared']:
    assert path == 'oap-sdk' or (root/path).exists(), path
tools = {}
for tool in repo['tools']:
    folder = root/tool['path']
    manifest = json.loads((folder/'component.json').read_text())
    assert manifest['id'] == tool['id']
    tools[manifest['id']] = manifest['version']
    for payload in manifest['files']:
        assert (folder/payload['path']).is_file(), payload
    for unit in manifest.get('units', []):
        assert (folder/unit['name']).is_file(), unit
for name, minimum in spec['requires'].items():
    assert tuple(map(int, tools[name].split('.'))) >= tuple(map(int, minimum.split('.')))
icon = (appdir/entry.get('icon', 'icon.png')).read_bytes()
assert icon[:8] == b'\x89PNG\r\n\x1a\n'
assert struct.unpack('>II', icon[16:24]) == (140, 140)
assert len(icon) <= 128*1024
ids = []
for hmi in ('ID7', 'ID8'):
    xml, ui, strings, states = build.build_ui(spec, 'en', hmi)
    assert xml and ui and strings and states
    ids.append(states)
assert ids[0] == ids[1]
settings = {s['key']: s for s in spec['settings']}
assert settings['demo']['default'] != 'on'
assert settings['control']['default'] != 'mhd'
print('PASS: Store manifest, versions, build paths, dependency payloads, 140px icon, ID7/ID8 interfaces and installed defaults')
