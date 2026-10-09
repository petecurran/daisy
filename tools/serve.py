#!/usr/bin/env python3
"""Local server for daisy.

Like `python3 -m http.server`, with one twist so the browser can never run stale code: the page
is served with its code under a versioned path (/v/<version>/src/...), where the version changes
whenever any source file changes. New version -> new URLs -> the browser has to fetch them fresh,
whatever it cached before (ES modules otherwise happily come out of the HTTP cache).

It's also the hand-off between daisy and a Claude chat (see .claude/skills/solo): daisy posts the
loop to jam/loop.json, Claude writes jam/solo.json, and daisy asks every second whether a newer
solo has arrived.

    python3 tools/serve.py [port] [jam folder]
"""
import functools
import http.server
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
JAM = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'jam')


def version():
    newest = 0
    for folder, _, files in os.walk(os.path.join(ROOT, 'src')):
        for f in files:
            newest = max(newest, os.path.getmtime(os.path.join(folder, f)))
    return str(int(newest))


class Handler(http.server.SimpleHTTPRequestHandler):
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
        path, _, query = self.path.partition('?')
        if path in ('/', '/index.html'):
            with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
                html = f.read().replace('"src/', f'"v/{version()}/src/')
            return self.reply(200, html.encode(), 'text/html; charset=utf-8')
        if path == '/jam/solo':
            return self.solo(query)
        self.path = re.sub(r'^/v/[^/]+/', '/', self.path)
        super().do_GET()

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
        if self.path != '/jam/loop':
            return self.reply(404)
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        try:
            loop = json.loads(body)
        except ValueError:
            return self.reply(400)
        os.makedirs(JAM, exist_ok=True)
        tmp = os.path.join(JAM, 'loop.json.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(loop, f)
        os.replace(tmp, os.path.join(JAM, 'loop.json'))
        self.reply(204)

    def log_message(self, *args):
        pass


handler = functools.partial(Handler, directory=ROOT)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
