"""Baisser le son de la télé pendant qu'on parle à Kamil, puis le remettre (voice/ducking.py)."""

import os
import sys
import time
import types
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from ducking import Ducker  # noqa: E402


class FakeHome:
    def __init__(self, state="on", volume=0.6):
        self.calls = []
        self.st = {"state": state, "attributes": {"volume_level": volume}}

    def _entity(self, entity_id):
        return self.st

    def call_service(self, domain, service, data):
        self.calls.append((domain, service, data))
        return True, "ok"


class DuckingTest(unittest.TestCase):
    def test_volume_set_and_back(self):
        home = FakeHome(volume=0.6)
        d = Ducker(home, [{"media_player": "media_player.tv", "level": 0.15}])
        d.duck(wait=True)
        d.duck(wait=True)                                   # redire « Kamil » : rien de plus
        self.assertEqual(home.calls, [("media_player", "volume_set",
                                       {"entity_id": "media_player.tv", "volume_level": 0.15})])
        d.restore(wait=True)
        self.assertEqual(home.calls[-1][2], {"entity_id": "media_player.tv", "volume_level": 0.6})   # comme avant
        d.restore(wait=True)
        self.assertEqual(len(home.calls), 2)

    def test_quiet_or_off_tv_untouched(self):
        for home in (FakeHome(volume=0.1), FakeHome(state="off")):
            d = Ducker(home, [{"media_player": "media_player.tv", "level": 0.15}])
            d.duck(wait=True)
            d.restore(wait=True)
            self.assertEqual(home.calls, [])

    def test_infrared_amp_steps(self):
        home = FakeHome()
        d = Ducker(home, [{"down": "script.denon_vol_down", "up": "script.denon_vol_up", "steps": 3}],
                   sleep=lambda s: None)
        d.duck(wait=True)
        # script.<nom> appelé comme service : Home Assistant attend la fin (script.turn_on perdrait des appuis)
        self.assertEqual(home.calls, [("script", "denon_vol_down", {})] * 3)
        d.restore(wait=True)
        self.assertEqual(home.calls[3:], [("script", "denon_vol_up", {})] * 3)

    def test_infrared_up_steps_and_pause(self):
        home, pauses = FakeHome(), []
        d = Ducker(home, [{"down": "script.dn", "up": "script.up", "steps": 4, "up_steps": 5, "pause": 1.2}],
                   sleep=pauses.append)
        d.duck(wait=True)
        d.restore(wait=True)
        self.assertEqual([c[1] for c in home.calls], ["dn"] * 4 + ["up"] * 5)
        self.assertEqual(set(pauses), {1.2})

    def test_infrared_floor_then_fixed_count(self):
        home = FakeHome()
        answers = iter([(True, "ok")] * 3 + [(False, "Home Assistant a répondu 500")])
        home.call_service = lambda dom, srv, data: (home.calls.append(srv), next(answers, (True, "ok")))[1]
        d = Ducker(home, [{"down": "script.dn", "up": "script.up", "steps": 50, "floor": True, "up_steps": 45}],
                   sleep=lambda s: None)
        d.duck(wait=True)                                     # coupé au 4e appui : déjà au minimum ou presque
        d.restore(wait=True)
        self.assertEqual(home.calls, ["dn"] * 4 + ["up"] * 45)  # remonte quand même à la valeur voulue

    def test_infrared_failed_press_not_restored(self):
        home = FakeHome()
        answers = iter([(True, "ok"), (False, "Home Assistant a répondu 500")])
        home.call_service = lambda dom, srv, data: (home.calls.append(srv), next(answers, (True, "ok")))[1]
        d = Ducker(home, [{"down": "script.dn", "up": "script.up", "steps": 6}], sleep=lambda s: None)
        d.duck(wait=True)
        d.restore(wait=True)
        self.assertEqual(home.calls, ["dn", "dn", "up"])      # 1 seul appui réussi : 1 seul à remettre


class ListenerDuckingTest(unittest.TestCase):
    def test_duck_on_wake_word_and_restore_after(self):
        try:
            from test_listener_chatbot import FakeTts, listener, speech_listener
        except ImportError:
            self.skipTest("speech_listener indisponible")
        if speech_listener is None:
            self.skipTest("numpy absent")
        lst = listener(FakeTts(), wake_words=["kamil"])
        lst.segmenter = types.SimpleNamespace(triggered=False, reset=lambda: None)
        events = []
        lst.ducker = types.SimpleNamespace(ducked=False, duck=lambda: (events.append("baisse"),
                                                                       setattr(lst.ducker, "ducked", True)),
                                           restore=lambda: (events.append("remet"),
                                                            setattr(lst.ducker, "ducked", False)))
        lst.handle("Kamil, quelle heure est-il ?")
        self.assertEqual(events, ["baisse"])
        lst.awake_until = lst.mute_until = time.monotonic() + 30   # conversation en cours
        lst._maybe_react()
        self.assertEqual(events, ["baisse"])
        lst.awake_until = lst.mute_until = time.monotonic() - 5    # fini
        lst._maybe_react()
        self.assertEqual(events, ["baisse", "remet"])
        lst.handle("et la météo")                                  # sans « Kamil » : pas de baisse
        self.assertEqual(events, ["baisse", "remet"])


if __name__ == "__main__":
    unittest.main()
