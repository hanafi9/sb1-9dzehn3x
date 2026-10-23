"""Voix en ligne (format /audio/speech d'OpenAI), faux serveur local, Piper en secours."""

import json
import os
import sys
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import numpy  # noqa: F401  (cloud_stt en a besoin)
    from tts_cloud import CloudSpeaker
except ImportError:  # pragma: no cover
    CloudSpeaker = None


class FakeTTS(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeTTS.seen.append((self.path, body))
        pcm = b"\x01\x00" * 24000          # 1 s à 24 kHz
        self.send_response(200)
        self.send_header("Content-Length", str(len(pcm)))
        self.end_headers()
        self.wfile.write(pcm)


class FakePiper:
    def __init__(self):
        self.said = []

    def synthesize(self, text):
        self.said.append(text)
        return "/tmp/piper.wav", 0.5


@unittest.skipIf(CloudSpeaker is None, "numpy absent")
class CloudTTSTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeTTS)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.cfg = {"base_url": "http://127.0.0.1:%d/v1" % cls.server.server_port, "api_key_env": "TEST_TTS_KEY"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_mature_voice_and_wav(self):
        os.environ["TEST_TTS_KEY"] = "cle"
        sp = CloudSpeaker(self.cfg)
        path, duration = sp.synthesize("Bonjour, je suis Kamil.")
        self.assertAlmostEqual(duration, 1.0)
        with wave.open(path) as w:
            self.assertEqual((w.getframerate(), w.getnchannels(), w.getnframes()), (24000, 1, 24000))
        os.remove(path)
        route, body = FakeTTS.seen[-1]
        self.assertEqual(route, "/v1/audio/speech")
        self.assertEqual((body["model"], body["voice"], body["response_format"]), ("gpt-4o-mini-tts", "onyx", "pcm"))
        self.assertIn("mûr", body["instructions"])
        n = len(FakeTTS.seen)
        os.remove(sp.synthesize("Bonjour, je suis Kamil.")[0])       # phrase courte : gardée en mémoire
        self.assertEqual(len(FakeTTS.seen), n)

    def test_piper_takes_over_without_network_or_key(self):
        piper = FakePiper()
        os.environ["TEST_TTS_KEY"] = "cle"
        sp = CloudSpeaker(dict(self.cfg, base_url="http://127.0.0.1:9/v1", timeout_s=1), fallback=piper)
        self.assertEqual(sp.synthesize("Coucou"), ("/tmp/piper.wav", 0.5))
        os.environ.pop("TEST_TTS_KEY")
        self.assertEqual(CloudSpeaker(self.cfg, fallback=piper).synthesize("Salut"), ("/tmp/piper.wav", 0.5))
        self.assertEqual(piper.said, ["Coucou", "Salut"])


if __name__ == "__main__":
    unittest.main()
