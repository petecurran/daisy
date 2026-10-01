#!/usr/bin/env python3
"""Local server for daisy.

Like `python3 -m http.server`, with one twist so the browser can never run stale code: the page
is served with its code under a versioned path (/v/<version>/src/...), where the version changes
whenever any source file changes. New version -> new URLs -> the browser has to fetch them fresh,
whatever it cached before (ES modules otherwise happily come out of the HTTP cache).
"""
import functools
import http.server
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


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

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/', '/index.html'):
            with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
                html = f.read().replace('"src/', f'"v/{version()}/src/')
            body = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.path = re.sub(r'^/v/[^/]+/', '/', self.path)
        super().do_GET()

    def log_message(self, *args):
        pass


handler = functools.partial(Handler, directory=ROOT)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
