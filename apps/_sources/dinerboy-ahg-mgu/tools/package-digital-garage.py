"""Build the separate Digital Garage app and its USB Store catalog."""
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ID = 'ahg_digital_garage'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    subprocess.run(['node', '--test'] + [str(p.relative_to(ROOT)) for p in sorted((ROOT/'test').glob('*.test.js'))], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'kit/tools/build.py', '--store-package', APP_ID], cwd=ROOT, check=True)
    app = ROOT/'apps'/APP_ID
    spec = json.loads((app/'app.json').read_text(encoding='utf-8'))
    assert spec['id'] == APP_ID
    version = spec['version']
    dist = ROOT/'dist'
    artifact = dist/f'{APP_ID}@{version}.tgz'
    with tarfile.open(artifact) as tar:
        names = tar.getnames()
        meta = json.load(tar.extractfile('package/package.json'))
        assert (meta['name'], meta['version'], meta['mguHmi']) == (APP_ID, version, ['ID7'])
        assert 'package/javascript/app.js' in names
        assert 'package/rhmiData/application.json' in names
        assert not any('node_modules/oap-sdk' in n or n.endswith(('.pem', '.key')) for n in names)
        assert 'package/javascript/kit/car.js' not in names
        assert 'package/javascript/kit/sim.js' not in names
        for member in tar.getmembers():
            if member.isfile() and member.name.endswith(('.js', '.json', '.tsv')):
                assert b'demo' not in tar.extractfile(member).read().lower(), member.name
        for name in ('book', 'faults', 'health', 'live', 'view', 'pixel'):
            assert f'package/javascript/{name}.js' in names
        proxies = json.load(tar.extractfile('package/manifest.json'))['proxies']
        assert proxies['com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu']['methods'] == ['sendTasuRequest']
        assert 'de.bmw.infotainment.misc.ComfortFunctionIuK' not in proxies
    icon = app/'icon.png'
    icon_name = APP_ID+'.png'
    store = {'apps': {APP_ID: {'title': spec['title'], 'description': spec['description'],
                             'author': spec['vendor'], 'icon': icon_name, 'iconSha256': digest(icon.read_bytes())}}}
    (dist/'mgu-store.json').write_text(json.dumps(store, indent=2)+'\n', encoding='utf-8')
    shutil.copy2(icon, dist/icon_name)
    usb_root = dist/f'digital-garage-usb-{version}'
    usb = usb_root/'mgu-repo/AHG-Digital-Garage'
    usb.mkdir(parents=True, exist_ok=True)
    for source, name in ((artifact, artifact.name), (icon, 'icon.png'), (ROOT/'docs/DIGITAL_GARAGE.md', 'README.md')):
        shutil.copy2(source, usb/name)
    catalog = {'schema': 2, 'components': [{'id': APP_ID, 'kind': 'app', 'version': version,
        'title': spec['title'], 'description': spec['description'], 'mguHmi': ['ID7'],
        'uninstallable': True, 'icon': 'icon.png', 'iconSha256': digest(icon.read_bytes()),
        'artifact': {'name': artifact.name, 'url': artifact.name, 'size': artifact.stat().st_size,
                     'sha256': digest(artifact.read_bytes())}}]}
    (usb/'catalog.json').write_text(json.dumps(catalog, indent=2)+'\n', encoding='utf-8')
    bundle = dist/f'AHG-Digital-Garage-{version}-Store.zip'
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as out:
        for p in sorted(usb.rglob('*')):
            if p.is_file():
                out.write(p, p.relative_to(usb_root).as_posix())
    with zipfile.ZipFile(bundle) as check:
        assert check.testzip() is None
        entry = json.loads(check.read('mgu-repo/AHG-Digital-Garage/catalog.json'))['components'][0]
        data = check.read('mgu-repo/AHG-Digital-Garage/'+artifact.name)
        assert len(data) == entry['artifact']['size']
        assert digest(data) == entry['artifact']['sha256']
        assert digest(check.read('mgu-repo/AHG-Digital-Garage/icon.png')) == entry['iconSha256']
    files = [artifact, bundle, dist/'mgu-store.json', dist/icon_name]
    (dist/'DIGITAL-GARAGE-SHA256SUMS.txt').write_text(''.join(digest(p.read_bytes())+'  '+p.name+'\n' for p in files), encoding='utf-8')
    for p in files:
        print(p)
    print('Validated separate app ID, OAP archive, SDK exclusion, USB catalog hashes and ZIP integrity.')


if __name__ == '__main__':
    main()
