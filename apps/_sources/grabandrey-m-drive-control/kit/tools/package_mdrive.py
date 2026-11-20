#!/usr/bin/env python3
"""Export public sources and a USB ZIP, excluding SDK and local data."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo-dir', type=Path, help='also export into a new, empty directory')
args = parser.parse_args()
version = json.loads((root/'apps/andrei_mdrive/app.json').read_text())['version']
tracked = subprocess.check_output(['git', 'ls-files', '-z', 'kit'], cwd=root).decode().split('\0')
files = {Path(p) for p in tracked if p and (root/p).is_file()}
for folder in ['apps/andrei_mdrive', 'docs/mdrive']:
    files.update(p.relative_to(root) for p in (root/folder).rglob('*') if p.is_file())
files.update(p.relative_to(root) for p in (root/'kit/tools').glob('*mdrive*') if p.is_file())
files.update(map(Path, ['mgu-repo.json', 'LICENSE', 'M-DRIVE.md', 'package.json']))
files = {p for p in files if not any(part.startswith('.') or part in ('__pycache__', 'node_modules', 'oap-sdk') for part in p.parts)
         and p.suffix not in ('.pyc', '.log', '.pem', '.key')}
sources = {p: root/p for p in sorted(files)}
sources.update({Path('README.md'): root/'docs/mdrive/README.md',
                Path('.gitignore'): root/'docs/mdrive/gitignore.txt',
                Path('.github/workflows/checks.yml'): root/'docs/mdrive/checks.yml'})
if args.repo_dir:
    if args.repo_dir.exists() and any(args.repo_dir.iterdir()):
        raise SystemExit('--repo-dir must be empty')
    for dest, source in sources.items():
        target = args.repo_dir/dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
out = root/'release'
out.mkdir(exist_ok=True)
target = out/f'm-drive-{version}-source.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for dest, source in sources.items():
        archive.write(source, 'mgu-repo/m-drive/'+dest.as_posix())
print(f'{len(sources)} source files: {target}')
if args.repo_dir:
    print(f'Publication tree: {args.repo_dir}')
