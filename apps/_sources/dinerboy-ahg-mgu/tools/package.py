"""Build and validate the SDK-free OAP package and USB Store catalog."""
import hashlib, json, shutil, subprocess, sys, tarfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    subprocess.run(['node', '--test'] + [str(p.relative_to(ROOT)) for p in sorted((ROOT/'test').glob('*.test.js'))], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'kit/tools/build.py', '--store-package', 'ahg_control_center'], cwd=ROOT, check=True)
    spec = json.loads((ROOT/'apps/ahg_control_center/app.json').read_text())
    version = spec['version']
    dist = ROOT/'dist'
    archive = dist/f'ahg_control_center@{version}.tgz'
    with tarfile.open(archive) as tar:
        names = set(tar.getnames())
        assert 'package/javascript/app.js' in names
        assert 'package/rhmiData/application.json' in names
        assert not any('node_modules/oap-sdk' in n for n in names), 'Proprietary SDK must not ship'
        assert not any(n.endswith(('.pem', '.key')) for n in names)
        meta = json.load(tar.extractfile('package/package.json'))
        assert meta['mguHmi'] == ['ID7']
        assert meta['main'].endswith('.js')
        manifest = json.load(tar.extractfile('package/manifest.json'))['proxies']
        assert manifest['com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu']['methods'] == ['sendTasuRequest']
        assert 'de.bmw.infotainment.misc.ComfortFunctionIuK' not in manifest, 'ambient setter removed in 1.4.0'
        for module in ('controls', 'ec_controller', 'ec_diaglink', 'ec_adapters', 'ec_real_adapters', 'ec_auto', 'engine', 'health'):
            assert 'package/javascript/'+module+'.js' in names
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    usb_root = dist/f'usb-{version}'
    usb = usb_root/'mgu-repo/AHG-Control-Center'
    usb.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archive, usb/archive.name)
    shutil.copy2(ROOT/'apps/ahg_control_center/icon.png', usb/'icon.png')
    shutil.copy2(ROOT/'docs/INSTALL.md', usb/'INSTALL.md')
    shutil.copy2(ROOT/'docs/CONTROL_TESTING.md', usb/'CONTROL_TESTING.md')
    catalog = {'schema': 2, 'components': [{'id': spec['id'], 'kind': 'app', 'version': version,
        'title': spec['title'], 'description': spec['description'], 'mguHmi': ['ID7'],
        'uninstallable': True, 'icon': 'icon.png',
        'iconSha256': hashlib.sha256((usb/'icon.png').read_bytes()).hexdigest(),
        'artifact': {'name': archive.name, 'url': archive.name, 'size': archive.stat().st_size, 'sha256': digest}}]}
    (usb/'catalog.json').write_text(json.dumps(catalog, indent=2)+'\n', encoding='utf-8')
    zip_path = dist/f'AHG-Control-Center-{version}-Store.zip'
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as out:
        for p in sorted(usb.rglob('*')):
            if p.is_file(): out.write(p, p.relative_to(usb_root).as_posix())
    with zipfile.ZipFile(zip_path) as check:
        assert check.testzip() is None
        entry = json.loads(check.read('mgu-repo/AHG-Control-Center/catalog.json'))['components'][0]
        data = check.read('mgu-repo/AHG-Control-Center/'+archive.name)
        assert len(data) == entry['artifact']['size']
        assert hashlib.sha256(data).hexdigest() == entry['artifact']['sha256']
    checksums = ''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in (archive, zip_path))
    (dist/'SHA256SUMS.txt').write_text(checksums, encoding='utf-8')
    for p in (archive, zip_path, dist/'SHA256SUMS.txt'): print(p)
    print('Validated OAP archive, SDK exclusion, USB catalog hashes and ZIP integrity.')

if __name__ == '__main__': main()
