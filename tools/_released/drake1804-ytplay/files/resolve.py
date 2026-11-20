#!/usr/bin/env python3
"""
What the player asks about YouTube: a video's stream, a search, a thumbnail. One JSON line on stdout, always.

  resolve.py [options] url -- <video id or youtube link>
      {"ok":true,"id","title","channel","duration","url","ua","width","height","fps","audio_url","live","available_at"}
      available_at: the Unix time the stream starts answering (0: now). YouTube answers 403 until then.
      channel: blank when the quick way found it. Nothing reads it here: the app has it from the list.
  resolve.py [options] search -- <words>
      {"ok":true,"query","results":[{"id","title","channel","duration"}]}
  resolve.py [options] thumb -- <video id>
      {"ok":true,"id","w":320,"h":180,"rgba":"<base64>"}   w x h opaque RGBA, rows top-down; through the socket, since an
      app's sandbox is only known to reach sockets, its own data folder and /dev/shm
  resolve.py [options] subs -- <video id>
      {"ok":true,"id","lang":"ru","cues":[[start ms,end ms,"words"]]}   in order, none overlapping; lang "" and no cues: it has none.
      The track `url` found for this video, fetched now: finding it takes all that `url` does, and most plays never want it
  Signing in, with Google's flow for devices that cannot type: the person approves on their phone. The Google client stays on the
  relay (services/logs-relay), because this file and the packages are public.
  resolve.py [options] account
      {"ok":true,"signedIn":false,"configured":true} or {"ok":true,"signedIn":true,"configured":true,"name"}
  resolve.py [options] signin-start
      {"ok":true,"code","url","expires_in","interval"}
  resolve.py [options] signin-poll
      {"ok":true,"status":"pending"|"done"|"denied"|"expired","name"?,"interval"?}
  resolve.py [options] signout
      {"ok":true}
  resolve.py [options] feed -- [fresh ]home|subs|liked|playlists|playlist:<id>
      {"ok":true,"rows":[{"id","title","channel","duration","published"}],"at"}; playlists: [{"playlist","title","count","thumb"}]
      at: the Unix time the list was fetched, up to ten minutes ago. fresh: fetched now, whatever is kept, because the driver asked.
      YouTube's API has no recommendations for a person: home is new uploads from their subscriptions and what is popular, in turn.
  Any of them: {"ok":false,"error":"<words for the screen>","reason":"<a word>"}

Options: --cap HEIGHT (the tallest stream wanted, default 720), --instance URL (a Piped or Invidious server instead of
yt-dlp), --cache DIR, --state DIR (the account's tokens), --ffmpeg PATH, --qjs PATH (the JavaScript runtime yt-dlp solves YouTube's challenges with), --node PATH
(a recent Node instead, off the car: the simulator).

Runs on mgu-python, as the player's uid, with yt-dlp from the zip beside this file. Standard library only.
"""
# flake8: noqa: E402
import os
import sys
import time

STARTED = time.monotonic()      # for the log: how much of finding a video is this Python starting
HERE = os.path.dirname(os.path.abspath(__file__))

# Before anything else is imported. mgu-python's standard library is a zip of sources, and Python keeps no compiled code for a zip: this
# start would compile all it imports. So the tool ships that code (docker/compile_zips.py), for one exact Python, because the sources must
# be that Python's. Any other Python finds no such file and runs as it would have.
COMPILED = os.path.join(HERE, f'python-{sys.version.split()[0]}.zip')
if os.path.exists(COMPILED):
    sys.path.insert(0, COMPILED)

import _thread
import argparse
import base64
import calendar
import hashlib
import html
import http.client
import json
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
SEARCH_RESULTS = 20
SEARCH_TTL_S = 3600
CACHE_MAX_BYTES = 50 * 1024 * 1024
THUMB_W, THUMB_H = 320, 180
THUMB_MAX_BYTES = 512 * 1024
HTTP_TIMEOUT_S = 10
THUMB_BASE = os.environ.get('YTPLAY_THUMB_BASE', 'https://i.ytimg.com/vi/')
VISITOR_URL = os.environ.get('YTPLAY_VISITOR_URL', 'https://www.youtube.com/sw.js_data')
SOLVED_PLAYERS_KEPT = 3     # 4.4 MB each. YouTube hands out a few versions of its player at any time, and each is solved once
SIGNIN_RELAY = os.environ.get('YTPLAY_SIGNIN_RELAY', 'https://bube-logs.vercel.app/api/signin')
OAUTH_BASE = os.environ.get('YTPLAY_GOOGLE_OAUTH', 'https://oauth2.googleapis.com')
API_BASE = os.environ.get('YTPLAY_GOOGLE_API', 'https://www.googleapis.com/youtube/v3')
COOKIES_FILE = 'cookies.txt'
COOKIES_HEADER = '# Netscape HTTP Cookie File\n'
COOKIE_EXPIRY = re.compile(r'[0-9]{0,18}')     # yt-dlp prints any other as a bad line. It takes more digits, then fails on the number they make
FEED_TTL_S = 600
FEED_ROWS = 24
FRESH = 'fresh '            # before a list's name: fetch it now
SUB_CHANNELS = 50           # whose uploads make up the subscriptions list, the most one call lists: each costs a call of its own
SUB_AT_ONCE = 6             # those calls at a time, each on a connection of its own: on a slow link a call is mostly its round trip
UPLOADS_PER_CHANNEL = 4
PLAYLIST_ID_RE = re.compile(r'^[A-Za-z0-9_-]{2,64}$')
SUBS_MAX_FETCH = 32 * 1024 * 1024       # a track as YouTube sends it: its guesses say when each word starts
SUBS_MAX_ANSWER = 480 * 1024            # the player passes on 512 KB at most. Hours of talk fit; what doesn't goes without
SUBS_CUE_BYTES = 40                     # a cue's numbers and punctuation, with room for what JSON escapes
# Languages in letters the app's fonts do not have (the app's tools/add_glyphs.py): a line of question marks is worse than none
NO_LETTERS = frozenset('am ar as bn bo dv el fa gu he hi hy iw ja ka km kn ko lo ml mr my ne or pa ps sa sd si ta te th ug ur yi zh'.split())
VTT_TIMES = re.compile(r'(?:(\d+):)?(\d\d):(\d\d)[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d\d):(\d\d)[.,](\d{3})')

WORDS = {
    'private': 'This video is private',
    'age': 'This video needs a signed-in, age-checked account',
    'region': 'This video is not available in this country',
    'notstarted': 'This live stream has not started',
    'unavailable': 'This video is unavailable',
    'blocked': 'YouTube is refusing requests from this connection',
    'network': 'No connection to YouTube',
    'nocodec': 'This video has no H.264 stream the car can play',
    'badlink': 'That is not a YouTube link',
    'extractor': 'YouTube changed something: try again after the next update, or set a server in Settings',
    'instance': 'The server in Settings did not answer',
    'broken': 'The YouTube player tool cannot start yt-dlp: reinstall it in the Store',
    'nosetup': 'Sign-in is not set up in this build',
    'signin': 'Google would not start a sign-in: try again later',
    'signedout': 'Sign in to see this',
    'quota': 'YouTube has had enough requests from this app today: try again tomorrow',
    'badfeed': 'That list does not exist',
    'nosubs': 'The subtitles could not be fetched',
}


class Refused(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def video_id(target):
    """The id in an id or a youtube link, or None."""
    if ID_RE.match(target):
        return target
    u = urllib.parse.urlparse(target)
    if u.scheme != 'https':
        return None
    host = (u.hostname or '').lower()
    candidate = None
    if host == 'youtu.be':
        candidate = u.path.strip('/').split('/')[0]
    elif host in ('www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'):
        parts = u.path.strip('/').split('/')
        if parts[0] == 'watch':
            candidate = (urllib.parse.parse_qs(u.query).get('v') or [''])[0]
        elif parts[0] in ('shorts', 'live', 'embed', 'v') and len(parts) > 1:
            candidate = parts[1]
    return candidate if candidate and ID_RE.match(candidate) else None


def classify(message):
    """The reason in yt-dlp's words for what went wrong."""
    m = (message or '').lower()
    if 'private video' in m or 'video is private' in m:
        return 'private'
    if 'not a bot' in m or 'http error 429' in m or 'too many requests' in m:
        return 'blocked'
    if 'confirm your age' in m or 'age-restricted' in m or 'age restricted' in m or 'inappropriate for some users' in m:
        return 'age'
    if 'not available in your country' in m or 'uploader has not made this video available' in m or 'geo' in m.split():
        return 'region'
    if 'will begin' in m or 'premieres in' in m or 'live event' in m:
        return 'notstarted'
    if 'unable to download' in m or 'timed out' in m or 'name resolution' in m or 'nodename nor servname' in m \
            or 'network is unreachable' in m or 'no route to host' in m or 'connection refused' in m \
            or 'getaddrinfo' in m or 'temporary failure' in m:
        return 'network'
    if 'video unavailable' in m or 'removed by' in m or 'has been removed' in m or 'account' in m and 'terminated' in m:
        return 'unavailable'
    return 'extractor'


def _is_h264(f):
    return str(f.get('vcodec') or '').lower().startswith(('avc1', 'h264'))


def _plays(f, live):
    if not str(f.get('url') or '').startswith('https://'):
        return False
    protocol = f.get('protocol') or 'https'
    return protocol in ('m3u8', 'm3u8_native') if live else protocol == 'https'


def pick_video(formats, cap, live=False):
    """The H.264 stream to play: the tallest at or under cap, a 30 fps one over a 60 fps one of near that height."""
    usable = [f for f in formats if _is_h264(f) and _plays(f, live) and 0 < (f.get('height') or 0) <= cap]
    if not usable:
        return None
    low_rate = [f for f in usable if (f.get('fps') or 30) <= 30 and f['height'] * 3 >= cap * 2]
    return max(low_rate or usable, key=lambda f: (f['height'], -(f.get('fps') or 30), f.get('tbr') or 0))


def _is_aac(f):
    return str(f.get('acodec') or '').lower().startswith('mp4a')


def pick_audio(formats):
    """The AAC track, for when the car has a way to play one."""
    usable = [f for f in formats if _is_aac(f) and (f.get('vcodec') in (None, 'none')) and str(f.get('url') or '').startswith('https://')]
    return max(usable, key=lambda f: f.get('abr') or f.get('tbr') or 0) if usable else None


def pick_live_audio(formats, video):
    """A live stream's sound. Usually a playlist of its own, since the picture's holds no sound, whatever its CODECS says. yt-dlp knows this one
    only as audio, with no codec or bitrate, and ranks the high one (LC) over the low one (HE-AAC) by the pictures each goes with. Some of YouTube's
    clients offer sound and picture together instead, and then the picture's playlist is the place, though it brings the picture along."""
    usable = [f for f in formats if _plays(f, True) and f.get('vcodec') == 'none' and (f.get('acodec') is None or _is_aac(f))]
    if usable:
        return max(usable, key=lambda f: (f.get('language_preference') or 0, f.get('source_preference') or 0))
    return video if _is_aac(video) else None


def stream_answer(vid, title, channel, duration, formats, cap, live):
    video = pick_video(formats, cap, live)
    if not video:
        raise Refused('nocodec')
    audio = pick_live_audio(formats, video) if live else pick_audio(formats)
    return {
        'ok': True,
        'id': vid,
        'title': title or '',
        'channel': channel or '',
        'duration': 0 if live else (duration or 0),
        'url': video['url'],
        'ua': (video.get('http_headers') or {}).get('User-Agent', ''),
        'width': video.get('width') or 0,
        'height': video.get('height') or 0,
        'fps': video.get('fps') or 0,
        'audio_url': audio['url'] if audio else '',
        'live': bool(live),
        'available_at': video.get('available_at') or 0,
    }


def spoken_language(info):
    """What a video is said in, if yt-dlp knows. A video with dubs has an audio track for each, and the original has the highest preference."""
    tracks = [f for f in info.get('formats') or [] if f.get('language') and f.get('acodec') not in (None, 'none')]
    return info.get('language') or (max(tracks, key=lambda f: f.get('language_preference') or -1)['language'] if tracks else None)


def pick_subs(uploaded, automatic, language=None):
    """The track to show of the {language: formats} of yt-dlp's subtitles and automatic_captions: in the video's own language, what
    someone wrote over YouTube's guess at it, and only in letters the app can draw. Its guesses from what is spoken end in -orig, and a
    video with dubs has one for each, so the first of them only says the language when nothing else does."""
    base = lambda lang: lang.split('-')[0].lower()     # noqa: E731
    guesses = [(k, v) for k, v in automatic.items() if k.endswith('-orig')]
    own = base(language or (guesses[0][0] if guesses else ''))
    order = [(k, v) for k, v in uploaded.items() if base(k) == own]
    order += [(k, v) for k, v in guesses if base(k) == own]
    order += list(uploaded.items()) + guesses
    for lang, formats in order:
        usable = [f for f in formats or [] if f.get('ext') in ('json3', 'vtt') and str(f.get('url') or '').startswith('https://')]
        if usable and lang != 'live_chat' and base(lang) not in NO_LETTERS:
            f = next((f for f in usable if f['ext'] == 'json3'), usable[0])
            return {'lang': lang, 'url': f['url'], 'ext': f['ext']}
    return None


# ---- yt-dlp ----

class _Quiet:
    last_error = ''
    challenge_failed = False

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        if 'solving failed' in str(msg):
            _Quiet.challenge_failed = True

    def error(self, msg):
        _Quiet.last_error = str(msg)


def _ydl_options(args):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'skip_download': True,
        'noplaylist': True,
        'socket_timeout': HTTP_TIMEOUT_S,
        'retries': 1,
        'extractor_retries': 1,
        'check_formats': False,
        'logger': _Quiet(),
        'cachedir': os.path.join(args.cache, 'ytdlp') if args.cache else False,
    }
    if args.qjs:
        opts['js_runtimes'] = {'quickjs': {'path': args.qjs}}
    elif args.node:
        opts['js_runtimes'] = {'node': {'path': args.node}}
    return opts


def _yt_dlp():
    bundled = os.path.join(HERE, 'yt-dlp.zip')
    if os.path.exists(bundled):
        sys.path.insert(0, bundled)
    try:
        import yt_dlp
    except ImportError as e:
        print(f'resolve.py: {e}', file=sys.stderr)
        raise Refused('broken')
    # for the report: a new mgu-python leaves this working, only slower, and nothing else would say why
    if os.path.exists(bundled) and not (os.path.exists(COMPILED) and getattr(yt_dlp, '__file__', '').endswith('.pyc')):
        print(f'resolve.py: no compiled code for Python {sys.version.split()[0]}: every start compiles it all', file=sys.stderr)
    return yt_dlp


def _visitor_data():
    """What YouTube wants a request to carry, or it says "not a bot". The watch page holds it too, in 330 KB. This holds it in 2 KB."""
    req = urllib.request.Request(VISITOR_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        text = r.read(256 * 1024).decode('utf-8', 'replace')
    visitor = json.loads(text[text.index('['):])[0][2][0][0][13]
    if not visitor or not isinstance(visitor, str):
        raise ValueError('no visitor data')
    return visitor


def _ytdlp_quick(vid, args, yt_dlp):
    """A video by the one client that needs neither YouTube's player nor QuickJS, and neither the watch page: two small requests. Yt-dlp's
    usual way costs 1.3 MB and QuickJS working through 3 MB of script, for every video. This client takes no cookies, and what it
    can't do (a live stream, an age limit, a refusal) only costs those two requests, so the info, or None for the long way to try."""
    try:
        opts = dict(_ydl_options(args), format='all', extractor_retries=0, extractor_args={'youtube': {
            'player_client': ['visionos'], 'player_skip': ['webpage', 'configs', 'initial_data', 'js'], 'skip': ['hls'],
            'visitor_data': [_visitor_data()]}})
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f'https://www.youtube.com/watch?v={vid}', download=False)
        formats = info.get('formats') or []
        picked = pick_video(formats, args.cap, bool(info.get('is_live')))
        if not picked:
            raise Refused('nocodec')
        # A video filmed at 50 or 60 fps: this client has its 720p only at that rate, which the Atom can't decode, so pick_video goes down to
        # 480p. The long way has a 720p at 30 fps. Nothing taller under the cap means nothing better is there to find.
        if any(picked['height'] < (f.get('height') or 0) <= args.cap for f in formats if f.get('vcodec') not in (None, 'none')):
            raise Refused('nocodec')
        return info
    except Exception as e:
        print(f'resolve.py: {vid}: not found the quick way: {(str(e) or _Quiet.last_error)[:200]}', file=sys.stderr)
        return None


def _solved_players(args):
    """yt-dlp's files of YouTube's player with the challenges' work done, the newest first."""
    folder = os.path.join(args.cache, 'ytdlp', 'challenge-solver') if args.cache else ''
    try:
        paths = [os.path.join(folder, n) for n in os.listdir(folder) if n.startswith('player')]
        return sorted(paths, key=os.path.getmtime, reverse=True)
    except OSError:
        return []


def _remove(paths):
    for p in paths:
        try:
            os.unlink(p)
        except OSError:
            pass


def _keep_solved_players():
    """The long way, once per version of YouTube's player: the player is fetched once and QuickJS works through it once, and then a video
    takes it 0.6 s where it took 6 s. yt-dlp leaves this off because the files are large and it never removes one: _solved_players does."""
    try:
        from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
        EJSBaseJCP._ENABLE_PREPROCESSED_PLAYER_CACHE = True
    except ImportError as e:
        print(f'resolve.py: no keeping of solved players: {e}', file=sys.stderr)


def _ytdlp_info(vid, args, yt_dlp):
    opts = dict(_ydl_options(args), format='all')
    cookies = _readable_cookies_path(args)
    if cookies:
        opts['cookiefile'] = cookies
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(f'https://www.youtube.com/watch?v={vid}', download=False)
    except Exception as e:
        message = str(e) or _Quiet.last_error
        print(f'resolve.py: {vid}{" with cookies" if cookies else ""}: {message[:300]}', file=sys.stderr)
        raise Refused(classify(message))


def _ytdlp_cookied(vid, args, yt_dlp):
    try:
        return _ytdlp_info(vid, args, yt_dlp)
    except Refused as e:
        if e.reason != 'blocked' or not _fetch_cookies(args):
            raise
        return _ytdlp_info(vid, args, yt_dlp)


def _ytdlp_long(vid, args, yt_dlp):
    _keep_solved_players()
    known = _solved_players(args)
    _Quiet.challenge_failed = False
    try:
        info = _ytdlp_cookied(vid, args, yt_dlp)
    except Refused:
        if not (known and _Quiet.challenge_failed):
            raise
    if known and _Quiet.challenge_failed:   # it would fail this way every time, since nothing else replaces one. A new yt-dlp may not read an old one
        print('resolve.py: a solved player did not work: solving it again', file=sys.stderr)
        _remove(known)
        known = []
        info = _ytdlp_cookied(vid, args, yt_dlp)
    players = _solved_players(args)
    _remove(players[SOLVED_PLAYERS_KEPT:])
    return info, len(set(players) - set(known))


def ytdlp_url(vid, args):
    yt_dlp = _yt_dlp()
    python_s = time.monotonic() - STARTED
    info = _ytdlp_quick(vid, args, yt_dlp)
    how = 'the quick way'
    if not info:
        info, solved = _ytdlp_long(vid, args, yt_dlp)
        how = f'the long way{", with cookies" if _cookies_path(args) else ""}{", solving a new player" if solved else ""}'
    live = bool(info.get('is_live'))
    _save_subs(vid, args, None if live else pick_subs(info.get('subtitles') or {}, info.get('automatic_captions') or {}, spoken_language(info)))
    print(f'resolve.py: found {how} in {time.monotonic() - STARTED:.1f} s, {python_s:.1f} s of it starting Python', file=sys.stderr)
    return stream_answer(vid, info.get('title'), info.get('channel') or info.get('uploader'), info.get('duration'),
                         info.get('formats') or [], args.cap, live)


def ytdlp_search(query, args):
    yt_dlp = _yt_dlp()
    opts = dict(_ydl_options(args), extract_flat='in_playlist')
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f'ytsearch{SEARCH_RESULTS}:{query}', download=False)
    except Exception as e:
        raise Refused(classify(str(e) or _Quiet.last_error))
    out = []
    for e in info.get('entries') or []:
        if e and ID_RE.match(str(e.get('id') or '')):
            out.append({'id': e['id'], 'title': e.get('title') or '', 'channel': e.get('channel') or e.get('uploader') or '',
                        'duration': e.get('duration') or 0})
    return out


# ---- a Piped or Invidious server ----

def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'drake1804-ytplay', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        return json.loads(r.read(4 * 1024 * 1024))


def _size_of(resolution, size):
    m = re.match(r'^(\d+)x(\d+)$', str(size or ''))
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r'^(\d+)p', str(resolution or ''))
    return (0, int(m.group(1))) if m else (0, 0)


def invidious_formats(d):
    formats = []
    for f in (d.get('adaptiveFormats') or []) + (d.get('formatStreams') or []):
        kind = str(f.get('type') or '')
        codecs = re.search(r'codecs="([^"]*)"', kind)
        names = (codecs.group(1) if codecs else '').split(', ')
        width, height = _size_of(f.get('resolution') or f.get('qualityLabel'), f.get('size'))
        vcodec = next((n for n in names if n.startswith(('avc1', 'vp', 'av01'))), 'none')
        acodec = next((n for n in names if n.startswith(('mp4a', 'opus'))), 'none')
        formats.append({'url': f.get('url'), 'vcodec': vcodec, 'acodec': acodec, 'width': width, 'height': height,
                        'fps': f.get('fps') or 0, 'tbr': int(f.get('bitrate') or 0) / 1000, 'protocol': 'https'})
    return formats


def piped_formats(d):
    formats = []
    for f in d.get('videoStreams') or []:
        formats.append({'url': f.get('url'), 'vcodec': f.get('codec') or 'none', 'acodec': 'none',
                        'width': f.get('width') or 0, 'height': f.get('height') or 0, 'fps': f.get('fps') or 0,
                        'tbr': (f.get('bitrate') or 0) / 1000, 'protocol': 'https'})
    for f in d.get('audioStreams') or []:
        formats.append({'url': f.get('url'), 'vcodec': 'none', 'acodec': f.get('codec') or 'none',
                        'abr': (f.get('bitrate') or 0) / 1000, 'protocol': 'https'})
    return formats


def invidious_subs(d, base):
    """A server's tracks as (uploaded, automatic), in yt-dlp's shape: all WebVTT, and what it guessed is in the video's own language."""
    uploaded, automatic = {}, {}
    for c in d.get('captions') or []:
        lang = str(c.get('language_code') or c.get('languageCode') or '')
        track = [{'ext': 'vtt', 'url': urllib.parse.urljoin(base + '/', str(c.get('url') or ''))}]
        if lang and 'auto-generated' in str(c.get('label')):
            automatic[lang + '-orig'] = track
        elif lang:
            uploaded[lang] = track
    return uploaded, automatic


def piped_subs(d):
    uploaded, automatic = {}, {}
    for s in d.get('subtitles') or []:
        lang = str(s.get('code') or '')
        track = [{'ext': 'vtt', 'url': s.get('url')}]
        if lang and s.get('mimeType') == 'text/vtt' and s.get('autoGenerated'):
            automatic[lang + '-orig'] = track
        elif lang and s.get('mimeType') == 'text/vtt':
            uploaded[lang] = track
    return uploaded, automatic


def _instance_first(paths):
    """The first of the server's addresses that answers: which of the two kinds of server it is shows in that."""
    last = None
    for kind, url in paths:
        try:
            return kind, _get_json(url)
        except Exception as e:
            last = e
    raise Refused('network' if isinstance(last, OSError) and not hasattr(last, 'code') else 'instance')


def instance_url(vid, args):
    base = args.instance.rstrip('/')
    kind, d = _instance_first([('invidious', f'{base}/api/v1/videos/{vid}'), ('piped', f'{base}/streams/{vid}')])
    if kind == 'invidious':
        live = bool(d.get('liveNow'))
        _save_subs(vid, args, None if live else pick_subs(*invidious_subs(d, base)))
        return stream_answer(vid, d.get('title'), d.get('author'), d.get('lengthSeconds'), invidious_formats(d), args.cap, live)
    live = bool(d.get('livestream'))
    _save_subs(vid, args, None if live else pick_subs(*piped_subs(d)))
    return stream_answer(vid, d.get('title'), d.get('uploader'), d.get('duration'), piped_formats(d), args.cap, live)


def instance_search(query, args):
    base = args.instance.rstrip('/')
    q = urllib.parse.quote(query)
    kind, d = _instance_first([('invidious', f'{base}/api/v1/search?q={q}&type=video'),
                               ('piped', f'{base}/search?q={q}&filter=videos')])
    out = []
    if kind == 'invidious':
        for e in d if isinstance(d, list) else []:
            if e.get('type', 'video') == 'video' and ID_RE.match(str(e.get('videoId') or '')):
                out.append({'id': e['videoId'], 'title': e.get('title') or '', 'channel': e.get('author') or '',
                            'duration': e.get('lengthSeconds') or 0})
    else:
        for e in d.get('items') or []:
            m = re.search(r'[?&]v=([A-Za-z0-9_-]{11})', str(e.get('url') or ''))
            if m:
                out.append({'id': m.group(1), 'title': e.get('title') or '', 'channel': e.get('uploaderName') or '',
                            'duration': e.get('duration') or 0})
    return out[:SEARCH_RESULTS]


# ---- the cache ----

def prune_cache(cache, max_bytes=CACHE_MAX_BYTES):
    """The oldest files go until the folder fits. yt-dlp's go last: they are written once and so look old, and without them the next
    video fetches YouTube's player again and solves its challenge again, which costs far more than a thumbnail does."""
    ytdlp = os.path.join(cache, 'ytdlp')
    files = []
    total = 0
    for root, _, names in os.walk(cache):
        last = root == ytdlp or root.startswith(ytdlp + os.sep)
        for n in names:
            p = os.path.join(root, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            files.append((last, st.st_mtime, st.st_size, p))
            total += st.st_size
    files.sort()
    for _, _, size, p in files:
        if total <= max_bytes:
            break
        try:
            os.unlink(p)
            total -= size
        except OSError:
            pass


def _write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def thumb(vid, args):
    if not ID_RE.match(vid):
        raise Refused('badlink')
    if not args.cache or not args.ffmpeg:
        raise Refused('extractor')
    os.makedirs(args.cache, exist_ok=True)
    out = os.path.join(args.cache, vid + '.rgba')
    size = THUMB_W * THUMB_H * 4
    if not (os.path.exists(out) and os.path.getsize(out) == size):
        try:
            req = urllib.request.Request(f'{THUMB_BASE}{vid}/mqdefault.jpg', headers={'User-Agent': 'drake1804-ytplay'})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
                jpeg = r.read(THUMB_MAX_BYTES + 1)
        except Exception as e:
            raise Refused('network' if not hasattr(e, 'code') else 'unavailable')
        if len(jpeg) > THUMB_MAX_BYTES:
            raise Refused('unavailable')
        p = subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
                            '-f', 'jpeg_pipe', '-i', 'pipe:0', '-vf', f'scale={THUMB_W}:{THUMB_H}:flags=fast_bilinear,format=rgba',
                            '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'],
                           input=jpeg, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=False)
        if p.returncode or len(p.stdout) != size:
            raise Refused('unavailable')
        _write_atomic(out, p.stdout)
        prune_cache(args.cache)
    else:
        os.utime(out)
    with open(out, 'rb') as f:
        return {'ok': True, 'id': vid, 'w': THUMB_W, 'h': THUMB_H, 'rgba': base64.b64encode(f.read()).decode()}


# ---- subtitles ----

def _subs_path(args, vid, ext):
    return os.path.join(args.cache, 'subs', vid + ext)


def _save_subs(vid, args, track):
    """What `subs` will fetch. Whatever goes wrong here, the video still plays."""
    if not args.cache:
        return
    try:
        os.makedirs(os.path.join(args.cache, 'subs'), exist_ok=True)
        _write_atomic(_subs_path(args, vid, '.track'), json.dumps(track or {}).encode())
    except OSError as e:
        print(f'resolve.py: subtitles: {e}', file=sys.stderr)


def _read_cached(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def parse_json3(raw):
    """YouTube's own format. Its guesses come as lines that overlap, a word at a time: a line shows whole."""
    cues = []
    for e in json.loads(raw).get('events') or []:
        words = ' '.join(''.join(s.get('utf8') or '' for s in e.get('segs') or []).split())
        if words and isinstance(e.get('tStartMs'), int):
            cues.append([e['tStartMs'], e['tStartMs'] + (e.get('dDurationMs') or 0), words])
    return cues


def parse_vtt(raw):
    """WebVTT, from a Piped or Invidious server: time lines, each with its words under it until a blank line."""
    ms = lambda h, m, s, f: (int(h or 0) * 3600 + int(m) * 60 + int(s)) * 1000 + int(f)     # noqa: E731
    cues = []
    for block in re.split(r'\n\s*\n', raw.decode('utf-8', 'replace').replace('\r\n', '\n')):
        lines = block.split('\n')
        for i, line in enumerate(lines):
            t = VTT_TIMES.search(line)
            if t:
                words = ' '.join(html.unescape(re.sub(r'<[^>]*>', '', ' '.join(lines[i + 1:]))).split())
                if words:
                    cues.append([ms(*t.groups()[:4]), ms(*t.groups()[4:]), words])
                break
    return cues


def tidy_cues(cues):
    """In order and none overlapping, as the app looks them up: the next line takes over. A line said twice over is one line. Only as
    many as the player will pass on."""
    out = []
    size = 0
    for start, end, words in sorted(cues, key=lambda c: c[0]):
        if out and out[-1][2] == words and start <= out[-1][1]:
            out[-1][1] = max(out[-1][1], end)
            continue
        if out:
            out[-1][1] = min(out[-1][1], start)
            if out[-1][1] <= out[-1][0]:
                out.pop()
        size += len(words.encode('utf-8', 'replace')) + SUBS_CUE_BYTES
        if size > SUBS_MAX_ANSWER:
            break
        out.append([start, end, words])
    return [c for c in out if c[1] > c[0]]


def subs(vid, args):
    if not ID_RE.match(vid):
        raise Refused('badlink')
    track = _read_cached(_subs_path(args, vid, '.track')) if args.cache else None
    if not track or not track.get('url'):
        return {'ok': True, 'id': vid, 'lang': '', 'cues': []}
    path = _subs_path(args, vid, '.cues')
    cached = _read_cached(path)
    if cached and cached.get('lang') == track['lang']:
        return cached
    try:
        req = urllib.request.Request(track['url'], headers={'User-Agent': 'drake1804-ytplay'})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            raw = r.read(SUBS_MAX_FETCH + 1)
    except urllib.error.HTTPError as e:
        print(f'resolve.py: subtitles of {vid}: HTTP {e.code}', file=sys.stderr)
        raise Refused('blocked' if e.code == 429 else 'nosubs')
    except OSError:
        raise Refused('network')
    if not raw or len(raw) > SUBS_MAX_FETCH:
        print(f'resolve.py: subtitles of {vid}: {len(raw)} bytes', file=sys.stderr)
        raise Refused('nosubs')
    try:
        cues = parse_json3(raw) if track.get('ext') == 'json3' else parse_vtt(raw)
    except (ValueError, AttributeError, TypeError) as e:
        print(f'resolve.py: subtitles of {vid}: {e!r}', file=sys.stderr)
        raise Refused('nosubs')
    answer = {'ok': True, 'id': vid, 'lang': track['lang'], 'cues': tidy_cues(cues)}
    try:
        _write_atomic(path, json.dumps(answer).encode())
        prune_cache(args.cache)
    except OSError as e:        # fetched all the same
        print(f'resolve.py: subtitles: {e}', file=sys.stderr)
    return answer


# ---- an account: Google's sign-in for limited-input devices, and YouTube's Data API. The tokens stay in --state.

def _state_path(args, name):
    if not args.state:
        raise Refused('nosetup')
    return os.path.join(args.state, name)


def _state_read(args, name):
    try:
        with open(_state_path(args, name), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _state_write(args, name, value):
    path = _state_path(args, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))      # 0600
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(value, f)
    os.replace(tmp, path)


def _state_remove(args, name):
    try:
        os.unlink(_state_path(args, name))
    except OSError:
        pass


def _post_form(url, fields, headers=None):
    """(HTTP status, JSON answer). A refusal is an answer: the sign-in flow says what it means in the body."""
    body = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=body, headers=dict(headers or {}, **{'Content-Type': 'application/x-www-form-urlencoded'}))
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            return r.status, json.loads(r.read(1024 * 1024) or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read(1024 * 1024) or b'{}')
        except ValueError:
            return e.code, {}
    except (OSError, ValueError):
        raise Refused('network')


def signin_start(args):
    status, a = _post_form(f'{SIGNIN_RELAY}/start', {})
    if status != 200 or not a.get('device_code'):
        print(f'resolve.py: signin/start {status}: {a.get("error")}', file=sys.stderr)
        raise Refused('network' if status >= 500 else 'signin')
    _state_write(args, 'device.json', {'device_code': a['device_code'], 'expires_at': time.time() + a.get('expires_in', 1800)})
    return {'ok': True, 'code': a['user_code'], 'url': a.get('verification_url') or a.get('verification_uri'),
            'expires_in': a.get('expires_in', 1800), 'interval': a.get('interval', 5)}


def _save_tokens(args, a, old_refresh=None):
    _state_write(args, 'token.json', {'access_token': a['access_token'], 'refresh_token': a.get('refresh_token') or old_refresh,
                                      'expires_at': time.time() + a.get('expires_in', 3600) - 60})


def signin_poll(args):
    device = _state_read(args, 'device.json')
    if not device:
        return {'ok': True, 'status': 'expired'}
    status, a = _post_form(f'{SIGNIN_RELAY}/token', {'device_code': device['device_code'],
                                                     'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'})
    error = a.get('error')
    if status == 200 and a.get('access_token'):
        _save_tokens(args, a)
        _state_remove(args, 'device.json')
        try:
            name = _account_name(args)
        except Refused:         # signed in all the same: the name can wait
            name = 'Your account'
        return {'ok': True, 'status': 'done', 'name': name}
    if error == 'authorization_pending':
        return {'ok': True, 'status': 'pending'}
    if error == 'slow_down':
        return {'ok': True, 'status': 'pending', 'interval': 10}
    if status >= 500 and device.get('expires_at', 0) > time.time():     # the relay or Google, for a moment: the code is still good
        print(f'resolve.py: signin/token {status}: {error}', file=sys.stderr)
        return {'ok': True, 'status': 'pending'}
    _state_remove(args, 'device.json')
    print(f'resolve.py: signin/token {status}: {error}', file=sys.stderr)
    return {'ok': True, 'status': 'denied' if error == 'access_denied' else 'expired'}


def _cookies_path(args):
    path = os.path.join(args.state, COOKIES_FILE) if args.state else ''
    return path if path and os.path.exists(path) else ''


def _readable_cookies(text):
    """(this cookie file as yt-dlp can read all of it, or '' with no cookie left, how many lines were left out). yt-dlp prints a line it
    can't read to stderr, which is the player's log, value and all. A line that fails later on is worse: it refuses the whole file, quotes
    the line in its error, and leaves the file as it is for the next video to do the same. So such a line never reaches it. The same test
    is problemWith() in services/logs-relay/set-cookies.js."""
    kept, bad = [], 0
    for line in re.split(r'\r\n?|\n', text):        # yt-dlp's lines: a lone \r ends one too
        bare = line.removeprefix('#HttpOnly_')
        if bare.startswith('#') or not bare.strip():
            continue
        f = bare.split('\t')
        if len(f) == 7 and COOKIE_EXPIRY.fullmatch(f[4]) and (f[1] == 'TRUE') == f[0].startswith('.'):
            kept.append(line + '\n')
        else:
            bad += 1
    return COOKIES_HEADER + ''.join(kept) if kept else '', bad


def _keep_cookies(args, text):
    """Saves what yt-dlp can read of a cookie file, and says how much it wasn't, never what. True if that left any cookies."""
    readable, bad = _readable_cookies(text)
    if bad:
        print(f'resolve.py: video cookies: lines yt-dlp could not read, left out: {bad}', file=sys.stderr)
    if not readable:
        return False
    fd, tmp = tempfile.mkstemp(dir=args.state)      # 0600
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(readable)
    os.replace(tmp, os.path.join(args.state, COOKIES_FILE))
    return True


def _readable_cookies_path(args):
    """The cookie file for yt-dlp, once it holds nothing it can't read. _fetch_cookies isn't the only way a bad line gets there: an older
    player kept what the relay gave it as it was, a resolver stopped while yt-dlp rewrites the file leaves half a line, and yt-dlp writes
    back whatever a server set. With no cookie left, the relay is asked again the next time YouTube refuses a video."""
    path = _cookies_path(args)
    if not path:
        return ''
    try:
        with open(path, encoding='utf-8') as f:
            text = f.read()
    except (OSError, ValueError):
        text = ''
    readable, bad = _readable_cookies(text)
    if (readable and not bad and text.startswith(COOKIES_HEADER)) or _keep_cookies(args, text):
        return path
    for name in (COOKIES_FILE, 'cookies.json'):
        _state_remove(args, name)
    return ''


def _fetch_cookies(args):
    """The video cookies, for when YouTube refuses a video as a bot: the relay gives them only to the signed-in account it allows.
    True when there are new ones to try. See services/logs-relay."""
    for force in (False, True):
        try:
            token = _access_token(args, force)
            status, a = _post_form(f'{SIGNIN_RELAY}/cookies', {}, {'Authorization': f'Bearer {token}'})
        except Refused as e:
            print(f'resolve.py: video cookies: {e.reason}', file=sys.stderr)
            return False
        if status != 401:
            break
    text = a.get('cookies') if status == 200 else None
    if not text:
        print(f'resolve.py: video cookies: {status}: {a.get("error")}', file=sys.stderr)
        return False
    sha = hashlib.sha256(text.encode()).hexdigest()
    if (_state_read(args, 'cookies.json') or {}).get('sha256') == sha:     # yt-dlp rewrites the file, so its bytes can't tell
        print('resolve.py: video cookies: no newer ones', file=sys.stderr)
        return False
    if not _keep_cookies(args, text):
        print('resolve.py: video cookies: none that yt-dlp can read', file=sys.stderr)
        return False
    _state_write(args, 'cookies.json', {'sha256': sha})
    print('resolve.py: video cookies: new ones from the relay', file=sys.stderr)
    return True


def _sign_out_locally(args):
    """All but the video cookies: a sign-in that expires shouldn't stop the video too."""
    for name in ('token.json', 'account.json', 'device.json'):
        _state_remove(args, name)
    feeds = _state_path(args, 'feeds')
    if os.path.isdir(feeds):
        for n in os.listdir(feeds):
            try:
                os.unlink(os.path.join(feeds, n))
            except OSError:
                pass


def signout(args):
    token = _state_read(args, 'token.json') or {}
    if token.get('refresh_token'):
        try:
            _post_form(f'{OAUTH_BASE}/revoke', {'token': token['refresh_token']})
        except Refused:
            pass        # offline: the tokens go from here anyway, and the person can revoke them in their Google account
    _sign_out_locally(args)
    for name in (COOKIES_FILE, 'cookies.json'):
        _state_remove(args, name)
    return {'ok': True}


def _access_token(args, force=False, instead_of=None):
    """instead_of: the token a call was refused with. Another of this run's calls at once may have renewed it since, and that one is used."""
    token = _state_read(args, 'token.json')
    if not token:
        raise Refused('signedout')
    renewed = instead_of is not None and token.get('access_token') != instead_of
    if (not force or renewed) and token.get('expires_at', 0) > time.time():
        return token['access_token']
    if not token.get('refresh_token'):
        raise Refused('signedout')
    status, a = _post_form(f'{SIGNIN_RELAY}/token', {'refresh_token': token['refresh_token'], 'grant_type': 'refresh_token'})
    if status == 200 and a.get('access_token'):
        _save_tokens(args, a, token['refresh_token'])
        return a['access_token']
    if a.get('error') == 'invalid_grant':       # revoked, or a client still "Testing", whose tokens last 7 days
        _sign_out_locally(args)
        raise Refused('signedout')
    raise Refused('network' if status >= 500 else 'extractor')


def _api_connection():
    """A connection to the API's host, opened when first used. Through the proxy urllib would use, if the environment names one."""
    base = urllib.parse.urlsplit(API_BASE)
    if base.scheme != 'https':      # only ever a stand-in
        return http.client.HTTPConnection(base.hostname, base.port, timeout=HTTP_TIMEOUT_S)
    proxy = urllib.request.getproxies().get('https')
    if not proxy or urllib.request.proxy_bypass(base.hostname):
        return http.client.HTTPSConnection(base.hostname, base.port, timeout=HTTP_TIMEOUT_S)
    p = urllib.parse.urlsplit(proxy if '://' in proxy else '//' + proxy)
    conn = http.client.HTTPSConnection(p.hostname, p.port, timeout=HTTP_TIMEOUT_S)
    conn.set_tunnel(base.hostname, base.port)
    return conn


def _api_get(args, target, headers):
    """(HTTP status, body), over the one connection a run keeps to the API's host for each thread: on a slow link a handshake for each call is
    most of a list's wait. A host may close a connection it has answered on, so a failure on a used one gets one try on a new one. Not a
    timeout: that is the link."""
    if args.api is None:
        args.api = {}
    conn = args.api.get(_thread.get_ident())
    if conn is None:
        conn = args.api[_thread.get_ident()] = _api_connection()
    used = conn.sock is not None
    while True:
        try:
            conn.request('GET', target, headers=headers)
            r = conn.getresponse()
            body = r.read(4 * 1024 * 1024)
            if not r.isclosed():    # longer than that: the rest would read as the next answer
                conn.close()
            return r.status, body
        except (OSError, http.client.HTTPException) as e:
            conn.close()
            if not used or isinstance(e, TimeoutError):
                raise
            used = False


def _api(args, path, **params):
    """One Data API call, as the signed-in person. Calls at once renew the token one at a time, and only once between them."""
    target = f'{urllib.parse.urlsplit(API_BASE).path}/{path}?{urllib.parse.urlencode(params)}'
    if getattr(args, 'token_lock', None) is None:
        args.token_lock = _thread.allocate_lock()
    token = None
    for attempt in (0, 1):
        with args.token_lock:
            token = _access_token(args, force=attempt > 0, instead_of=token if attempt > 0 else None)
        headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json', 'User-Agent': 'drake1804-ytplay'}
        try:
            status, body = _api_get(args, target, headers)
            if 200 <= status < 300:
                return json.loads(body)
        except (OSError, ValueError, http.client.HTTPException):
            raise Refused('network')
        if status == 401 and attempt == 0:
            continue
        if status == 403:
            raise Refused('quota')
        if status == 404:
            raise Refused('badfeed')
        raise Refused('extractor')
    raise Refused('signedout')


def _account_name(args):
    a = _api(args, 'channels', part='snippet,contentDetails', mine='true')
    item = (a.get('items') or [{}])[0]
    snippet = item.get('snippet') or {}
    info = {'name': snippet.get('title') or 'Your account', 'country': snippet.get('country') or ''}
    _state_write(args, 'account.json', info)
    return info['name']


def account(args):
    configured = bool(args.state)
    if not args.state or not _state_read(args, 'token.json'):
        return {'ok': True, 'signedIn': False, 'configured': configured}
    info = _state_read(args, 'account.json') or {}
    return {'ok': True, 'signedIn': True, 'configured': configured, 'name': info.get('name') or 'Your account'}


def parse_iso_duration(text):
    """Seconds in YouTube's PT1H2M3S; a live stream's P0D is 0."""
    m = re.match(r'^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$', str(text or ''))
    if not m:
        return 0
    d, h, mins, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mins * 60 + s


def _published(text):
    try:
        return calendar.timegm(time.strptime(str(text)[:19], '%Y-%m-%dT%H:%M:%S'))
    except ValueError:
        return 0


def _video_rows(items):
    rows = []
    for v in items or []:
        vid = v.get('id')
        snippet = v.get('snippet') or {}
        if not ID_RE.match(str(vid or '')) or not snippet.get('title'):
            continue
        rows.append({'id': vid, 'title': snippet['title'], 'channel': snippet.get('channelTitle') or '',
                     'duration': parse_iso_duration((v.get('contentDetails') or {}).get('duration')),
                     'published': _published(snippet.get('publishedAt'))})
    return rows


def _videos_by_id(args, ids, rows=FEED_ROWS):
    """The videos with the first `rows` of these ids, in that order. What YouTube no longer has is left out."""
    ids = list(dict.fromkeys(i for i in ids if ID_RE.match(str(i))))[:rows]
    if not ids:
        return []
    rows = _video_rows(_api(args, 'videos', part='snippet,contentDetails', id=','.join(ids), maxResults=len(ids)).get('items'))
    by_id = {r['id']: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def _at_once(fn, items, at_once):
    """[fn(item) for item in items], at_once of them at a time: this thread and the rest each keep a connection of their own. After a
    refusal nothing more starts, and once the calls under way have ended it is the answer."""
    if at_once <= 1 or len(items) <= 1:
        return [fn(item) for item in items]
    import threading
    out = [None] * len(items)
    todo = list(range(len(items) - 1, -1, -1))
    failed = []
    lock = threading.Lock()

    def work():
        while True:
            with lock:
                if failed or not todo:
                    return
                i = todo.pop()
            try:
                out[i] = fn(items[i])
            except BaseException as e:      # noqa: B036: whatever it was, the run's answer says so
                with lock:
                    failed.append(e)
                return

    helpers = [threading.Thread(target=work, daemon=True) for _ in range(min(at_once, len(items)) - 1)]
    for t in helpers:
        t.start()
    work()
    for t in helpers:
        t.join()
    if failed:
        raise failed[0]
    return out


def _uploads(args, channel):
    """(published, video id) of a channel's newest uploads."""
    try:
        items = _api(args, 'playlistItems', part='contentDetails', playlistId='UU' + channel[2:], maxResults=UPLOADS_PER_CHANNEL).get('items')
    except Refused as e:
        if e.reason == 'badfeed':       # a channel with no uploads
            return []
        raise
    return [(_published(cd.get('videoPublishedAt')), cd.get('videoId')) for cd in ((it.get('contentDetails') or {}) for it in items or [])]


def feed_subs(args, rows=FEED_ROWS):
    """The newest uploads of the first SUB_CHANNELS subscriptions. YouTube's API has no list of a person's new videos: it is a call for each
    channel, so they go SUB_AT_ONCE at a time. Fewer channels missed what the others had posted: 12 of 50 showed Home days behind."""
    subs = _api(args, 'subscriptions', part='snippet', mine='true', order='relevance', maxResults=SUB_CHANNELS).get('items') or []
    channels = [c for c in (((s.get('snippet') or {}).get('resourceId') or {}).get('channelId') or '' for s in subs[:SUB_CHANNELS]) if c.startswith('UC')]
    uploads = [u for each in _at_once(lambda c: _uploads(args, c), channels, SUB_AT_ONCE) for u in each]
    uploads.sort(key=lambda u: u[0], reverse=True)
    return _videos_by_id(args, [u[1] for u in uploads], rows)


def feed_popular(args):
    params = {'part': 'snippet,contentDetails', 'chart': 'mostPopular', 'maxResults': 12}
    country = (_state_read(args, 'account.json') or {}).get('country')
    if country:
        params['regionCode'] = country
    return _video_rows(_api(args, 'videos', **params).get('items'))


def feed_home(args, fresh):
    """(rows, when fetched, how for the log): new uploads from the subscriptions and what is popular, in turn, so that it does not start as
    Subscriptions does. That part is Subscriptions' own list, kept, so the two tabs cost its calls once between them."""
    subs, at, subs_how = _kept(args, 'subs', feed_subs, fresh)
    try:
        popular, popular_at, popular_how = _kept(args, 'popular', feed_popular, fresh)
        at = min(at, popular_at)
    except Refused as e:
        if not subs:
            raise
        print(f'resolve.py: popular: {e.reason}', file=sys.stderr)
        popular, popular_how = [], f'refused, {e.reason}'
    seen = set()
    rows = []
    for i in range(max(len(subs), len(popular))):
        for r in (subs[i:i + 1] + popular[i:i + 1]):
            if r['id'] not in seen:
                seen.add(r['id'])
                rows.append(r)
    return rows[:FEED_ROWS], at, f'subs {subs_how}, popular {popular_how}'


def feed_liked(args):
    return _video_rows(_api(args, 'videos', part='snippet,contentDetails', myRating='like', maxResults=FEED_ROWS).get('items'))


def feed_playlists(args):
    out = []
    for p in _api(args, 'playlists', part='snippet,contentDetails', mine='true', maxResults=FEED_ROWS).get('items') or []:
        snippet = p.get('snippet') or {}
        thumbs = snippet.get('thumbnails') or {}
        thumb_url = next((t.get('url') for t in thumbs.values() if t.get('url')), '')
        m = re.search(r'/vi/([A-Za-z0-9_-]{11})/', thumb_url)
        out.append({'playlist': p.get('id'), 'title': snippet.get('title') or '', 'count': (p.get('contentDetails') or {}).get('itemCount') or 0,
                    'thumb': m.group(1) if m else ''})
    return out


def feed_playlist(args, pid):
    if not PLAYLIST_ID_RE.match(pid):
        raise Refused('badfeed')
    items = _api(args, 'playlistItems', part='contentDetails', playlistId=pid, maxResults=FEED_ROWS).get('items') or []
    return _videos_by_id(args, [(i.get('contentDetails') or {}).get('videoId') for i in items])


FEEDS = {'subs': feed_subs, 'liked': feed_liked, 'playlists': feed_playlists}


def _span(s):
    s = int(s)
    for size, unit in ((86400, 'days'), (3600, 'h'), (60, 'min')):
        if s >= size:
            return f'{s / size:.1f} {unit}' if unit == 'days' else f'{s // size} {unit}'
    return f'{s} s'


def _kept(args, name, fetch, fresh):
    """(rows, when fetched, how for the log). A list stays ten minutes: each costs calls against the day's quota. One saved at a time still
    to come by this clock is old: the unit's clock can go back, and it would be kept until the clock got there, which was days."""
    key = 'feeds/' + hashlib.sha1(name.encode()).hexdigest() + '.json'
    cached = _state_read(args, key)
    now = time.time()
    if not (isinstance(cached, dict) and isinstance(cached.get('rows'), list) and isinstance(cached.get('at'), (int, float))):
        cached = None
    age = now - cached['at'] if cached else 0
    if cached and not fresh and 0 <= age < FEED_TTL_S:
        return cached['rows'], cached['at'], f'kept {age:.0f} s'
    t0 = time.monotonic()
    rows = fetch(args)
    at = time.time()
    _state_write(args, key, {'at': at, 'rows': rows})
    ahead = f', the kept one was {_span(-age)} ahead of this clock' if age < 0 else ''
    return rows, at, f'fetched{" fresh" if fresh else ""} in {time.monotonic() - t0:.1f} s{ahead}'


def feed(name, args):
    """A list as the signed-in person sees it, and one line in the log: which, what it starts with, and from where."""
    if not args.state or not _state_read(args, 'token.json'):
        raise Refused('signedout')
    fresh = name.startswith(FRESH)
    if fresh:
        name = name[len(FRESH):]
    if name.startswith('playlist:'):
        fetch = lambda a: feed_playlist(a, name[len('playlist:'):])     # noqa: E731
    elif name in FEEDS or name == 'home':
        fetch = FEEDS.get(name)
    else:
        raise Refused('badfeed')
    t0 = time.monotonic()
    try:
        rows, at, how = feed_home(args, fresh) if name == 'home' else _kept(args, name, fetch, fresh)
    except Refused as e:
        print(f'resolve.py: feed {name}: refused, {e.reason}, after {time.monotonic() - t0:.1f} s', file=sys.stderr)
        raise
    first = f', first {rows[0].get("id") or rows[0].get("playlist")}' if rows else ''
    print(f'resolve.py: feed {name}: {len(rows)} row{"" if len(rows) == 1 else "s"}{first}, {how}', file=sys.stderr)
    return {'ok': True, 'rows': rows, 'at': at}


def search(query, args):
    """Searches stay an hour in the cache: the same words again answer at once."""
    key = hashlib.sha1(f'{args.instance or ""}\0{query}'.encode()).hexdigest()
    path = os.path.join(args.cache, 'search', key + '.json') if args.cache else None
    if path:
        try:
            if time.time() - os.path.getmtime(path) < SEARCH_TTL_S:
                with open(path, encoding='utf-8') as f:
                    return json.load(f)
        except (OSError, ValueError):
            pass
    results = instance_search(query, args) if args.instance else ytdlp_search(query, args)
    answer = {'ok': True, 'query': query, 'results': results}
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        _write_atomic(path, json.dumps(answer).encode())
        prune_cache(args.cache)
    return answer


def run(argv):
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('--cap', type=int, default=720)
    ap.add_argument('--instance', default='')
    ap.add_argument('--cache', default='')
    ap.add_argument('--ffmpeg', default='')
    ap.add_argument('--state', default='')
    ap.add_argument('--qjs', default='')
    ap.add_argument('--node', default='')
    ap.add_argument('command', choices=['url', 'search', 'thumb', 'subs', 'account', 'signin-start', 'signin-poll', 'signout', 'feed'])
    ap.add_argument('words', nargs=argparse.REMAINDER)
    ap.set_defaults(api=None, token_lock=None)     # the connections to the API's host, a thread's each, once there are any
    args = ap.parse_args(argv)
    words = args.words[1:] if args.words[:1] == ['--'] else args.words
    arg = ' '.join(words)
    if args.command == 'url':
        vid = video_id(arg)
        if not vid:
            raise Refused('badlink')
        return instance_url(vid, args) if args.instance else ytdlp_url(vid, args)
    if args.command == 'search':
        return search(arg, args)
    if args.command == 'subs':
        return subs(arg, args)
    if args.command == 'account':
        return account(args)
    if args.command == 'signin-start':
        return signin_start(args)
    if args.command == 'signin-poll':
        return signin_poll(args)
    if args.command == 'signout':
        return signout(args)
    if args.command == 'feed':
        return feed(arg, args)
    return thumb(arg, args)


def main(argv):
    try:
        answer = run(argv)
    except Refused as e:
        answer = {'ok': False, 'error': WORDS[e.reason], 'reason': e.reason}
    except Exception as e:  # the one line is the contract: the player shows this rather than a silent exit
        print(f'resolve.py: {e!r}', file=sys.stderr)
        answer = {'ok': False, 'error': WORDS['extractor'], 'reason': 'extractor'}
    # letters as they are: \uXXXX would take three times the room in the player's fixed buffers, and cut one could break a whole status
    sys.stdout.write(json.dumps(answer, ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # whatever the locale: a head unit's is likely C
    sys.exit(main(sys.argv[1:]))
