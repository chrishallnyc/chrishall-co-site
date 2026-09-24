"""Exercise the local author's actual HTTP boundary; no browser or API calls."""
import http.client
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest


class AuthoringServerSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.tmp.name) / 'output'
        cls.outside = Path(cls.tmp.name) / 'outside'
        cls.output.mkdir()
        cls.outside.mkdir()
        (cls.outside / 'secret.txt').write_text('OUTSIDE_TEST_SENTINEL')
        (cls.output / 'link').symlink_to(cls.outside, target_is_directory=True)
        (cls.output / 'writer').mkdir()
        (cls.output / 'writer/raw').symlink_to(cls.outside, target_is_directory=True)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            cls.port = probe.getsockname()[1]
        cls.server = subprocess.Popen([
            sys.executable, str(Path(__file__).with_name('server.py')),
            '--port', str(cls.port), '--output', str(cls.output),
        ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        # The server prints only after binding successfully.
        line = cls.server.stdout.readline()
        if not line.startswith('Audio authoring:'):
            cls.server.terminate()
            raise RuntimeError(f'Authoring server failed to start: {line}')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)
        cls.server.stdout.close()
        cls.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_foreign_origin_cannot_write_a_capture(self):
        status, _ = self.request('POST', '/capture/foreign/manifest.json', b'{}',
                                 {'Origin': 'https://untrusted.example', 'Content-Type': 'text/plain'})
        self.assertEqual(status, 403)
        self.assertFalse((self.output / 'foreign/raw/manifest.json').exists())

    def test_foreign_host_cannot_read_local_authoring_data(self):
        status, _ = self.request('GET', '/__baseline.js', headers={'Host': 'untrusted.example'})
        self.assertEqual(status, 403)

    def test_encoded_symlink_cannot_escape_review_root(self):
        status, body = self.request('GET', '/review/%6cink/secret.txt')
        self.assertEqual(status, 403)
        self.assertNotIn(b'OUTSIDE_TEST_SENTINEL', body)

    def test_capture_cannot_write_through_an_escaping_symlink(self):
        status, _ = self.request('POST', '/capture/writer/overwrite.json', b'{}')
        self.assertEqual(status, 403)
        self.assertFalse((self.outside / 'overwrite.json').exists())

    def test_local_capture_and_static_reads_still_work(self):
        payload = b'{"capture": "local"}'
        status, body = self.request('POST', '/capture/good/manifest.json', payload,
                                    {'Origin': f'http://127.0.0.1:{self.port}', 'Content-Type': 'application/json'})
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body)['bytes'], len(payload))
        status, body = self.request('GET', '/review/good/raw/manifest.json')
        self.assertEqual((status, body), (200, payload))
        self.assertEqual(self.request('GET', '/__baseline.js')[0], 200)
        self.assertEqual(self.request('GET', '/src/engine/audio.js')[0], 200)


if __name__ == '__main__':
    unittest.main()
