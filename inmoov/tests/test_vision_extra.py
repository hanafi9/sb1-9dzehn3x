"""Vision : suivi de la silhouette sans visage, cadres en double, mouvement sur les 2 caméras."""

import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "vision")]

from scene import iou, summarize_objects  # noqa: E402
from faces import FaceFilter  # noqa: E402
from tracking import person_head_target  # noqa: E402

try:
    import numpy as np
    from motion import MotionDetector
except ImportError:  # pragma: no cover
    MotionDetector = None


class VisionExtraTest(unittest.TestCase):
    def test_head_of_biggest_person(self):
        objs = [(0, 0.8, 100, 50, 300, 450), (0, 0.9, 400, 100, 440, 200), (41, 0.9, 0, 0, 640, 480)]
        x0, y0, x1, y1, score = person_head_target(objs, {0})
        self.assertEqual((x0, y0, x1, y1), (160.0, 50, 240.0, 130.0))   # haut et milieu de la silhouette
        self.assertIsNone(person_head_target([(0, 0.3, 0, 0, 10, 10)], {0}))
        self.assertIsNone(person_head_target([], {0}))

    def test_duplicate_boxes_are_merged(self):
        labels = {0: "person", 46: "cup"}
        raw = [(0, 0.70, 100, 100, 300, 400), (0, 0.69, 105, 110, 310, 410), (0, 0.52, 90, 95, 290, 390),
               (0, 0.60, 400, 100, 500, 300), (46, 0.54, 100, 100, 300, 400)]
        out = summarize_objects(raw, labels, 640, 480)
        self.assertEqual([o["label"] for o in out], ["personne", "personne", "tasse"])
        self.assertAlmostEqual(iou([0, 0, 1, 1], [0, 0, 1, 1]), 1.0)
        self.assertEqual(iou([0, 0, 1, 1], [2, 2, 3, 3]), 0.0)

    @unittest.skipIf(MotionDetector is None, "OpenCV absent")
    def test_motion(self):
        m = MotionDetector()
        still = np.zeros((480, 640, 3), dtype=np.uint8)
        self.assertEqual(m.update(still)["level"], 0.0)
        self.assertEqual(m.update(still)["boxes"], [])
        moved = still.copy()
        moved[100:300, 400:600] = 255                      # quelque chose apparaît à droite
        r = m.update(moved)
        self.assertGreater(r["level"], 0.05)
        x0, y0, x1, y1 = r["boxes"][0]
        self.assertGreater(x0, 0.5)                        # le cadre est bien dans la moitié droite


    @unittest.skipIf(MotionDetector is None, "OpenCV absent")
    def test_motion_ignores_light_noise_and_tv(self):
        rng = np.random.default_rng(1)
        base = rng.integers(60, 120, (480, 640, 3), dtype=np.uint8)
        m = MotionDetector()
        m.update(base)
        self.assertEqual(m.update(np.clip(base.astype(int) + 30, 0, 255).astype(np.uint8))["level"], 0.0)  # exposition
        lamp = MotionDetector()
        lamp.update(base)
        r = lamp.update(np.clip(base.astype(int) * 2 - 40, 0, 255).astype(np.uint8))   # lampe allumée
        self.assertTrue(r["light"])
        self.assertEqual(r["level"], 0.0)
        noisy = MotionDetector()
        noisy.update(base)
        speck = base.copy()
        speck[rng.integers(0, 480, 60), rng.integers(0, 640, 60)] = 255             # bruit de la caméra
        self.assertEqual(noisy.update(speck)["boxes"], [])
        tv = MotionDetector(ignore_zones=[[0.0, 0.0, 0.5, 0.5]])                     # télé en haut à gauche
        tv.update(base)
        img = base.copy()
        img[50:200, 50:280] = 255                                                    # image de la télé
        self.assertEqual(tv.update(img)["level"], 0.0)
        img[300:460, 400:600] = 0                                                    # quelqu'un en bas à droite
        r = tv.update(img)
        self.assertGreater(r["level"], 0.02)
        self.assertGreater(r["boxes"][0][0], 0.5)

    @unittest.skipIf(MotionDetector is None, "OpenCV absent")
    def test_motion_merges_one_person(self):
        m = MotionDetector()
        still = np.zeros((480, 640, 3), dtype=np.uint8)
        m.update(still)
        person = still.copy()
        person[100:180, 300:360] = 200          # tête
        person[190:400, 280:380] = 200          # corps, juste en dessous
        self.assertEqual(len(m.update(person)["boxes"]), 1)


class FaceFilterTest(unittest.TestCase):
    W, H = 640, 480

    def face(self, x=300, y=200, s=80, score=0.8):
        return (x, y, x + s, y + s, score)

    def test_new_face_confirmed_after_two_frames(self):
        f = FaceFilter({"confirm_frames": 2}, 0.6)
        self.assertEqual(f.update([self.face()], self.W, self.H), [])         # 1 image : pas encore sûr
        self.assertEqual(len(f.update([self.face(x=303)], self.W, self.H)), 1)
        flash = FaceFilter({"confirm_frames": 2}, 0.6)                        # faux visage d'une seule image
        flash.update([self.face()], self.W, self.H)
        self.assertEqual(flash.update([], self.W, self.H), [])
        self.assertEqual(flash.tracks, [])

    def test_kept_during_blink_and_low_score(self):
        f = FaceFilter({"confirm_frames": 2, "keep_frames": 3, "keep_threshold": 0.45}, 0.6)
        f.update([self.face()], self.W, self.H)
        f.update([self.face()], self.W, self.H)
        for _ in range(3):
            self.assertEqual(len(f.update([], self.W, self.H)), 1)            # perdu 3 images : gardé
        self.assertEqual(f.update([], self.W, self.H), [])                    # 4e : parti
        g = FaceFilter({"keep_threshold": 0.45}, 0.6)
        g.update([self.face()], self.W, self.H)
        g.update([self.face()], self.W, self.H)
        self.assertEqual(len(g.update([self.face(score=0.5)], self.W, self.H)), 1)   # score en baisse : gardé
        self.assertEqual(FaceFilter(None, 0.6).update([self.face(score=0.5)] * 1, self.W, self.H), [])

    def test_implausible_boxes_and_smoothing(self):
        f = FaceFilter({"confirm_frames": 1, "min_size": 0.04, "smooth": 0.5}, 0.6)
        self.assertEqual(f.update([(10, 10, 20, 20, 0.9)], self.W, self.H), [])          # trop petit
        self.assertEqual(f.update([(100, 100, 400, 140, 0.9)], self.W, self.H), [])      # bande très large
        f = FaceFilter({"confirm_frames": 1, "smooth": 0.5}, 0.6)
        f.update([self.face(x=300)], self.W, self.H)
        x0 = f.update([self.face(x=320)], self.W, self.H)[0][0]
        self.assertAlmostEqual(x0, 310)                                                  # tremblement lissé


if __name__ == "__main__":
    unittest.main()
