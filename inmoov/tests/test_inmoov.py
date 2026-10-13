"""Tests sans matériel (ni Coral, ni micro, ni MyRobotLab) :

    cd inmoov && python -m unittest discover -s tests -v
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "vision"), os.path.join(ROOT, "voice")]

from mrl_client import AsyncMrlClient, MrlClient, load_config  # noqa: E402
from segmenter import UtteranceSegmenter  # noqa: E402
from text_utils import is_hallucination, match_command, normalize, strip_wake_word  # noqa: E402
from tracking import AxisController, normalized_error, pick_target  # noqa: E402

AXIS = {"min": 30, "max": 150, "rest": 90, "gain": 12.0, "deadband": 0.08, "max_step": 4.0, "invert": False}


class TrackingTest(unittest.TestCase):
    def test_deadband_keeps_position(self):
        a = AxisController(AXIS)
        self.assertEqual(a.update(0.05), 90)

    def test_step_is_limited_and_signed(self):
        a = AxisController(AXIS)
        self.assertEqual(a.update(1.0), 94)
        b = AxisController(dict(AXIS, invert=True))
        self.assertEqual(b.update(1.0), 86)

    def test_clamped_to_limits(self):
        a = AxisController(AXIS)
        for _ in range(100):
            a.update(1.0)
        self.assertEqual(a.position, 150)

    def test_return_to_rest(self):
        a = AxisController(AXIS)
        a.position = 100
        for _ in range(10):
            a.toward_rest()
        self.assertEqual(a.position, 90)

    def test_pick_largest_face_and_error(self):
        small = (0, 0, 10, 10, 0.9)
        big = (480, 240, 640, 480, 0.7)
        self.assertEqual(pick_target([small, big]), big)
        self.assertIsNone(pick_target([]))
        ex, ey = normalized_error(big, 640, 480)
        self.assertAlmostEqual(ex, 0.75)
        self.assertAlmostEqual(ey, 0.5)


class SegmenterTest(unittest.TestCase):
    def feed(self, seg, pattern):
        out = []
        for i, speech in enumerate(pattern):
            r = seg.push(bytes([i % 256]) * 960, speech)
            if r is not None:
                out.append(r)
        return out

    def test_detects_one_utterance(self):
        seg = UtteranceSegmenter(padding_ms=300, end_silence_ms=600, min_utterance_ms=300)
        pattern = [False] * 20 + [True] * 40 + [False] * 30
        out = self.feed(seg, pattern)
        self.assertEqual(len(out), 1)
        # déclenché après 6 trames de parole : pré-roll de 10 trames (4 silence + 6 parole),
        # puis les 34 trames de parole restantes, puis 20 trames de silence de fin
        self.assertEqual(len(out[0]) // 960, 10 + 34 + 20)

    def test_ignores_short_noise(self):
        seg = UtteranceSegmenter(padding_ms=150, end_silence_ms=300, min_utterance_ms=600)
        out = self.feed(seg, [False] * 10 + [True] * 6 + [False] * 30)
        self.assertEqual(out, [])

    def test_max_length_cuts(self):
        seg = UtteranceSegmenter(padding_ms=300, max_utterance_s=1.5, min_utterance_ms=300)
        out = self.feed(seg, [True] * 200)
        self.assertGreaterEqual(len(out), 3)
        self.assertTrue(all(len(o) // 960 == 50 for o in out))


class TextTest(unittest.TestCase):
    COMMANDS = {
        "regarde à gauche": [["i01.head.rothead", "moveTo", 140]],
        "ouvre la main droite": [["i01.rightHand", "open"]],
        "ferme la main droite": [["i01.rightHand", "close"]],
    }

    def test_normalize(self):
        self.assertEqual(normalize("  Régarde, à GAUCHE ! "), "regarde a gauche")

    def test_wake_word_variants(self):
        for heard in ["InMoov, regarde à gauche", "In Moov regarde à gauche", "Inmove regarde à gauche",
                      "Hé robot, regarde à gauche"]:
            found, rest = strip_wake_word(heard, ["inmoov", "robot"])
            self.assertTrue(found, heard)
            self.assertEqual(rest, "regarde à gauche", heard)
        self.assertFalse(strip_wake_word("il fait beau aujourd'hui", ["inmoov", "robot"])[0])

    def test_wake_word_alone(self):
        self.assertEqual(strip_wake_word("InMoov ?", ["inmoov"]), (True, ""))

    def test_commands(self):
        self.assertEqual(match_command("regarde a gauche s'il te plait", self.COMMANDS)[0], "regarde à gauche")
        self.assertEqual(match_command("ferme la main droite", self.COMMANDS)[0], "ferme la main droite")
        self.assertEqual(match_command("ouvre la main droit", self.COMMANDS)[0], "ouvre la main droite")
        self.assertEqual(match_command("quelle heure est-il", self.COMMANDS), (None, None))

    def test_hallucinations(self):
        self.assertTrue(is_hallucination("Sous-titres réalisés par la communauté d'Amara.org"))
        self.assertTrue(is_hallucination(" ... "))
        self.assertFalse(is_hallucination("Merci"))
        self.assertFalse(is_hallucination("bonjour InMoov"))


class FakeMrl(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeMrl.calls.append((self.path, body))
        reply = {"msg": "Bonjour !"} if self.path.endswith("/getResponse") else None
        data = json.dumps(reply).encode() if reply else b""
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


class MrlClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeMrl)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeMrl.calls.clear()

    def test_call_format(self):
        c = MrlClient(self.url)
        self.assertIsNone(c.call("i01.head.neck", "moveTo", 92.5))
        self.assertEqual(c.call("i01.chatBot", "getResponse", "bonjour"), {"msg": "Bonjour !"})
        self.assertEqual(FakeMrl.calls, [
            ("/api/service/i01.head.neck/moveTo", [92.5]),
            ("/api/service/i01.chatBot/getResponse", ["bonjour"]),
        ])

    def test_async_send(self):
        c = AsyncMrlClient(self.url)
        c.send("i01.head.rothead", "moveTo", 100.0)
        for _ in range(50):
            if FakeMrl.calls:
                break
            threading.Event().wait(0.05)
        self.assertEqual(FakeMrl.calls, [("/api/service/i01.head.rothead/moveTo", [100.0])])

    def test_unreachable_returns_none(self):
        self.assertIsNone(MrlClient("http://127.0.0.1:1", timeout=0.5).call("x", "y"))


class ConfigTest(unittest.TestCase):
    def test_example_config_is_valid(self):
        cfg = load_config(os.path.join(ROOT, "config.example.json"))
        for key in ("mrl", "vision", "voice"):
            self.assertIn(key, cfg)
        for actions in cfg["voice"]["commands"].values():
            for a in actions:
                self.assertGreaterEqual(len(a), 2)


if __name__ == "__main__":
    unittest.main()
