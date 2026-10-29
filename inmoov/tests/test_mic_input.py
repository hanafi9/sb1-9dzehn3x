"""Micro 48 kHz / stéréo (Polycom…) converti en 16 kHz mono pour Kamil (voice/mic_input.py)."""

import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import numpy as np
    from mic_input import Resampler, open_mic
except ImportError:      # numpy absent
    np = None


def tone(freq, rate, seconds, channels=1, amp=10000):
    t = np.arange(int(rate * seconds)) / rate
    x = (amp * np.sin(2 * np.pi * freq * t)).astype(np.int16)
    return np.repeat(x, channels).tobytes()


def freq_of(x, rate):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return np.argmax(spec) * rate / len(x)


@unittest.skipIf(np is None, "numpy absent")
class ResamplerTest(unittest.TestCase):
    def test_48k_stereo_to_16k_mono_in_small_blocks(self):
        data = tone(440, 48000, 1.0, channels=2)
        r = Resampler(48000, 16000, channels=2)
        block = 1440 * 2 * 2                                   # 30 ms stéréo int16
        out = b"".join(r.process(data[i:i + block]) for i in range(0, len(data), block))
        y = np.frombuffer(out, dtype=np.int16).astype(float)
        self.assertLess(abs(len(y) - 16000), 4)
        self.assertAlmostEqual(freq_of(y[1000:], 16000), 440, delta=3)
        self.assertAlmostEqual(np.abs(y[1000:]).max(), 10000, delta=600)
        whole = np.frombuffer(Resampler(48000, 16000, channels=2).process(data), dtype=np.int16).astype(float)
        n = min(len(whole), len(y)) - 2
        self.assertLessEqual(np.abs(whole[:n] - y[:n]).max(), 1)  # par blocs = d'un coup : pas de clic

    def test_high_pitch_filtered_out(self):
        r = Resampler(48000, 16000)
        y = np.frombuffer(r.process(tone(12000, 48000, 0.5)), dtype=np.int16)
        self.assertLess(np.abs(y[200:]).max(), 600)           # 12 kHz ne se replie pas en 4 kHz

    def test_open_mic_falls_back_to_native_rate(self):
        class PortAudioError(Exception):
            pass

        opened = []

        class Stream:
            def __init__(self, samplerate, blocksize, dtype, channels, device, callback):
                if samplerate != 48000 or channels != 2:
                    raise PortAudioError("Invalid sample rate")
                opened.append((samplerate, blocksize, channels))
                self.callback = callback

        fake_sd = type("sd", (), {"PortAudioError": PortAudioError, "RawInputStream": Stream,
                                  "query_devices": staticmethod(lambda d, kind: {
                                      "name": "Polycom Communicator", "default_samplerate": 48000.0,
                                      "max_input_channels": 2})})
        frames = []
        stream = open_mic(fake_sd, "Polycom", lambda f, n, t, s: frames.append(f), 16000, 480)
        self.assertEqual(opened, [(48000, 1440, 2)])
        data = tone(300, 48000, 0.3, channels=2)
        for i in range(0, len(data), 1440 * 4):
            stream.callback(data[i:i + 1440 * 4], 1440, None, None)
        self.assertGreaterEqual(len(frames), 8)
        self.assertTrue(all(len(f) == 960 for f in frames))   # trames de 30 ms à 16 kHz, comme avant


class PlayerCommandTest(unittest.TestCase):
    def test_output_device(self):
        try:
            from speech_listener import player_command
        except ImportError:
            self.skipTest("speech_listener indisponible")
        self.assertEqual(player_command(None), ("aplay", "-q"))
        self.assertEqual(player_command("Communicator"), ("aplay", "-q", "-D", "plughw:CARD=Communicator,DEV=0"))
        self.assertEqual(player_command("plughw:2,0"), ("aplay", "-q", "-D", "plughw:2,0"))


@unittest.skipIf(np is None, "numpy absent")
class LouderTest(unittest.TestCase):
    def test_louder_without_clipping(self):
        import tempfile
        import wave
        from tts_piper import louder
        path = tempfile.mktemp(suffix=".wav")
        with wave.open(path, "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(22050)
            w.writeframes(tone(300, 22050, 0.5, amp=6000))
        louder(path, 3)
        with wave.open(path, "rb") as w:
            y = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
        os.remove(path)
        self.assertEqual(len(y), 11025)
        self.assertGreater(np.abs(y).mean(), 2.5 * 6000 * 0.637)      # bien plus fort en moyenne
        self.assertLessEqual(np.abs(y).max(), 32767 * 0.98)            # sans saturer


if __name__ == "__main__":
    unittest.main()
