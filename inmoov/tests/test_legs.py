"""Tests des jambes sans matériel (ni Arduino, ni servos)."""

import json
import math
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LEGS = os.path.join(ROOT, "legs")
sys.path[:0] = [LEGS]

from legs_controller import (  # noqa: E402
    PoseError, deg_to_raw, move_command, parse_status, pose_targets, raw_to_deg)
from torque_calc import joint_torques, suitable  # noqa: E402


def load_cfg():
    with open(os.path.join(LEGS, "legs_config.example.json"), encoding="utf-8") as f:
        return json.load(f)


def firmware_tables():
    with open(os.path.join(LEGS, "firmware", "inmoov_legs", "inmoov_legs.ino"), encoding="utf-8") as f:
        src = f.read()

    def table(name):
        body = re.search(r"%s\[NUM_JOINTS\]\s*=\s*\{([^}]*)\}" % name, src).group(1)
        return [int(x) for x in body.replace("\n", " ").split(",")]

    return table("IDS"), table("POS_MIN"), table("POS_MAX")


class ConversionTest(unittest.TestCase):
    def test_deg_raw_roundtrip(self):
        j = {"center": 2048, "direction": 1}
        self.assertEqual(deg_to_raw(j, 0), 2048)
        self.assertEqual(deg_to_raw(j, 90), 3072)
        self.assertEqual(deg_to_raw(dict(j, direction=-1), 90), 1024)
        self.assertAlmostEqual(raw_to_deg(dict(j, direction=-1), 1024), 90)


class PoseTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_cfg()

    def test_all_poses_valid(self):
        for name, pose in self.cfg["poses"].items():
            targets = pose_targets(self.cfg, pose)
            self.assertEqual(len(targets), 12, name)

    def test_sequences_reference_known_poses(self):
        for name, steps in self.cfg["sequences"].items():
            for pose_name, ms in steps:
                self.assertIn(pose_name, self.cfg["poses"], name)
                self.assertGreaterEqual(ms, 300)

    def test_out_of_range_is_refused(self):
        with self.assertRaises(PoseError):
            pose_targets(self.cfg, {"gauche_genou": 120})
        with self.assertRaises(PoseError):
            pose_targets(self.cfg, {"gauche_genou": -5})  # le genou ne plie pas à l'envers
        with self.assertRaises(PoseError):
            pose_targets(self.cfg, {"bras_gauche": 10})

    def test_move_command_format(self):
        cmd = move_command({11: 2100, 1: 2000}, 2500)
        self.assertEqual(cmd, "MOVE 2500 1:2000 11:2100")

    def test_config_matches_firmware(self):
        """Toute position autorisée côté Raspberry doit l'être aussi côté Arduino,
        quel que soit le sens de montage (direction ±1)."""
        ids, pmin, pmax = firmware_tables()
        self.assertEqual(sorted(ids), sorted(j["id"] for j in self.cfg["joints"].values()))
        for name, j in self.cfg["joints"].items():
            i = ids.index(j["id"])
            for direction in (1, -1):
                jj = dict(j, direction=direction)
                for deg in (j["min_deg"], j["max_deg"]):
                    raw = deg_to_raw(jj, deg)
                    self.assertTrue(pmin[i] <= raw <= pmax[i], "%s %s° dir %d -> %d" % (name, deg, direction, raw))


class StatusTest(unittest.TestCase):
    def test_parse(self):
        st = parse_status([
            "STATE FAULT demarrage (envoyer RESET)",
            "S 1 2048 -12 34 121",
            "S 4 2400 300 41 119",
            "IMU 1 0.5 -1.2",
            "OK STATUS",
        ])
        self.assertEqual(st["state"], "FAULT")
        self.assertEqual(st["reason"], "demarrage (envoyer RESET)")
        self.assertEqual(st["servos"][4], {"pos": 2400, "load": 300, "temp_c": 41, "volt": 11.9})
        self.assertEqual(st["imu"], {"ok": True, "roll": 0.5, "pitch": -1.2})


class TorqueTest(unittest.TestCase):
    def test_knee_torque(self):
        t = joint_torques(20, 40, 40, 60, 9, 5)
        # 10 kg par jambe, bras de levier 40·sin(30°) = 20 cm -> 200 kg·cm
        self.assertAlmostEqual(t["genou (accroupi, 2 pieds)"], 200.0)
        self.assertAlmostEqual(t["hanche roulis (sur 1 pied)"], 180.0)

    def test_straight_knee_needs_nothing(self):
        t = joint_torques(20, 40, 40, 0, 9, 5)
        self.assertTrue(math.isclose(t["genou (accroupi, 2 pieds)"], 0.0, abs_tol=1e-9))

    def test_suitable_is_sorted_weakest_first(self):
        names = [a[0] for a in suitable(15)]
        self.assertEqual(names[0], "Feetech STS3250 (12 V)")
        self.assertEqual(suitable(1000), [])


if __name__ == "__main__":
    unittest.main()
