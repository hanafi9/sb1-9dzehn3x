"""Reconnaissance vocale en ligne (format audio/transcriptions de Groq / OpenAI), faux serveur local."""

import email.parser
import io
import json
import os
import sys
import threading
import types
import unittest
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import numpy as np
    from cloud_stt import CloudError, CloudTranscriber
except ImportError:  # pragma: no cover
    np = None


class FakeSTT(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        msg = email.parser.BytesParser().parsebytes(
            b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + raw)
        parts = {p.get_param("name", header="content-disposition"): p.get_payload(decode=True)
                 for p in msg.get_payload()}
        FakeSTT.seen.append((self.path, self.headers["Authorization"], parts))
        if "Python-urllib" in self.headers.get("User-Agent", ""):     # comme Cloudflare devant Groq
            self.send_response(403)
            self.send_header("Content-Length", "16")
            self.end_headers()
            self.wfile.write(b"error code: 1010")
            return
        with wave.open(io.BytesIO(parts["file"])) as w:
            ok = w.getframerate() == 16000 and w.getnchannels() == 1
        out = json.dumps({"text": " Kamil, quelle heure est-il ? " if ok else "?"}).encode()
        self.send_response(200 if self.headers["Authorization"] == "Bearer cle" else 401)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


@unittest.skipIf(np is None, "numpy absent")
class CloudSTTTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeSTT)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.cfg = {"provider": "groq", "base_url": "http://127.0.0.1:%d/openai/v1" % cls.server.server_port,
                   "api_key_env": "TEST_STT_KEY", "language": "fr"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_transcribe(self):
        os.environ["TEST_STT_KEY"] = "cle"
        text = CloudTranscriber(self.cfg).transcribe(np.zeros(16000, dtype=np.float32))
        self.assertEqual(text, "Kamil, quelle heure est-il ?")
        path, auth, parts = FakeSTT.seen[-1]
        self.assertEqual(path, "/openai/v1/audio/transcriptions")
        self.assertEqual(parts["model"], b"whisper-large-v3-turbo")     # modèle Groq par défaut
        self.assertEqual(parts["language"], b"fr")

    def test_errors(self):
        os.environ["TEST_STT_KEY"] = "mauvaise"
        with self.assertRaises(CloudError):
            CloudTranscriber(self.cfg).transcribe(np.zeros(16000, dtype=np.float32))
        os.environ.pop("TEST_STT_KEY")
        with self.assertRaises(CloudError):                              # clé absente
            CloudTranscriber(self.cfg).transcribe(np.zeros(16000, dtype=np.float32))
        os.environ["TEST_STT_KEY"] = "cle"
        bad = dict(self.cfg, base_url="http://127.0.0.1:9/v1", timeout_s=1)
        with self.assertRaises(CloudError):                              # pas d'Internet
            CloudTranscriber(bad).transcribe(np.zeros(16000, dtype=np.float32))

    def test_listener_falls_back_to_local_whisper(self):
        for name in ("sounddevice", "webrtcvad", "faster_whisper"):
            sys.modules.setdefault(name, types.ModuleType(name))
        sys.modules["faster_whisper"].WhisperModel = object
        import speech_listener
        lst = object.__new__(speech_listener.Listener)
        lst.cfg = {"language": "fr", "beam_size": 1, "max_no_speech_prob": 0.6, "min_avg_logprob": -1.0,
                   "wake_words": []}
        lst.awake_until, lst.fallback_model = 0.0, None
        seg = types.SimpleNamespace(text="texte du Pi", avg_logprob=-0.2, no_speech_prob=0.0)
        lst.model = types.SimpleNamespace(transcribe=lambda audio, **kw: ([seg], None))
        os.environ["TEST_STT_KEY"] = "cle"
        lst.cloud = CloudTranscriber(self.cfg)
        pcm = (np.ones(16000, dtype=np.int16) * 2000).tobytes()
        self.assertEqual(lst.transcribe(pcm), "Kamil, quelle heure est-il ?")    # en ligne
        lst.cloud = CloudTranscriber(dict(self.cfg, base_url="http://127.0.0.1:9/v1", timeout_s=1))
        self.assertEqual(lst.transcribe(pcm), "texte du Pi")                      # secours local

    def test_save_quota_sends_only_phrases_for_kamil(self):
        for name in ("sounddevice", "webrtcvad", "faster_whisper"):
            sys.modules.setdefault(name, types.ModuleType(name))
        sys.modules["faster_whisper"].WhisperModel = object
        import speech_listener
        lst = object.__new__(speech_listener.Listener)
        lst.cfg = {"language": "fr", "beam_size": 3, "max_no_speech_prob": 0.6, "min_avg_logprob": -1.0,
                   "wake_words": ["kamil", "camille"], "cloud_stt": {"save_quota": True}}
        lst.awake_until, lst.fallback_model = 0.0, None
        heard, beams = ["les informations de midi, la météo"], []
        lst.model = types.SimpleNamespace(transcribe=lambda audio, **kw: beams.append(kw["beam_size"]) or (
            [types.SimpleNamespace(text=heard[0], avg_logprob=-0.2, no_speech_prob=0.0)], None))
        sent = []
        lst.cloud = types.SimpleNamespace(transcribe=lambda audio: sent.append(1) or "Kamil, quelle heure est-il ?")
        pcm = (np.ones(16000, dtype=np.int16) * 2000).tobytes()
        self.assertEqual(lst.transcribe(pcm), "les informations de midi, la météo")   # télé : reste sur le Pi
        self.assertEqual(sent, [])
        self.assertEqual(beams, [1])                    # simple repérage de « Kamil » : recherche rapide
        heard[0] = "Camille, quelle heure il est"
        self.assertEqual(lst.transcribe(pcm), "Kamil, quelle heure est-il ?")         # pour Kamil : en ligne
        # petit modèle de repérage : il sert à trouver « Kamil », jamais à répondre si Groq est en panne
        used = []
        lst.screen_model = types.SimpleNamespace(transcribe=lambda audio, **kw: used.append("tiny") or (
            [types.SimpleNamespace(text="Camille, quel heure", avg_logprob=-0.2, no_speech_prob=0.0)], None))
        from cloud_stt import CloudError

        def down(audio):
            raise CloudError("hors ligne")
        lst.cloud, keep = types.SimpleNamespace(transcribe=down), lst.cloud
        self.assertEqual(lst.transcribe(pcm), "Camille, quelle heure il est")          # texte du modèle principal
        self.assertEqual(used, ["tiny"])
        lst.cloud, lst.screen_model = keep, None
        heard[0] = "et la suite"
        lst.awake_until = speech_listener.time.monotonic() + 10                        # conversation en cours
        lst.transcribe(pcm)
        self.assertEqual(len(sent), 2)


if __name__ == "__main__":
    unittest.main()
