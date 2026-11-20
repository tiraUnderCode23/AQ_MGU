#!/usr/bin/env python3
"""One-time Spotify sign-in for the Cluster Lyrics app. Run this on a PC.

    python3 tools/spotify_login.py <client-id> [output-folder]

What it does
  1. Opens Spotify's sign-in page in your browser (Authorization Code with
     PKCE: no client secret, your password never reaches this script).
  2. Receives Spotify's answer on http://127.0.0.1:8898/callback.
  3. Writes cluster-lyrics-spotify.json (client id + refresh token).

Copy that file to a USB stick, plug it into the car and press
"Import from USB" on the app's Setup page. Delete the file from the stick
afterwards: whoever has it can see what you are listening to.

The app only asks for two read-only permissions:
  user-read-currently-playing, user-read-playback-state

Before the first run, create your own app at https://developer.spotify.com/dashboard
(needs Spotify Premium), select "Web API" and add exactly this Redirect URI:
  http://127.0.0.1:8898/callback
The Client ID shown there is the argument of this script.

Python 3.6+, standard library only.
"""
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

PORT = 8898
REDIRECT = 'http://127.0.0.1:%d/callback' % PORT
SCOPE = 'user-read-currently-playing user-read-playback-state'
OUT_NAME = 'cluster-lyrics-spotify.json'
AUTHORIZE = 'https://accounts.spotify.com/authorize'
TOKEN = 'https://accounts.spotify.com/api/token'
WAIT_SECONDS = 600


def pkce_pair():
    """A fresh code verifier (43-128 characters) and its S256 challenge."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    challenge = base64.urlsafe_b64encode(digest).decode('ascii').rstrip('=')
    return verifier, challenge


def authorize_url(client_id, challenge, state):
    return AUTHORIZE + '?' + urllib.parse.urlencode({
        'client_id': client_id, 'response_type': 'code', 'redirect_uri': REDIRECT,
        'code_challenge_method': 'S256', 'code_challenge': challenge, 'state': state, 'scope': SCOPE})


def wait_for_code(state):
    """Serve exactly the callback on the loopback address and return the code."""
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):  # no request log on the console
            pass

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(url.query)
            if url.path != '/callback':
                self.send_error(404)
                return
            if query.get('state', [''])[0] != state:
                result['error'] = 'state mismatch (answer does not belong to this sign-in)'
            elif 'error' in query:
                result['error'] = query['error'][0]
            else:
                result['code'] = query.get('code', [''])[0]
            ok = 'code' in result and result['code']
            body = ('<h2>Cluster Lyrics</h2><p>%s</p>' % (
                'Signed in. You can close this tab.' if ok else 'Sign-in failed. See the terminal.')).encode('utf-8')
            self.send_response(200 if ok else 400)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    deadline = time.monotonic() + WAIT_SECONDS
    try:
        # Other requests (a favicon, a port scan) are answered with 404 and waited through.
        while not result and time.monotonic() < deadline:
            server.timeout = max(1.0, deadline - time.monotonic())
            server.handle_request()
    finally:
        server.server_close()
    if not result:
        result['error'] = 'no answer from the browser within %d minutes' % (WAIT_SECONDS // 60)
    if result.get('error') or not result.get('code'):
        raise SystemExit('Sign-in failed: ' + result.get('error', 'no code received'))
    return result['code']


def exchange(client_id, code, verifier):
    data = urllib.parse.urlencode({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': REDIRECT,
                                   'client_id': client_id, 'code_verifier': verifier}).encode('ascii')
    request = urllib.request.Request(TOKEN, data=data,
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            answer = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', 'replace')[:300]
        raise SystemExit('Spotify refused the code exchange (HTTP %d): %s' % (error.code, detail))
    if not answer.get('refresh_token'):
        raise SystemExit('Spotify sent no refresh token.')
    return answer['refresh_token']


def main(argv):
    if len(argv) < 2 or not re.fullmatch(r'[0-9a-fA-F]{32}', argv[1]):
        print(__doc__)
        print('Usage: python3 tools/spotify_login.py <client-id (32 hex characters)> [output-folder]')
        return 2
    client_id = argv[1]
    folder = argv[2] if len(argv) > 2 else os.getcwd()
    if not os.path.isdir(folder):
        print('Output folder does not exist: ' + folder)
        return 2
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)
    url = authorize_url(client_id, challenge, state)
    print('Opening Spotify sign-in in your browser. If nothing opens, paste this address:\n\n  ' + url + '\n')
    try:
        webbrowser.open(url)
    except Exception:  # a missing browser is not fatal: the address is printed above
        pass
    code = wait_for_code(state)
    refresh_token = exchange(client_id, code, verifier)
    target = os.path.join(folder, OUT_NAME)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    with os.fdopen(os.open(target, flags, 0o600), 'w', encoding='ascii') as out:
        json.dump({'client_id': client_id, 'refresh_token': refresh_token}, out)
        out.write('\n')
    print('Written: ' + target)
    print('Copy it to a USB stick, import it in the car (Setup > Import from USB), then delete it from the stick.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
