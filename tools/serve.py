#!/usr/bin/env python3
"""Local server for daisy.

Like `python3 -m http.server`, with one twist so the browser can never run stale code: the page
is served with its code under a versioned path (/v/<version>/src/...), where the version changes
whenever any source file changes. New version -> new URLs -> the browser has to fetch them fresh,
whatever it cached before (ES modules otherwise happily come out of the HTTP cache).

It's also the hand-off between daisy and a Claude chat (see .claude/skills/solo): daisy posts the
loop to jam/loop.json, Claude writes jam/solo.json, and daisy asks every second whether a newer
solo has arrived. Every solo is recorded as it plays and lands in jam/recordings
(http://localhost:5173/jam/recordings/ to listen back).

    python3 tools/serve.py [port] [jam folder]
"""
import functools
import http.server
import json
import os
import re
import sys
import time
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
RECORDINGS_MB = 300  # past this, the oldest recordings make way
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
JAM = os.path.realpath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'jam'))


def version():
    newest = 0
    for folder, _, files in os.walk(os.path.join(ROOT, 'src')):
        for f in files:
            newest = max(newest, os.path.getmtime(os.path.join(folder, f)))
    return str(int(newest))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Only this machine's own pages: a web page elsewhere (or one that rebinds its DNS name to
    # 127.0.0.1) mustn't be able to read the jam folder or write into it.
    def local(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0]
        origin = self.headers.get('Origin')
        ok_origin = origin is None or re.fullmatch(r'https?://(localhost|127\.0\.0\.1)(:\d+)?', origin)
        return host in ('localhost', '127.0.0.1') and ok_origin

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, status, body=b'', kind='application/json', headers=()):
        self.send_response(status)
        if body:
            self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local():
            return self.reply(403)
        path, _, query = self.path.partition('?')
        if path in ('/', '/index.html'):
            with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
                html = f.read().replace('"src/', f'"v/{version()}/src/')
            return self.reply(200, html.encode(), 'text/html; charset=utf-8')
        if path == '/jam/solo':
            return self.solo(query)
        if path == '/jam/loops':
            folder = os.path.join(JAM, 'loops')
            names = os.listdir(folder) if os.path.isdir(folder) else []
            slots = sorted(int(n[:-5]) for n in names if re.fullmatch(r'\d+\.json', n))
            return self.reply(200, json.dumps({'slots': slots}).encode())
        self.path = re.sub(r'^/v/[^/]+/', '/', self.path)
        super().do_GET()

    # /jam/... is the jam folder (which may live elsewhere, for testing), and nothing outside it.
    def translate_path(self, path):
        clean = urllib.parse.unquote(path.split('?')[0])
        if clean.startswith('/jam/'):
            full = os.path.realpath(os.path.join(JAM, clean[len('/jam/'):]))
            return full if full == JAM or full.startswith(JAM + os.sep) else os.path.join(JAM, 'nowhere')
        return super().translate_path(path)

    # The newest solo, if it was written after `after` (seconds); 204 otherwise.
    def solo(self, query):
        m = re.search(r'after=([\d.]+)', query)
        after = float(m.group(1)) if m else 0
        file = os.path.join(JAM, 'solo.json')
        try:
            mtime = os.path.getmtime(file)
            if mtime <= after:
                return self.reply(204)
            with open(file, 'rb') as f:
                body = f.read()
        except OSError:
            return self.reply(204)
        self.reply(200, body, headers=[('X-Written', repr(mtime))])

    def do_POST(self):
        path, _, query = self.path.partition('?')
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if not self.local():
            return self.reply(403)
        if path == '/jam/recording':
            return self.recording(query, body)
        if path != '/jam/loop':
            return self.reply(404)
        try:
            loop = json.loads(body)
        except ValueError:
            return self.reply(400)
        if not isinstance(loop, dict):
            return self.reply(400)
        os.makedirs(JAM, exist_ok=True)
        tmp = os.path.join(JAM, 'loop.json.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(loop, f)
        os.replace(tmp, os.path.join(JAM, 'loop.json'))
        # Every loop also lives on a key of its own (jam/loops/<MIDI note>.json).
        if isinstance(loop.get('slot'), int):
            os.makedirs(os.path.join(JAM, 'loops'), exist_ok=True)
            with open(os.path.join(JAM, 'loops', f"{loop['slot']}.json"), 'w', encoding='utf-8') as f:
                json.dump(loop, f)
        self.reply(204)

    # A recorded solo: jam/recordings/<date time> <title>.webm
    def recording(self, query, body):
        name = urllib.parse.parse_qs(query).get('name', ['solo'])[0]
        name = re.sub(r'[^\w ,.()-]+', ' ', name.replace(':', ' -')).strip()[:80] or 'solo'
        folder = os.path.join(JAM, 'recordings')
        os.makedirs(folder, exist_ok=True)
        file = os.path.join(folder, f"{time.strftime('%Y-%m-%d %H%M%S')} {name}.webm")
        with open(file, 'wb') as f:
            f.write(body)
        prune(folder, RECORDINGS_MB * 1024 * 1024, keep=file)
        self.reply(204)

    def log_message(self, *args):
        pass


def prune(folder, limit, keep=None):
    """Delete the oldest recordings until the folder fits in `limit` bytes (never `keep`)."""
    files = sorted((os.path.join(folder, n) for n in os.listdir(folder)), key=os.path.getmtime)
    files = [f for f in files if f != keep]
    total = sum(os.path.getsize(f) for f in files)
    total += os.path.getsize(keep) if keep else 0
    while files and total > limit:
        oldest = files.pop(0)
        total -= os.path.getsize(oldest)
        os.remove(oldest)


handler = functools.partial(Handler, directory=ROOT)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
