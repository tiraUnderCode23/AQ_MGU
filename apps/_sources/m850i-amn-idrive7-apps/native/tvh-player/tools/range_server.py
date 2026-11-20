#!/usr/bin/env python3
"""range_server.py DIR PORT - serves DIR on 127.0.0.1 with HTTP Range (206), as the IPTV service serves a film to
tvh-player: the mov demuxer reads an MP4's index where it is (often at the end). Tests only."""
import http.server, os, re, sys

ROOT = os.path.abspath(sys.argv[1])

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = os.path.join(ROOT, os.path.basename(self.path.split('?')[0]))
        if not os.path.isfile(p):
            self.send_error(404); return
        size = os.path.getsize(p)
        m = re.match(r'bytes=(\d+)-(\d*)', self.headers.get('Range', ''))
        a, b = (int(m.group(1)), int(m.group(2)) if m.group(2) else size - 1) if m else (0, size - 1)
        b = min(b, size - 1)
        self.send_response(206 if m else 200)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(b - a + 1))
        if m: self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, size))
        self.end_headers()
        with open(p, 'rb') as f:
            f.seek(a); left = b - a + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk: break
                try: self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError): return
                left -= len(chunk)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
