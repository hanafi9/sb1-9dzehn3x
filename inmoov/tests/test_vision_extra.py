"""Vision : suivi de la silhouette sans visage, cadres en double, mouvement sur les 2 caméras."""

import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "vision")]

from scene import iou, summarize_objects  # noqa: E402
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


if __name__ == "__main__":
    unittest.main()
