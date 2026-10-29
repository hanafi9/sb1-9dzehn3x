"""Reconnaissance de la voix (voice/speaker_id.py) avec un faux extracteur d'empreinte."""

import os
import sys
import tempfile
import types
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import numpy as np
    from speaker_id import VoiceIdentifier
except ImportError:  # pragma: no cover
    np = None


class FakeExtractor:
    """« Empreinte » = spectre grossier du son : deux hauteurs de voix différentes donnent deux empreintes."""

    def create_stream(self):
        stream = types.SimpleNamespace(audio=None)
        stream.accept_waveform = lambda sample_rate, waveform: setattr(stream, "audio", waveform)
        stream.input_finished = lambda: None
        return stream

    def is_ready(self, stream):
        return stream.audio is not None

    def compute(self, stream):
        spectrum = np.abs(np.fft.rfft(stream.audio))[:2000]
        return [float(b.sum()) for b in np.array_split(spectrum, 64)]


def voice(freq, seconds=2.0, seed=0):
    t = np.arange(int(16000 * seconds)) / 16000.0
    noise = np.random.RandomState(seed).randn(len(t)) * 0.05
    return (0.5 * np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(4 * np.pi * freq * t) + noise).astype(np.float32)


@unittest.skipIf(np is None, "numpy absent")
class SpeakerIdTest(unittest.TestCase):
    def setUp(self):
        self.db = os.path.join(tempfile.mkdtemp(), "voices.json")
        self.ident = VoiceIdentifier(FakeExtractor(), self.db, threshold=0.8)

    def test_enroll_then_recognize(self):
        self.assertEqual(self.ident.enroll("Sam", [voice(120, seed=i) for i in range(3)]), 3)
        self.ident.enroll("Rachida", [voice(230, seed=i) for i in range(3)])
        self.assertEqual(self.ident.identify(voice(121, seed=9))[0], "Sam")
        self.assertEqual(self.ident.identify(voice(232, seed=9))[0], "Rachida")
        name, score = self.ident.identify(voice(600, seed=9))       # voix inconnue
        self.assertIsNone(name)
        self.assertLess(score, 0.8)

    def test_saved_and_reloaded(self):
        self.ident.enroll("Sam", [voice(120)])
        again = VoiceIdentifier(FakeExtractor(), self.db, threshold=0.8)
        self.assertEqual(again.names(), ["Sam"])
        self.assertTrue(again.forget("Sam"))
        self.assertEqual(VoiceIdentifier(FakeExtractor(), self.db).names(), [])

    def test_too_short_or_empty(self):
        self.assertEqual(self.ident.identify(voice(120, seconds=0.5)), (None, None))
        self.assertEqual(self.ident.enroll("Sam", [voice(120, seconds=0.3)]), 0)
        with self.assertRaises(ValueError):
            self.ident.enroll("  ", [voice(120)])


if __name__ == "__main__":
    unittest.main()
