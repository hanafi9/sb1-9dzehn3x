"""Surveillance (voice/watch.py) : journal, photos, mode garde, avec une horloge simulée."""

import json
import os
import sys
import tempfile
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from watch import Watcher  # noqa: E402

NOON = time.mktime((2026, 10, 23, 12, 0, 0, 0, 0, -1))


class Scene:
    def __init__(self):
        self.dir = tempfile.mkdtemp()
        self.state = os.path.join(self.dir, "vision.json")
        self.frames = [os.path.join(self.dir, "f1.jpg"), os.path.join(self.dir, "f2.jpg")]
        for p in self.frames:
            with open(p, "wb") as f:
                f.write(b"\xff\xd8jpeg")
        self.now = NOON
        self.w = Watcher({"poll_s": 0, "frame_paths": self.frames, "journal_path": "journal.jsonl",
                          "snapshots_dir": "snaps"}, self.state, base_dir=self.dir, clock=lambda: self.now)

    def run(self, seconds, people=0, motion1=0.0, motion2=0.0, objects=(), objects2=()):
        alerts, end = [], self.now + seconds
        while self.now < end:
            with open(self.state, "w", encoding="utf-8") as f:
                json.dump({"time": self.now, "faces": 0, "people": people,
                           "motion": {"level": motion1, "boxes": [[0.7, 0.2, 0.9, 0.5]] if motion1 else []},
                           "objects": [{"label": o} for o in objects],
                           "camera2": {"motion": {"level": motion2, "boxes": []},
                                       "objects": [{"label": o} for o in objects2]}}, f)
            a = self.w.poll()
            if a:
                alerts.append(a)
            self.now += 1
        return alerts

    def texts(self):
        return [e["text"] for e in self.w.entries(24)]


class WatchTest(unittest.TestCase):
    def test_journal_of_comings_and_goings(self):
        s = Scene()
        s.run(5, objects=["chaise", "plante en pot"])          # décor du démarrage : pas noté
        s.run(5, people=1)
        s.run(20)
        s.run(3, motion2=0.2)                                   # mouvement sans personne, caméra 2
        s.run(5, objects=["chaise", "plante en pot", "sac à dos"])
        texts = s.texts()
        self.assertIn("Arrivée : une personne devant moi", texts)
        self.assertIn("Départ : plus personne en vue", texts)
        self.assertIn("Mouvement sans personne visible (caméra 2)", texts)
        self.assertIn("Nouvel objet : sac à dos (caméra 1)", texts)
        self.assertNotIn("Nouvel objet : chaise (caméra 1)", texts)
        # photos gardées pour l'arrivée (2 caméras) et le mouvement (caméra 2)
        arrival = next(e for e in s.w.entries(24) if e["type"] == "arrivee")
        self.assertEqual(len(arrival["images"]), 2)
        self.assertTrue(all(os.path.isfile(p) for p in arrival["images"]))
        self.assertIn("12 h 00 : Arrivée", s.w.journal_text(24))

    def test_photo_and_old_entries(self):
        s = Scene()
        s.run(3, people=1)
        caption, path = s.w.photo(1)
        self.assertIn("Arrivée", caption)
        self.assertTrue(path.endswith("-cam1.jpg") or path.endswith("-cam2.jpg"))
        self.assertEqual(s.w.photo(5), (None, None))
        s.now += 48 * 3600
        self.assertIn("Rien de noté", s.w.journal_text(24))

    def test_guard_mode_alerts(self):
        s = Scene()
        self.assertEqual(s.run(3, people=1), [])               # pas de garde : pas d'alerte
        s.run(20)
        s.w.set_guard(True)
        alerts = s.run(3, people=1)
        self.assertEqual(alerts, ["Arrivée : une personne devant moi"])
        s.run(20)
        self.assertTrue(any("Mouvement" in a for a in s.run(3, motion1=0.3)))
        s.w.set_guard(False)
        self.assertIn("Mode garde désactivé", s.texts())

    def test_motion_rate_limited_and_ignored_with_people(self):
        s = Scene()
        s.run(30, motion1=0.2)
        self.assertEqual(sum("Mouvement" in t for t in s.texts()), 1)   # 1 par minute au plus
        s2 = Scene()
        s2.run(10, people=1, motion1=0.2)
        self.assertFalse(any("Mouvement" in t for t in s2.texts()))     # la personne bouge : normal


if __name__ == "__main__":
    unittest.main()
