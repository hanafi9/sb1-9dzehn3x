"""File de parole Piper : ordre conservé, phrase suivante fabriquée pendant la lecture."""

import os
import sys
import threading
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from tts_piper import PiperSpeaker, SpeechPipeline  # noqa: E402


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

    def test_audio_hook_before_playing(self):
        sp = FakeSpeaker()
        p = SpeechPipeline(sp)
        seen = []
        p.on_audio = lambda path, duration: seen.append((path, duration, list(sp.log)))
        p.put("un")
        self.assertTrue(p.wait(5))
        self.assertEqual(seen, [("/tmp/un", 0.05, [("fabrique", "un")])])   # juste avant de jouer
        ends = []
        p.on_idle = lambda: ends.append(len([1 for k, _ in sp.log if k == "joue"]))
        p.put("a")
        p.put("b")
        self.assertTrue(p.wait(5))
        time.sleep(0.05)
        self.assertEqual(ends[-1], 3)                   # appelé quand la dernière phrase a sonné
        p.on_audio = lambda path, duration: 1 / 0     # une bouche en panne ne coupe pas la voix
        p.put("deux")
        self.assertTrue(p.wait(5))
        self.assertIn(("joue", "deux"), sp.log)

    def test_fallback_when_piper_fails(self):
        said = []
        p = SpeechPipeline(FakeSpeaker(fail={"cassé"}), fallback=said.append)
        p.put("cassé")
        p.put("  ")   # ignoré
        self.assertTrue(p.wait(5))
        self.assertEqual(said, ["cassé"])


class FakeVoice:
    def __init__(self):
        self.calls = 0

    def synthesize_wav(self, text, wav, syn_config=None):
        self.calls += 1
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"\x00\x00" * 2205 * len(text))   # 0,1 s par caractère


class CacheTest(unittest.TestCase):
    def speaker(self):
        sp = object.__new__(PiperSpeaker)
        sp.voice, sp.syn_config, sp.lock, sp.cache = FakeVoice(), None, threading.Lock(), {}
        return sp

    def test_short_phrases_are_made_once(self):
        sp = self.speaker()
        for _ in range(3):
            path, duration = sp.synthesize("Présent !")
            self.assertAlmostEqual(duration, 0.9)
            os.remove(path)
        self.assertEqual(sp.voice.calls, 1)              # fabriquée une seule fois
        long_text = "Il était une fois un robot qui rêvait d'apprendre à danser la valse avec sa créatrice."
        for _ in range(2):
            os.remove(sp.synthesize(long_text)[0])
        self.assertEqual(sp.voice.calls, 3)              # phrase longue : pas gardée

    def test_warm_up(self):
        sp = self.speaker()
        sp.warm_up(["Oui ?", "Hmm ?"])
        for _ in range(50):
            if len(sp.cache) == 2:
                break
            time.sleep(0.02)
        self.assertEqual(set(sp.cache), {"Oui ?", "Hmm ?"})


if __name__ == "__main__":
    unittest.main()
