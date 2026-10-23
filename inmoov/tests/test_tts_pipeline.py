"""File de parole Piper : ordre conservé, phrase suivante fabriquée pendant la lecture."""

import os
import sys
import threading
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from tts_piper import SpeechPipeline  # noqa: E402


class FakeSpeaker:
    def __init__(self, fail=()):
        self.log = []
        self.fail = set(fail)
        self.lock = threading.Lock()

    def synthesize(self, text):
        if text in self.fail:
            raise RuntimeError("voix cassée")
        with self.lock:
            self.log.append(("fabrique", text))
        return "/tmp/" + text, 0.05

    def play(self, path, duration):
        time.sleep(duration)
        with self.lock:
            self.log.append(("joue", path[5:]))


class PipelineTest(unittest.TestCase):
    def test_order_and_overlap(self):
        sp = FakeSpeaker()
        p = SpeechPipeline(sp)
        for t in ("un", "deux", "trois"):
            p.put(t)
        self.assertTrue(p.wait(5))
        played = [t for k, t in sp.log if k == "joue"]
        self.assertEqual(played, ["un", "deux", "trois"])
        # « deux » est fabriqué avant la fin de la lecture de « un »
        self.assertLess(sp.log.index(("fabrique", "deux")), sp.log.index(("joue", "un")))

    def test_fallback_when_piper_fails(self):
        said = []
        p = SpeechPipeline(FakeSpeaker(fail={"cassé"}), fallback=said.append)
        p.put("cassé")
        p.put("  ")   # ignoré
        self.assertTrue(p.wait(5))
        self.assertEqual(said, ["cassé"])


if __name__ == "__main__":
    unittest.main()
