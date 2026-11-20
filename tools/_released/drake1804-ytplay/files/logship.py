#!/usr/bin/env python3
"""
Sends this unit's logs online, while the driver has asked for that in the app's Settings. The player starts it and ends it:
`logs on` and `logs off` on its socket (../README.md).

  logship.py --dir LOGDIR --install ID --tool VERSION

Only three logs in LOGDIR go: ytplay.log, ytaudio.log and app.log, which is what the app hands the player. It opens nothing else:
not the state folder. Each line is cleaned here, before it leaves: see clean().

Where it got to is in logship.json, and moves on only once the server has the lines, so what is written with no internet goes when
there is some, and a restart of the unit loses nothing. How it is doing is one line in logship.status, for the player's `logs`:
the lines sent so far, then a few words.

Nothing the server says can reach anything but the status line: the answer is only ever a code.
"""
import argparse
import calendar
import gzip
import hashlib
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ.get('YTPLAY_LOGS_URL', 'https://bube-logs.vercel.app/api/ingest')
SOURCES = (('player', 'ytplay.log'), ('audio', 'ytaudio.log'), ('app', 'app.log'))
SEND_EVERY_S = float(os.environ.get('YTPLAY_LOGS_EVERY_S', 30))
BACKLOG_EVERY_S = min(SEND_EVERY_S, 5)
RETRY_MAX_S = 300
CHECK_PARENT_S = 5
BATCH_BYTES = 128 * 1024        # before compressing, across the three logs
LINE_MAX = 2000
HEAD_BYTES = 64                  # of a log's start, in a mark: enough to hold its first line's time
DAY_MAX_BYTES = 20 * 1024 * 1024    # compressed: this may well be someone's phone
HTTP_TIMEOUT_S = 20

SENT, REFUSED, LATER = 'sent', 'refused', 'later'

# ---- cleaning: what collect-logs.sh takes out, and what must not leave the car on its own

_LINK = re.compile(r'''\b([a-z][a-z0-9+.-]*://[^/\s"']*)[^\s"']*''', re.I)
_MAC = re.compile(r'(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}')
_VIN = re.compile(r'[A-HJ-NPR-Z0-9]{17}')
_SECRET = re.compile(r'''((?:token|secret|password|authorization|device_code|user_code)["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^"',\s]*''', re.I)
_BEARER = re.compile(r'\bbearer\s+\S+', re.I)
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
_IP4 = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
_IP6 = re.compile(r'\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,6}:(?:[0-9A-Fa-f]{1,4})?(?![\w:])')
_SEARCH = re.compile(r'ytsearch\d*:.*')
# where the player, the resolver and yt-dlp name a video. Elsewhere, 11 letters are as likely a word
_VIDEO = re.compile(r'(\bplay\s+|\bresolved\s+|resolve\.py:\s+|\[youtube\]\s+)([A-Za-z0-9_-]{11})\b')
# yt-dlp, on a line of a cookie file it can't read: both quote the line, value and all. resolve.py keeps such lines from it, and a log may
# hold some from before it did. docker/check_target.sh holds these words to the pinned yt-dlp, so a new one that changes them is noticed
_COOKIE_QUOTE = re.compile(r'(skipping cookie file entry|invalid Netscape format cookies file).*')


def clean(text, install):
    """
    A log line as it may leave the car. A video keeps a short name of its own, so lines about one video can still be found
    together, and it cannot be told which video it was: the name is made with this car's id.
    """
    text = _COOKIE_QUOTE.sub(r'\1 <removed>', text)
    text = _SEARCH.sub('ytsearch:<removed>', text)
    text = _VIDEO.sub(lambda m: m.group(1) + 'video-' + hashlib.sha256((install + m.group(2)).encode()).hexdigest()[:8], text)
    text = _LINK.sub(r'\1/...', text)
    text = _SECRET.sub(r'\1<removed>', text)
    text = _BEARER.sub('Bearer <removed>', text)
    text = _EMAIL.sub('<email>', text)
    text = _MAC.sub('<mac>', text)
    text = _VIN.sub('<17-chars>', text)
    text = _IP4.sub('<ip>', text)
    return _IP6.sub('<ip>', text)


# ---- reading: a mark is a file and a place in it, because a full log moves to .1. A file is its inode and how it starts: Linux soon
# gives a deleted file's inode to a new one, so after two moves the inode alone may name the wrong file


def _stat(path):
    try:
        return os.stat(path)
    except OSError:
        return None


def read_new(path, mark, limit):
    """The complete lines after mark, the mark for after them, and whether there is more behind them."""
    now, old = _stat(path), _stat(path + '.1')
    if not mark or not any(s and s.st_ino == mark['ino'] for s in (now, old)):
        # nothing sent from here yet, or more went by than the logs hold: all they still have, oldest first
        first = old or now
        if not first:
            return [], None, False
        mark = {'ino': first.st_ino, 'pos': 0}
    older = bool(old) and old.st_ino == mark['ino']
    st = old if older else now
    pos = mark['pos'] if mark['pos'] <= st.st_size else 0   # ytaudio starts its log again when it is too long
    try:
        with open(path + '.1' if older else path, 'rb') as f:
            if os.fstat(f.fileno()).st_ino != mark['ino']:
                return [], mark, True                       # it moved just now: next time
            head = f.read(HEAD_BYTES)
            if not head.startswith(bytes.fromhex(mark.get('head', ''))):
                return read_new(path, None, limit)          # not the file this mark was for
            f.seek(pos)
            data = f.read(limit)
    except OSError:
        return [], mark, False
    end = data.rfind(b'\n') + 1
    if (older and pos + len(data) >= st.st_size) or (not end and len(data) == limit):
        end = len(data)                                     # nothing more will be added to it, or a line longer than a batch
    next_mark = {'ino': mark['ino'], 'pos': pos + end, 'head': head.hex()}
    more = len(data) == limit
    if older and pos + end >= st.st_size and now:
        next_mark = {'ino': now.st_ino, 'pos': 0}
        more = now.st_size > 0 or more
    lines = data[:end].decode('utf-8', 'replace').split('\n')
    return [line[:LINE_MAX] for line in lines if line.strip()], next_mark, more


_APP_LINE = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z\s+(\w+)\s(.*)$', re.S)
_UNIT_LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s(.*)$', re.S)

# A player's or a sound line has no level of its own: it gets one from how it starts, then from a word that says something went wrong.
# Nothing here matches an indented line, which is the rest of something, such as a stack's frames in the app's log.
_WHO = r'^(?:yt(?:play|audio): )?'
# what these carry says nothing about the line: a search someone made, or the sound's state in every stats line. Video cookies that came,
# or were the ones it had, are how that went: the refusal they were for has its own line. So is how a video was found: the quick way
# passes many videos on to the long one on purpose, and if that fails too it has its own line. And a list that came: which, and from where
_ROUTINE = re.compile(_WHO + r'(?:stats: |play |command: |resolve\.py: video cookies: (?:new ones|no newer ones)|resolve\.py: found |resolve\.py: \S+: not found the quick way'
                      r'|resolve\.py: feed \S+: \d+ rows?\b)')
_WARN = re.compile(_WHO + '(?:' + '|'.join((
    r'state stalled\b(?!, sound failed)',
    r'sound: [1-9]\d* underruns',
    r'sound: the stream ended early',
    r'sound: an odd line',
    r'open failed: ', r'set_params failed: ',   # one device: another may open, and if none does the player says so
    r'\S+ crashed the plugin',
    r'too many children', r'no group ', r'chown ', r'resolv\.conf not bound',
    r'logs: the sender ended \((?!0\))',
    r'logship: (?!waiting for internet)',
    r'resolve\.py: (?:popular|(?:signin/)?token \d+): ',    # the rest of the page still works; a driver said no, or took too long
    r'resolve\.py: feed \S+: refused, ',        # the tab says why, and offers another try
    r'resolve\.py: subtitles',                  # the video plays on without them
    r'resolve\.py: (?:a solved player did not work|no keeping of solved players|no compiled code for Python)',  # it works, more slowly
    r'resolve\.py: video cookies: ',            # none to be had, which is usual for a car not signed in
    r'WARNING: ',
)) + ')')
_ERROR = re.compile(_WHO + '(?:' + '|'.join((
    r'resolve\.py: ',                           # past those above, it writes here only when something went wrong
    r'\[[^\]]+ @ 0x[0-9a-f]+\] ',               # ffmpeg runs with -loglevel error, so this is all it says: about a part of it,
    r'[a-z][a-z0-9+.-]*://\S*: ',               # or about what it was reading
    r'(?:logs: )?(?:pipe|fork|socket|poll|dropping root|exec \S+): ',
    r'/\S*: ',                                  # a file of the player's, and what the system said about it
    r'root could be taken back', r'socket path too long',
    r'(?:sound: )?(?:the sound stream would not play|the sound device did not answer|no libasound|this libasound has no|no sound device)',
    r'sound: \S+: ', r'\S+: writing: ',         # a device, and what it said
    r'Traceback ',
)) + ')')
_BAD_WORD = re.compile(r'^(?=\S).*?\b(?:\w*errors?|failed|fatal)\b', re.I)


def level_of(words):
    if _ROUTINE.match(words):
        return 'info'
    if _WARN.match(words):
        return 'warn'
    return 'error' if _ERROR.match(words) or _BAD_WORD.match(words) else 'info'


def parse(line, last_t):
    """(time, level, words). A line with no time of its own, ffmpeg's for one, has the time of the one before it."""
    m = _APP_LINE.match(line)
    try:
        if m:   # the app's, in UTC
            return calendar.timegm(time.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S')) + float(m.group(2) or 0), m.group(3), m.group(4)
        m = _UNIT_LINE.match(line)
        if m:   # the player's and ytaudio's, in the unit's own time
            return time.mktime(time.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')), level_of(m.group(2)), m.group(2)
    except (ValueError, OverflowError):
        pass
    return last_t if last_t else time.time(), level_of(line), line


def gather(log_dir, marks, install):
    """(lines ready to send, the marks for after them, whether there is more behind them)."""
    out, new_marks, more = [], dict(marks), False
    for source, name in SOURCES:
        lines, mark, behind = read_new(os.path.join(log_dir, name), marks.get(source), BATCH_BYTES // len(SOURCES))
        if mark:
            new_marks[source] = mark
        more = more or behind
        last_t = 0
        for line in lines:
            last_t, level, words = parse(line, last_t)
            out.append({'t': last_t, 's': source, 'l': level, 'm': clean(words, install)})
    return out, new_marks, more


# ---- sending


def deliver(body):
    """SENT, REFUSED (this batch will never go, so the rest goes on without it) or LATER, and a few words for the status."""
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'User-Agent': 'drake1804-logship'})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            r.read(1024)
        return SENT, ''
    except urllib.error.HTTPError as e:
        if e.code in (400, 413, 422):
            return REFUSED, f'the server refused {e.code}'
        return LATER, f'the server said {e.code}'
    except (OSError, http.client.HTTPException):    # URLError is an OSError: no route, no name, no answer
        return LATER, 'waiting for internet'


class Shipper:
    def __init__(self, log_dir, install, tool):
        self.dir, self.install, self.tool = log_dir, install, tool
        self.state_file = os.path.join(log_dir, 'logship.json')
        self.status_file = os.path.join(log_dir, 'logship.status')
        self.state = {'marks': {}, 'day': '', 'bytes': 0, 'sent': 0}
        self.fails = 0
        self.note = None
        try:
            with open(self.state_file, encoding='utf-8') as f:
                saved = json.load(f)
            if isinstance(saved, dict) and isinstance(saved.get('marks'), dict):
                self.state.update(saved)
        except (OSError, ValueError):
            pass    # as good as a fresh start: at worst what the logs still hold goes again

    def _write(self, path, text):
        tmp = path + '.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                f.write(text)
            os.replace(tmp, path)
        except OSError as e:
            print(f'logship: {path}: {e}', file=sys.stderr)

    def _say(self, note):
        """The status line, and the player's log when it changes: once, not once a try."""
        self._write(self.status_file, f'{self.state["sent"]} {note}\n')
        if note != self.note and note not in ('sending', 'all sent'):
            print(f'logship: {note}', file=sys.stderr)
        self.note = note

    def one_round(self):
        """Sends what there is to send. How long until the next round, in seconds."""
        st = self.state
        today = time.strftime('%Y-%m-%d')
        if st['day'] != today:
            st['day'], st['bytes'] = today, 0
        if st['bytes'] >= DAY_MAX_BYTES:
            self._say("today's limit is used up")
            return SEND_EVERY_S
        lines, marks, more = gather(self.dir, st['marks'], self.install)
        if not lines:
            st['marks'] = marks
            self._write(self.state_file, json.dumps(st))
            self._say('sending' if more else 'all sent')
            return BACKLOG_EVERY_S if more else SEND_EVERY_S
        body = gzip.compress(json.dumps({'v': 1, 'install': self.install, 'tool': self.tool, 'lines': lines}).encode('utf-8'))
        outcome, why = deliver(body)
        if outcome == LATER:
            self.fails += 1
            self._say(why)
            return min(SEND_EVERY_S * 2 ** min(self.fails, 8), RETRY_MAX_S)
        self.fails = 0
        st['marks'] = marks
        st['bytes'] += len(body)
        if outcome == SENT:
            st['sent'] += len(lines)
        self._write(self.state_file, json.dumps(st))
        self._say(why or ('sending' if more else 'all sent'))
        return BACKLOG_EVERY_S if more else SEND_EVERY_S


def url_is_fine(url):
    u = urllib.parse.urlparse(url)
    return u.scheme == 'https' or (u.scheme == 'http' and u.hostname in ('127.0.0.1', 'localhost'))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dir', required=True)
    p.add_argument('--install', required=True)
    p.add_argument('--tool', required=True)
    a = p.parse_args()
    if not url_is_fine(URL):
        print(f'logship: not sending logs to {URL}: it has to be https', file=sys.stderr)
        return 2
    os.nice(10)     # whatever is drawing the picture comes first
    parent = os.getppid()
    shipper = Shipper(a.dir, a.install, a.tool)
    next_round = 0.0
    while os.getppid() == parent:   # a player that died takes this with it
        if time.monotonic() >= next_round:
            next_round = time.monotonic() + shipper.one_round()
        time.sleep(max(0.01, min(CHECK_PARENT_S, next_round - time.monotonic())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
