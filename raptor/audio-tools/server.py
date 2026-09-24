#!/usr/bin/env python3
"""Local-only audio authoring server: static modules plus bounded WAV capture."""
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re

RAPTOR = Path(__file__).resolve().parents[1]
REPO = RAPTOR.parent


def baseline_module(path):
    source = path.read_text()
    substitutions = {
        'from "./rng.js"': 'from "/src/engine/rng.js"',
        'constructor({ seed = 1337 } = {})': 'constructor({ seed = 1337, context = null } = {})',
        'this.ctx = new Ctx();': 'this.ctx = context || new Ctx();',
        'this._armGestureResume();': 'if (!context) this._armGestureResume();',
        'function makeRoundBuffer(ctx, rate) {': 'function makeRoundBuffer(ctx, rate) {\n  const captureRng = new SfcRng(6102);',
        'Math.random()': 'captureRng.f()',
    }
    for old, new in substitutions.items():
        if old not in source:
            raise ValueError(f'Baseline adapter expected source fragment: {old}')
        source = source.replace(old, new)
    return source.encode()


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5181)
    parser.add_argument('--output', type=Path, default=REPO / '.context/audio-review')
    parser.add_argument('--baseline', type=Path, default=RAPTOR / 'audio-tools/baselines/original-audio.js')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    baseline = baseline_module(args.baseline)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(RAPTOR), **kw)

        def local_hosts(self):
            return {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

        def parse_request(self):
            if not super().parse_request():
                return False
            # A loopback bind alone does not reject DNS-rebinding requests.
            hosts = self.headers.get_all('Host', [])
            if len(hosts) != 1 or hosts[0].lower() not in self.local_hosts():
                self.send_error(403, 'Use the local authoring server address')
                return False
            return True

        def translate_path(self, path):
            # The base handler decodes URL escapes and removes dot segments.
            # Check the final filesystem path too: it otherwise follows symlinks.
            requested = Path(super().translate_path(path)).resolve()
            if not requested.is_relative_to(Path(self.directory).resolve()):
                raise PermissionError('Path leaves the served directory')
            return str(requested)

        def send_head(self):
            try:
                return super().send_head()
            except (PermissionError, ValueError):
                self.send_error(403, 'Path leaves the served directory')
                return None

        def do_GET(self):
            if self.path.split('?')[0] == '/__baseline.js':
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(baseline)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(baseline)
                return
            if self.path.startswith('/review/'):
                # Generated listening artifacts remain outside shipped assets.
                requested = (output / self.path[8:].split('?')[0]).resolve()
                if not requested.is_relative_to(output):
                    self.send_error(403)
                    return
                self.path = '/' + str(requested.relative_to(output))
                previous = self.directory
                self.directory = str(output)
                try:
                    super().do_GET()
                finally:
                    self.directory = previous
                return
            super().do_GET()

        def do_POST(self):
            origin = self.headers.get('Origin')
            if (origin is not None and origin not in {f'http://{host}' for host in self.local_hosts()}) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                # CORS response headers do not stop a simple cross-origin POST
                # from writing files. CLI clients may omit Origin entirely.
                self.send_error(403, 'Captures must come from the local authoring page')
                return
            match = re.fullmatch(r'/capture/([a-zA-Z0-9_-]+)/([a-zA-Z0-9_.-]+\.(?:wav|json))', self.path)
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            if not match or not 0 < size <= 64 * 1024 * 1024:
                self.send_error(400, 'Expected a bounded named WAV or JSON capture')
                return
            batch, filename = match.groups()
            destination = (output / batch / 'raw' / filename).resolve()
            if not destination.is_relative_to(output):
                self.send_error(403, 'Capture path leaves the output directory')
                return
            destination.parent.mkdir(parents=True, exist_ok=True)
            contents = self.rfile.read(size)
            if len(contents) != size:
                self.send_error(400, 'Incomplete upload')
                return
            if filename.endswith('.json'):
                try:
                    json.loads(contents)
                except ValueError:
                    self.send_error(400, 'Not a JSON document')
                    return
            elif contents[:4] != b'RIFF' or contents[8:12] != b'WAVE':
                self.send_error(400, 'Not a WAV file')
                return
            destination.write_bytes(contents)
            body = json.dumps({'saved': str(destination.relative_to(output)), 'bytes': size}).encode()
            self.send_response(201)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Audio authoring: http://127.0.0.1:{args.port}/audio-tools/render.html', flush=True)
    print(f'Capture output: {output}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
