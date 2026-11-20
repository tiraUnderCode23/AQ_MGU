"""Publish this project's source and release using Git Credential Manager.

Credentials stay in memory and are never printed or written into the repo.
"""
import json, os, subprocess, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'dinerboy/ahg_mgu'

def main():
    version = json.loads((ROOT/'apps/ahg_control_center/app.json').read_text())['version']
    tag = 'v'+version
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never')
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True, env=env)
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    token = fields['password']
    def api(route, data=None, method=None, binary=None, content_type='application/json'):
        url = route if route.startswith('https://') else 'https://api.github.com' + route
        payload = binary if binary is not None else (json.dumps(data).encode() if data is not None else None)
        req = urllib.request.Request(url, data=payload, method=method, headers={'Authorization': 'Bearer '+token, 'User-Agent': 'AHG-Control-Center-release', 'Accept': 'application/vnd.github+json', 'Content-Type': content_type})
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    if api('/user')['login'] != 'dinerboy':
        raise RuntimeError('Unexpected authenticated account')
    try:
        repo = api('/repos/'+REPO)
    except urllib.error.HTTPError as error:
        if error.code != 404: raise
        repo = api('/user/repos', {'name': 'ahg_mgu', 'description': 'AHG Control Center for BMW MGU iDrive 7: native SDK dashboard, emulator and Store package.', 'private': False, 'auto_init': False})
    if subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, capture_output=True).returncode:
        subprocess.run(['git', 'remote', 'add', 'origin', repo['clone_url']], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', '-u', 'origin', 'main'], cwd=ROOT, check=True)
    subprocess.run(['git', 'tag', tag], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', 'origin', tag], cwd=ROOT, check=True)
    release = api('/repos/'+REPO+'/releases', {'tag_name': tag, 'name': 'AHG Control Center '+version+' — control testing', 'body': (ROOT/'docs/RELEASE_NOTES.md').read_text(encoding='utf-8'), 'prerelease': True})
    upload = release['upload_url'].split('{')[0]
    from urllib.parse import quote
    names = ['AHG-Control-Center-'+version+'-Store.zip', 'ahg_control_center@'+version+'.tgz', 'SHA256SUMS.txt']
    for name in names:
        file = ROOT/'dist'/name
        asset = api(upload+'?name='+quote(name), binary=file.read_bytes(), content_type='application/octet-stream')
        print(asset['browser_download_url'])
    print(release['html_url'])

if __name__ == '__main__':
    main()
