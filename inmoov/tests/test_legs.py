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

import threading  # noqa: E402

from legs_controller import (  # noqa: E402
    ANKLES, FEET_KEYS, PoseError, balance_command, deg_to_raw, move_command, parse_feet, parse_status,
    parse_step, pose_targets, raw_to_deg, run_sequence, support_ratio)
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
            for step in steps:
                pose_name, ms, _ = parse_step(step)
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


FEET_LINE = "F 1 12.00 0.10 -0.05 4.00 -0.20 0.00 2 -1.5 0.3 0.8 -2.1"


class FeetTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_cfg()

    def test_parse_feet(self):
        f = parse_feet(FEET_LINE)
        self.assertTrue(f["ok"])
        self.assertEqual(f["g_kg"], 12.0)
        self.assertEqual(f["d_cop_x"], -0.2)
        self.assertEqual(f["balance"], 2)
        self.assertEqual(f["corr_tangage"], -1.5)
        with self.assertRaises(ValueError):
            parse_feet("F 1 2 3")

    def test_status_includes_cells_and_feet(self):
        st = parse_status(["STATE READY", "CELL 0 81234 2.50", FEET_LINE, "OK STATUS"])
        self.assertEqual(st["cells"][0], {"raw": 81234, "kg": 2.5})
        self.assertEqual(st["feet"]["d_kg"], 4.0)

    def test_support_ratio(self):
        f = parse_feet(FEET_LINE)
        self.assertAlmostEqual(support_ratio(f, "gauche"), 0.75)
        self.assertAlmostEqual(support_ratio(f, "droite"), 0.25)
        self.assertIsNone(support_ratio(dict(f, ok=False), "gauche"))
        self.assertIsNone(support_ratio(dict(f, g_kg=0.1, d_kg=0.1), "gauche"))  # pieds en l'air

    def test_balance_command(self):
        cmd = balance_command(self.cfg)
        self.assertEqual(cmd, "BALCFG 0.3 0.02 3 5 1 1 1 1 1 1 1")
        cfg = json.loads(json.dumps(self.cfg))
        cfg["joints"]["droite_cheville_roulis"]["direction"] = -1
        self.assertTrue(balance_command(cfg).endswith(" 1 1 1 -1"))
        for key, bad in (("max_deg", 15), ("kp", -1), ("imu_pitch_sign", 2)):
            cfg = json.loads(json.dumps(self.cfg))
            cfg["balance"][key] = bad
            with self.assertRaises(PoseError, msg=key):
                balance_command(cfg)

    def test_parse_step_gate(self):
        self.assertEqual(parse_step(["debout", 3000]), ("debout", 3000, None))
        with self.assertRaises(PoseError):
            parse_step(["debout", 3000, {"appui": "milieu"}])
        with self.assertRaises(PoseError):
            parse_step(["debout", 3000, {"appui": "gauche", "min": 0.2}])

    def test_walking_sequence_shifts_weight_before_lifting(self):
        """Dans pas_sur_place, chaque pose qui lève un pied suit une étape qui vérifie l'appui sur l'autre."""
        steps = [parse_step(s) for s in self.cfg["sequences"]["pas_sur_place"]]
        for i, (pose, _, _) in enumerate(steps):
            if pose.startswith("lever_pied_"):
                support = "gauche" if pose.endswith("droit") else "droite"
                self.assertEqual(steps[i - 1][2]["appui"], support, pose)

    def test_firmware_matches_protocol(self):
        with open(os.path.join(LEGS, "firmware", "inmoov_legs", "inmoov_legs.ino"), encoding="utf-8") as f:
            src = f.read()
        ids = firmware_tables()[0]
        ankle_idx = [int(x) for x in re.search(r"ANKLE\[4\]\s*=\s*\{([^}]*)\}", src).group(1).split(",")]
        self.assertEqual([ids[i] for i in ankle_idx], [self.cfg["joints"][n]["id"] for n in ANKLES])
        self.assertIn("float v[%d];" % (len(balance_command(self.cfg).split()) - 1), src)
        # ok + 3 valeurs par pied (boucle sur 2 pieds) + 5 valeurs finales
        body = re.search(r"void printFeet\(\) \{(.*?)\n\}", src, re.S).group(1)
        self.assertEqual(body.count("Serial.print(' ')"), 1 + 2 + 5)
        self.assertEqual(1 + 2 * 3 + 5, len(FEET_KEYS))


class FakeLink:
    def __init__(self, feet):
        self.feet_line = feet
        self.moves = []
        self.held = False

    def move(self, targets, ms):
        self.moves.append(ms)

    def feet(self):
        return parse_feet(self.feet_line)

    def wait_support(self, side, minimum, timeout_ms):
        r = support_ratio(self.feet(), side)
        if r is None or r < minimum:
            raise RuntimeError("appui %s insuffisant" % side)
        return r

    def hold(self):
        self.held = True

    def status(self):
        return {"state": "READY", "reason": ""}


class SequenceTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load_cfg()
        for steps in self.cfg["sequences"].values():
            for step in steps:
                step[1] = 0  # pas d'attente dans les tests

    def test_stops_and_holds_when_weight_not_transferred(self):
        link = FakeLink(FEET_LINE)  # 75 % à gauche : moins que les 85 % demandés
        with self.assertRaises(RuntimeError):
            run_sequence(link, self.cfg, "pas_sur_place")
        self.assertTrue(link.held)
        self.assertEqual(len(link.moves), 2)  # debout, transfert_gauche : aucun pied levé

    def test_runs_when_weight_transferred(self):
        link = FakeLink("F 1 19 0 0 1 0 0 0 0 0 0 0")  # 95 % à gauche
        with self.assertRaises(RuntimeError):  # puis le transfert à droite échoue
            run_sequence(link, self.cfg, "pas_sur_place")
        self.assertEqual(len(link.moves), 6)  # le pied droit a été levé, pas le gauche

    def test_stop_event(self):
        stop = threading.Event()
        stop.set()
        with self.assertRaises(RuntimeError):
            run_sequence(FakeLink(FEET_LINE), self.cfg, "flexions", stop_event=stop)
