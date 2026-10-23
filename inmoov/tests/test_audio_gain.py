"""Amplification d'un micro trop faible."""

import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import numpy as np
    from audio_gain import amplify_pcm16, normalize_peak
except ImportError:  # pragma: no cover
    np = None


@unittest.skipIf(np is None, "numpy absent")
class GainTest(unittest.TestCase):
    def test_amplify_clips_instead_of_wrapping(self):
        frame = np.array([100, -100, 20000, -20000], dtype=np.int16).tobytes()
        out = np.frombuffer(amplify_pcm16(frame, 5), dtype=np.int16)
        self.assertEqual(out.tolist(), [500, -500, 32767, -32768])
        self.assertIs(amplify_pcm16(frame, 1), frame)

    def test_normalize_quiet_phrase(self):
        quiet = np.array([0.0, 0.02, -0.03], dtype=np.float32)      # micro à 3 %
        out = normalize_peak(quiet)
        self.assertAlmostEqual(float(np.abs(out).max()), 0.6, places=5)  # limité à ×20
        loud = np.array([0.0, 0.9], dtype=np.float32)
        self.assertIs(normalize_peak(loud), loud)                   # déjà assez fort : inchangé
        self.assertEqual(len(normalize_peak(np.array([], dtype=np.float32))), 0)


if __name__ == "__main__":
    unittest.main()
