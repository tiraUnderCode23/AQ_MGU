#!/usr/bin/env python3
"""build_unit.py - the MGU Store's build of one app of this collection on the head unit (mgu-repo.json).

    python3 tools/build_unit.py <id> <app folder>

The Store runs it in a copy of this repository, with the oap-sdk it generates from a BMW app on the
unit in vendor/idrive7-apps/oap-sdk, Python 3.12 and Node 8, and no network. It puts the app folder
(true-time/app, ecu-live-data/app, dpf-monitoring/app, ...) into the shared kit as apps/<id> (a copy:
the links the apps' tools/setup.js make on a PC aren't in the repository's tarball), with <id> in its
app.json (the Store installs a second app of the same id as <id>2), and runs the kit's build:
vendor/idrive7-apps/dist/<id>@<version>.tgz.
Works on a PC too (with an SDK or the emulator placeholder in vendor/idrive7-apps/oap-sdk).
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, 'vendor', 'idrive7-apps')


def main():
    if len(sys.argv) < 3:
        sys.exit('usage: build_unit.py <id> <app folder>')
    app_id = sys.argv[1]
    src = os.path.abspath(sys.argv[2])
    if not os.path.isfile(os.path.join(src, 'app.json')):
        sys.exit('build_unit: no app.json in ' + src)
    dst = os.path.join(KIT, 'apps', app_id)
    if os.path.realpath(dst) != os.path.realpath(src):
        if os.path.islink(dst):
            os.remove(dst)
        elif os.path.isdir(dst):
            shutil.rmtree(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copytree(src, dst)
    manifest = os.path.join(dst, 'app.json')
    with open(manifest, encoding='utf-8') as f:
        spec = json.load(f)
    if spec.get('id') != app_id:
        spec['id'] = app_id
        with open(manifest, 'w', encoding='utf-8') as f:
            json.dump(spec, f, indent=2)
    subprocess.check_call([sys.executable, os.path.join(KIT, 'kit', 'tools', 'build.py'), app_id], cwd=KIT)
    out = os.path.join(KIT, 'dist', '%s@%s.tgz' % (app_id, spec['version']))
    if not os.path.exists(out):
        sys.exit('build_unit: no ' + out)
    print('build_unit: ' + os.path.relpath(out, ROOT))


if __name__ == '__main__':
    main()
