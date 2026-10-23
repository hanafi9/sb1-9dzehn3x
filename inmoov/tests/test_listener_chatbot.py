"""Chatbot de secours d'InMoov2 : avec Piper, sa réponse doit sortir par les haut-parleurs."""

import os
import sys
import time
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
    lst.brain = lst.local = lst.leds = lst.pipeline = lst.reactions = lst.voices = lst._last_audio = None
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
        self.assertEqual(len(tts.said), 1)                       # réponse courte (« Présent ! »…)
        lst.handle("Kamil, ce que tu dis est bizarre")
        self.assertEqual(lst.mrl.calls[-1], ("i01.chatBot", "getResponse", "ce que tu dis est bizarre"))
        lst.awake_until = 0.0  # fenêtre de suite écoulée
        lst.handle("bonjour")  # plus réveillé : ignoré
        self.assertEqual(len(lst.mrl.calls), 1)

    def test_wake_replies_vary(self):
        lst = listener(FakeTts())
        lst.cfg["wake_replies"] = ["Oui ?", "Présent !", "Me voilà !"]
        said = [lst._wake_reply() for _ in range(30)]
        self.assertTrue(set(said) <= {"Oui ?", "Présent !", "Me voilà !"})
        self.assertTrue(all(a != b for a, b in zip(said, said[1:])))   # jamais deux fois de suite
        lst.cfg.pop("wake_replies")
        lst.brain_cfg = {"personality": {"humour": 3}}                 # farceur
        self.assertIn(lst._wake_reply(), speech_listener.WAKE_REPLIES_FUNNY)
        lst.brain_cfg = {}
        self.assertIn(lst._wake_reply(), speech_listener.WAKE_REPLIES)

    def test_owner_only_voice_commands(self):
        tts = FakeTts()
        lst = listener(tts)
        lst.cfg["commands"] = {"lève le bras": [["i01.rightArm.shoulder", "moveTo", 120]]}
        lst.cfg["speaker_id"] = {"owner": "Hanafi", "owner_only_commands": True}
        lst._last_audio = [0.0]
        lst.voices = types.SimpleNamespace(identify=lambda audio: (None, 0.2))     # voix inconnue
        lst.handle("lève le bras")
        self.assertEqual(lst.mrl.calls, [])
        self.assertIn("Hanafi", tts.said[-1])
        lst.voices = types.SimpleNamespace(identify=lambda audio: ("Hanafi", 0.8))
        lst.handle("lève le bras")
        self.assertEqual(lst.mrl.calls, [("i01.rightArm.shoulder", "moveTo", 120)])

    def test_longer_follow_up_after_a_question(self):
        lst = listener(FakeTts())
        lst._follow_up()
        normal = lst.awake_until - time.monotonic()
        lst._follow_up(question=True)
        question = lst.awake_until - time.monotonic()
        self.assertAlmostEqual(normal, 15, delta=0.5)
        self.assertAlmostEqual(question, 25, delta=0.5)

    def test_response_delay_is_logged_by_step(self):
        lst = listener(FakeTts())
        lst.cfg["end_silence_ms"] = 700
        now = time.monotonic()
        lst.turn = {"end": now - 5.0, "whisper": 2.0, "heard": now - 3.0, "queued": now - 0.5}
        with self.assertLogs("voice", "INFO") as logs:
            lst._on_first_sound("Bonjour !")
        self.assertIn("1er son 5.0 s", logs.output[0])
        self.assertIn("Whisper 2.0 + Claude (1re phrase) 2.5 + Piper 0.5", logs.output[0])
        self.assertIsNone(lst.turn)

    def test_follow_up_without_wake_word(self):
        tts = FakeTts()
        lst = listener(tts, wake_words=["kamil"])
        lst.handle("Kamil, bonjour")
        lst.handle("je m'appelle Rachida")  # juste après la réponse : pas besoin de « Kamil »
        self.assertEqual(lst.mrl.calls[-1], ("i01.chatBot", "getResponse", "je m'appelle Rachida"))
        lst.cfg["follow_up_s"] = 0
        lst.awake_until = 0.0
        lst.handle("bonjour")
        self.assertEqual(lst.mrl.calls[-1], ("i01.chatBot", "getResponse", "je m'appelle Rachida"))
        lst.handle("Kamil, bonjour")
        self.assertEqual(lst.awake_until, 0.0)

    def test_reaction_to_camera_event(self):
        lst = listener(FakeTts(), wake_words=["kamil"])
        lst.segmenter = types.SimpleNamespace(triggered=False, reset=lambda: None)
        lst.frames = __import__("queue").Queue()
        noticed, talks = [], []
        lst.brain = types.SimpleNamespace(notice=lambda e: noticed.append(e) or "Bonjour !", ask=lambda t, **k: None)
        lst.reactions = types.SimpleNamespace(poll=lambda: ("arrivee", "Une personne vient d'apparaître."),
                                              on_conversation=lambda: talks.append(1))
        lst._maybe_react()
        self.assertEqual(noticed, ["Une personne vient d'apparaître."])
        self.assertEqual(talks, [1])
        lst.handle("je m'appelle Rachida")   # répond sans dire « Kamil » : fenêtre de suite ouverte
        self.assertEqual(lst.mrl.calls[-1][2], "je m'appelle Rachida")
        # quelqu'un parle : pas de réaction pendant ce temps
        lst.segmenter.triggered = True
        lst._maybe_react()
        self.assertEqual(len(noticed), 1)


class FakeWhisper:
    def __init__(self, text, logprob, no_speech=0.0):
        self.text, self.logprob, self.no_speech, self.calls = text, logprob, no_speech, 0

    def transcribe(self, audio, **kw):
        self.calls += 1
        seg = types.SimpleNamespace(text=self.text, avg_logprob=self.logprob, no_speech_prob=self.no_speech)
        return [seg], None


@unittest.skipIf(speech_listener is None, "numpy absent")
class FallbackModelTest(unittest.TestCase):
    def make(self, first, second):
        lst = listener(None, wake_words=["kamil"])
        lst.cfg.update({"language": "fr", "beam_size": 1, "max_no_speech_prob": 0.6, "min_avg_logprob": -1.0,
                        "fallback_below_confidence": -0.45})
        lst.model, lst.fallback_model = first, second
        return lst

    def pcm(self):
        import numpy as np
        return (np.ones(16000, dtype=np.int16) * 3000).tobytes()

    def test_sure_first_model_is_kept(self):
        small = FakeWhisper("Kamil, quelle heure est-il ?", -0.1)
        lst = self.make(FakeWhisper("Kamil, raconte-moi une histoire", -0.2), small)
        self.assertEqual(lst.transcribe(self.pcm()), "Kamil, raconte-moi une histoire")
        self.assertEqual(small.calls, 0)

    def test_doubtful_phrase_for_the_robot_goes_to_second_model(self):
        small = FakeWhisper("Kamil, quelle heure est-il ?", -0.15)
        lst = self.make(FakeWhisper("Kamil, Calerity", -0.7), small)
        self.assertEqual(lst.transcribe(self.pcm()), "Kamil, quelle heure est-il ?")
        # même si le 1er modèle a jugé toute la phrase trop incertaine
        lst = self.make(FakeWhisper("Kamil, Kelleurity", -1.3), small)
        self.assertEqual(lst.transcribe(self.pcm()), "Kamil, quelle heure est-il ?")

    def test_doubtful_noise_not_for_the_robot_is_not_retried(self):
        small = FakeWhisper("peu importe", -0.1)
        lst = self.make(FakeWhisper("à côté du sport loup", -0.8), small)
        self.assertEqual(lst.transcribe(self.pcm()), "à côté du sport loup")
        self.assertEqual(small.calls, 0)
        lst.awake_until = time.monotonic() + 10      # en pleine conversation : on réessaie
        self.assertEqual(lst.transcribe(self.pcm()), "peu importe")


if __name__ == "__main__":
    unittest.main()
