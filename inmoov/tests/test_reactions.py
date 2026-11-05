"""Réactions spontanées à ce que voient les caméras (voice/reactions.py), avec une horloge simulée."""

import json
import os
import sys
import tempfile
import time
import types
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from reactions import Reactions  # noqa: E402

NOON = time.mktime((2026, 10, 23, 12, 0, 0, 0, 0, -1))


class Scene:
    """Écrit l'état de la vision comme face_tracker.py, à l'heure simulée."""

    def __init__(self, cfg=None, environment=None):
        self.path = os.path.join(tempfile.mkdtemp(), "vision.json")
        self.now = NOON
        self.r = Reactions(dict({"poll_s": 0}, **(cfg or {})), self.path, environment=environment,
                           clock=lambda: self.now)

    def show(self, faces=0, height=0.2, objects=(), paused=False):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump({"time": self.now, "faces": faces, "face_height": height, "tracking_paused": paused,
                       "objects": [{"label": o, "score": 0.9, "side": "à gauche"} for o in objects]}, f)

    def run(self, seconds, step=1.0, **scene):
        """Avance le temps ; renvoie les événements (type) apparus."""
        events, end = [], self.now + seconds
        while self.now < end:
            self.show(**scene)
            e = self.r.poll()
            if e:
                events.append(e[0])
            self.now += step
        return events


class ReactionsTest(unittest.TestCase):
    def test_greets_someone_who_arrives_once(self):
        s = Scene()
        self.assertEqual(s.run(10), [])                        # pièce vide
        self.assertEqual(s.run(30, faces=1), ["arrivee"])       # salue une seule fois
        self.assertEqual(s.run(10), [])                         # court passage hors champ
        self.assertEqual(s.run(5, faces=1), [])                 # revenu vite : pas de nouveau salut

    def test_greets_again_after_long_absence(self):
        s = Scene({"events": ["arrivee"]})
        self.assertEqual(s.run(5, faces=1), ["arrivee"])
        s.run(200)                                              # parti plus de 3 minutes
        self.assertEqual(s.run(5, faces=1), ["arrivee"])

    def test_brief_glimpse_is_ignored(self):
        s = Scene()
        self.assertEqual(s.run(1, faces=1), [])                 # moins de 1,5 s : pas confirmé
        self.assertEqual(s.run(5), [])

    def test_no_greeting_while_talking(self):
        s = Scene()
        s.r.on_conversation()
        self.assertEqual(s.run(10, faces=1), [])

    def test_silent_visitor_and_close_face(self):
        s = Scene({"events": ["attente", "proche"]})
        self.assertEqual(s.run(50, faces=1), ["attente"])
        self.assertEqual(s.run(5, faces=1, height=0.5), ["proche"])

    def test_unusual_object_while_someone_is_there(self):
        env = types.SimpleNamespace(objects={"tasse": {"sightings": 100}}, habitual_min=30)
        s = Scene({"events": ["objet"]}, environment=env)
        s.run(5, faces=1, objects=["tasse"])
        self.assertEqual(s.run(3, faces=1, objects=["tasse", "chaise"]), [])     # habituel / ignoré
        self.assertEqual(s.run(3, faces=1, objects=["tasse", "parapluie"]), ["objet"])
        self.assertEqual(s.run(3, objects=["ballon"]), [])                       # personne devant

    def test_goodbye_only_after_a_conversation(self):
        s = Scene({"events": ["depart"]})
        s.run(5, faces=1)
        self.assertEqual(s.run(30), [])                          # pas parlé : rien à dire
        s.run(5, faces=1)
        s.r.on_conversation()
        self.assertEqual(s.run(30), ["depart"])

    def test_quiet_hours_and_hourly_limit(self):
        s = Scene()
        s.now = time.mktime((2026, 10, 23, 23, 30, 0, 0, 0, -1))
        self.assertEqual(s.run(10, faces=1), [])                 # la nuit : silence
        s = Scene({"max_per_hour": 1, "cooldown_s": {"arrivee": 0}})
        self.assertEqual(s.run(5, faces=1), ["arrivee"])
        s.run(100)
        self.assertEqual(s.run(5, faces=1), [])                  # limite par heure atteinte

    def test_paused_tracking_or_stale_vision(self):
        s = Scene()
        self.assertEqual(s.run(10, faces=1, paused=True), [])    # il regarde autour : pas d'événement
        s2 = Scene()
        s2.show(faces=1)
        s2.now += 60                                             # image vieille d'une minute
        self.assertIsNone(s2.r.poll())


if __name__ == "__main__":
    unittest.main()
