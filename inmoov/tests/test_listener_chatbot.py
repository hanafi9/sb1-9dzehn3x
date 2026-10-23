"""Chatbot de secours d'InMoov2 : avec Piper, sa réponse doit sortir par les haut-parleurs."""

import os
import sys
import types
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

# le micro et Whisper ne sont pas utiles ici
for name in ("sounddevice", "webrtcvad", "faster_whisper"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["faster_whisper"].WhisperModel = object

try:
    import numpy  # noqa: F401
    import speech_listener
except ImportError:  # pragma: no cover
    speech_listener = None


class FakeTts:
    def __init__(self):
        self.said = []

    def speak(self, text):
        self.said.append(text)
        return 1.0


class FakeMrl:
    def __init__(self, reply="Salut human!"):
        self.calls = []
        self.reply = reply

    def call_checked(self, service, method, *params):
        self.calls.append((service, method) + params)
        return True, ({"msg": self.reply} if method == "getResponse" else None)


def listener(tts, dry_run=False, wake_words=()):
    lst = object.__new__(speech_listener.Listener)
    lst.cfg = {"wake_words": list(wake_words), "commands": {}, "fuzzy_threshold": 0.8, "chatbot_service": "i01.chatBot",
               "chatbot_method": "getResponse", "mouth_service": "i01.mouth", "seconds_per_char": 0.07,
               "wake_window_s": 8}
    lst.awake_until = lst.mute_until = 0.0
    lst.brain = lst.local = lst.leds = None
    lst.tts, lst.dry_run, lst.mrl = tts, dry_run, FakeMrl()
    return lst


@unittest.skipIf(speech_listener is None, "numpy absent")
class ChatbotTest(unittest.TestCase):
    def test_piper_speaks_chatbot_reply(self):
        tts = FakeTts()
        lst = listener(tts)
        lst.handle("bonjour")
        self.assertEqual(tts.said, ["Salut human!"])
        self.assertEqual(lst.mrl.calls, [("i01.chatBot", "getResponse", "bonjour")])

    def test_mrl_voice_left_to_chatbot(self):
        lst = listener(None)
        lst.handle("bonjour")
        self.assertEqual(lst.mrl.calls, [("i01.chatBot", "getResponse", "bonjour")])
        self.assertGreater(lst.mute_until, 0)

    def test_dry_run_is_silent(self):
        tts = FakeTts()
        lst = listener(tts, dry_run=True)
        lst.handle("bonjour")
        self.assertEqual(tts.said, [])
        self.assertEqual(lst.mrl.calls, [])

    def test_html_is_not_spoken(self):
        tts = FakeTts()
        lst = listener(tts)
        lst.mrl.reply = '<img src="img/InMoov2/brain-resize.gif"/>'
        lst.handle("tu mets du temps")
        self.assertEqual(tts.said, [])
        lst.mrl.reply = "Je r&eacute;fl&eacute;chis <b>encore</b>."
        lst.handle("tu mets du temps")
        self.assertEqual(tts.said, ["Je réfléchis encore."])

    def test_wake_word_removed_when_already_awake(self):
        tts = FakeTts()
        lst = listener(tts, wake_words=["kamil", "robot"])
        lst.handle("Kamil.")
        self.assertEqual(tts.said, ["oui ?"])
        lst.handle("Kamil, ce que tu dis est bizarre")
        self.assertEqual(lst.mrl.calls[-1], ("i01.chatBot", "getResponse", "ce que tu dis est bizarre"))
        lst.handle("bonjour")  # plus réveillé : ignoré
        self.assertEqual(len(lst.mrl.calls), 1)


if __name__ == "__main__":
    unittest.main()
