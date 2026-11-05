"""Tests du mode imitation (géométrie synthétique) et des gestes appris."""

import json
import math
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "vision")]

import gesture_player  # noqa: E402
from pose_mapping import Smoother, arm_angles, arm_targets, finger_curls, robot_side  # noqa: E402


def body(left_elbow, left_wrist):
    """Personne face à la caméra (z négatif = vers la caméra, y vers le bas)."""
    pts = [(0.0, 0.0, 0.0)] * 33
    pts = list(pts)
    pts[11], pts[12] = (0.2, -0.5, 0.0), (-0.2, -0.5, 0.0)      # épaules
    pts[23], pts[24] = (0.15, 0.0, 0.0), (-0.15, 0.0, 0.0)      # hanches
    pts[13], pts[15] = left_elbow, left_wrist
    pts[14], pts[16] = (-0.2, -0.2, 0.0), (-0.2, 0.05, 0.0)     # bras droit le long du corps
    return pts


class ArmTest(unittest.TestCase):
    def check(self, elbow_pt, wrist_pt, **expected):
        a = arm_angles(body(elbow_pt, wrist_pt), "left")
        for k, v in expected.items():
            self.assertAlmostEqual(a[k], v, delta=8, msg="%s=%.1f (attendu %s)" % (k, a[k], v))
        return a

    def test_arm_down(self):
        self.check((0.2, -0.2, 0.0), (0.2, 0.05, 0.0), elbow=0, flexion=0, abduction=0)

    def test_arm_forward(self):
        self.check((0.2, -0.5, -0.3), (0.2, -0.5, -0.55), elbow=0, flexion=90, abduction=0)

    def test_arm_sideways(self):
        self.check((0.5, -0.5, 0.0), (0.75, -0.5, 0.0), elbow=0, flexion=0, abduction=90)

    def test_elbow_bent(self):
        self.check((0.2, -0.2, 0.0), (0.2, -0.2, -0.25), elbow=90)

    def test_right_arm_down(self):
        a = arm_angles(body((0.2, -0.2, 0.0), (0.2, 0.05, 0.0)), "right")
        self.assertLess(a["flexion"] + a["abduction"], 10)

    def test_targets_are_clamped(self):
        t = arm_targets({"elbow": 200, "flexion": -20, "abduction": 45})
        self.assertEqual(t, {"bicep": 180.0, "shoulder": 0.0, "omoplate": 90.0})

    def test_mirror(self):
        self.assertEqual(robot_side("right"), "left")
        self.assertEqual(robot_side("right", mirror=False), "right")


def hand(curled):
    """Main synthétique : doigts tendus vers le haut, ou repliés à 90° au milieu."""
    pts = [(0.0, 0.0, 0.0)] * 21
    pts = list(pts)
    for base, x in ((1, -0.08), (5, -0.04), (9, 0.0), (13, 0.04), (17, 0.08)):
        pts[base] = (x, -0.10, 0.0)
        pts[base + 1] = (x, -0.15, 0.0)
        pts[base + 2] = (x, -0.17, -0.03) if curled else (x, -0.19, 0.0)
        pts[base + 3] = (x, -0.15, -0.06) if curled else (x, -0.22, 0.0)
    return pts


class FingerTest(unittest.TestCase):
    def test_open_hand(self):
        self.assertTrue(all(v < 10 for v in finger_curls(hand(False)).values()))

    def test_closed_fingers(self):
        c = finger_curls(hand(True))
        self.assertEqual(c["thumb"], 130.0)          # pouce plafonné comme InMoov2Hand.close()
        self.assertGreater(c["index"], 100)


class SmootherTest(unittest.TestCase):
    def test_speed_limit_and_deadband(self):
        s = Smoother(alpha=1.0, deadband=2.0, max_speed=60.0)
        self.assertEqual(s.update("k", 90, 0.1), 90)        # première valeur
        self.assertEqual(s.update("k", 180, 0.1), 96)       # 60°/s × 0,1 s
        self.assertIsNone(s.update("k", 97, 0.1))           # dans la zone morte


class GesturePlayerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_save_list_play(self):
        steps = [{"t": 0.0, "service": "i01.rightArm.bicep", "pos": 10},
                 {"t": 0.5, "service": "i01.rightHand.index", "pos": 170},
                 {"t": 0.6, "service": "legs.genou", "pos": 90}]          # jamais rejoué
        gesture_player.save(self.dir, "salut", steps)
        self.assertEqual(gesture_player.list_gestures(self.dir), ["salut"])
        sent, waits = [], []
        n = gesture_player.play(lambda s, p: sent.append((s, p)), gesture_player.load(self.dir, "salut"),
                                speed=2.0, sleep=waits.append)
        self.assertEqual(n, 2)
        self.assertEqual(sent, [("i01.rightArm.bicep", 10.0), ("i01.rightHand.index", 170.0)])
        self.assertTrue(math.isclose(sum(waits), 0.25))

    def test_bad_names_and_files(self):
        with self.assertRaises(ValueError):
            gesture_player.check_name("../etc")
        with open(os.path.join(self.dir, "mauvais.json"), "w") as f:
            json.dump({"steps": [{"t": 0, "service": "i01.head.neck", "pos": 999}]}, f)
        with self.assertRaises(ValueError):
            gesture_player.load(self.dir, "mauvais")


if __name__ == "__main__":
    unittest.main()
