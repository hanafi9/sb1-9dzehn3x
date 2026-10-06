"""Tests de l'Atelier InMoov (application web) sans matériel.

Nécessite Flask (pip install -r app/requirements.txt).
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "app"), os.path.join(ROOT, "legs")]

try:
    import flask  # noqa: F401
    import app as atelier
    import arduino_tools
    import servo_inventory
except ImportError:  # pragma: no cover
    atelier = None


class FakeMrl:
    def __init__(self, up=True):
        self.up = up
        self.calls = []

    def call_checked(self, service, method, *params):
        self.calls.append((service, method) + params)
        if not self.up:
            return False, None
        return True, {"getVersion": "1.1.1500", "getUptime": "2 minutes",
                      "getCurrentInputPos": 92.0, "saveConfig": True}.get(method)

    def call(self, *a):
        return self.call_checked(*a)[1]


class FakeRun:
    """Remplace subprocess.run pour lsusb, systemctl, arduino-cli..."""

    def __init__(self):
        self.calls = []

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        out, rc = "", 0
        if cmd[0] == "lsusb":
            out = "Bus 002 Device 003: ID 18d1:9302 Google Inc.\n"
        elif cmd[:2] == ["systemctl", "is-active"]:
            out = "active\n"
        elif cmd[1:3] == ["board", "list"]:
            out = json.dumps({"detected_ports": [
                {"port": {"address": "/dev/ttyACM0", "protocol": "serial", "label": "/dev/ttyACM0"},
                 "matching_boards": [{"name": "Arduino Mega or Mega 2560", "fqbn": "arduino:avr:mega"}]},
                {"port": {"address": "192.168.1.5", "protocol": "network"}},
            ]})
        return subprocess.CompletedProcess(cmd, rc, out, "")


@unittest.skipIf(atelier is None, "Flask non installé")
class AppTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.mrl = FakeMrl()
        self.run = FakeRun()
        self.app = atelier.create_app(data_dir=self.tmp, run=self.run, mrl=self.mrl)
        self.c = self.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_index_and_static(self):
        self.assertEqual(self.c.get("/").status_code, 200)
        self.assertEqual(self.c.get("/static/app.js").status_code, 200)

    def test_status(self):
        s = self.c.get("/api/status").get_json()
        self.assertTrue(s["mrl"]["ok"])
        self.assertEqual(s["mrl"]["version"], "1.1.1500")
        self.assertTrue(s["coral"])
        self.assertEqual(s["services"]["inmoov-voice"]["state"], "active")

    def test_status_when_mrl_down(self):
        self.mrl.up = False
        s = self.c.get("/api/status").get_json()
        self.assertFalse(s["mrl"]["ok"])

    def test_guide_progress_persists(self):
        g = self.c.get("/api/guide").get_json()
        first = g["phases"][0]["steps"][0]["id"]
        self.assertEqual(self.c.post("/api/guide/" + first, json={"done": True}).status_code, 200)
        self.assertTrue(self.c.get("/api/guide").get_json()["done"][first])
        self.assertEqual(self.c.post("/api/guide/nexiste-pas", json={"done": True}).status_code, 400)

    def test_guide_ids_unique(self):
        g = self.c.get("/api/guide").get_json()
        ids = [s["id"] for p in g["phases"] for s in p["steps"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_servo_list_has_head_and_neck(self):
        groups = self.c.get("/api/servos").get_json()["groups"]
        head = next(g for g in groups if g["key"] == "head")
        services = [s["service"] for s in head["servos"]]
        self.assertIn("i01.head.neck", services)
        self.assertIn("i01.head.rothead", services)

    def test_move_and_actions(self):
        r = self.c.post("/api/servos/i01.head.neck/move", json={"pos": 100})
        self.assertEqual(r.status_code, 200)
        self.assertIn(("i01.head.neck", "moveTo", 100.0), self.mrl.calls)
        self.assertEqual(self.c.post("/api/servos/i01.head.neck/move", json={"pos": 999}).status_code, 400)
        self.assertEqual(self.c.post("/api/servos/i01.head.neck/action", json={"action": "rest"}).status_code, 200)
        self.assertEqual(self.c.post("/api/servos/i01.head.neck/action", json={"action": "shutdown"}).status_code, 400)
        pos = self.c.get("/api/servos/i01.head.neck/position").get_json()
        self.assertEqual(pos["pos"], 92.0)

    def test_unknown_servo_is_refused(self):
        r = self.c.post("/api/servos/runtime/move", json={"pos": 10})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.mrl.calls, [])

    def test_calibration_save_and_apply(self):
        cal = {"min_out": 40, "max_out": 140, "rest": 90, "speed": 30, "inverted": True}
        r = self.c.put("/api/servos/i01.head.rothead/calibration", json=dict(cal, apply=True))
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertIn(("i01.head.rothead", "setMinMaxOutput", 40.0, 140.0), self.mrl.calls)
        self.assertIn(("i01.head.rothead", "setInverted", True), self.mrl.calls)
        self.assertIn(("i01.head.rothead", "setRest", 90.0), self.mrl.calls)
        self.assertIn(("i01.head.rothead", "setSpeed", 30.0), self.mrl.calls)
        groups = self.c.get("/api/servos").get_json()["groups"]
        rot = next(s for s in groups[0]["servos"] if s["key"] == "rothead")
        self.assertEqual((rot["min_out"], rot["max_out"], rot["inverted"]), (40.0, 140.0, True))

    def test_calibration_validation(self):
        bad = {"min_out": 150, "max_out": 40, "rest": 90}
        self.assertEqual(self.c.put("/api/servos/i01.head.neck/calibration", json=bad).status_code, 400)

    def test_apply_all_stops_when_mrl_down(self):
        self.mrl.up = False
        r = self.c.post("/api/servos/apply_all").get_json()
        self.assertFalse(r["ok"])
        self.assertEqual(len(self.mrl.calls), 1)

    def test_save_mrl_config(self):
        self.assertEqual(self.c.post("/api/mrl/save_config", json={"name": "inmoov2"}).status_code, 200)
        self.assertIn(("runtime", "saveConfig", "inmoov2"), self.mrl.calls)
        self.assertEqual(self.c.post("/api/mrl/save_config", json={"name": "../etc"}).status_code, 400)

    def test_sketches_and_source(self):
        data = self.c.get("/api/arduino/sketches").get_json()
        legs = next(s for s in data["sketches"] if s["id"] == "legs")
        self.assertTrue(legs["exists"])
        self.assertIn("inmoov_legs.ino", legs["files"])
        src = self.c.get("/api/arduino/sketches/legs/source/inmoov_legs.ino").get_json()
        self.assertIn("SyncWritePosEx", src["source"])
        self.assertEqual(self.c.get("/api/arduino/sketches/legs/source/..%2F..%2Fapp.py").status_code, 404)
        self.assertEqual(self.c.get("/api/arduino/sketches/legs/source/secret.txt").status_code, 400)

    def test_boards(self):
        b = self.c.get("/api/arduino/boards").get_json()
        self.assertEqual(b["boards"], [{"port": "/dev/ttyACM0", "label": "/dev/ttyACM0",
                                        "name": "Arduino Mega or Mega 2560", "fqbn": "arduino:avr:mega"}])

    def test_upload_requires_port_and_runs_job(self):
        self.assertEqual(self.c.post("/api/arduino/upload", json={"sketch": "legs"}).status_code, 400)
        # arduino-cli remplacé par « echo » pour vérifier la commande lancée
        self.c.put("/api/settings", json={"arduino_cli": "echo"})
        r = self.c.post("/api/arduino/upload", json={"sketch": "legs", "port": "/dev/ttyACM0"}).get_json()
        for _ in range(50):
            job = self.c.get("/api/jobs/%d" % r["job"]).get_json()
            if job["state"] != "en cours":
                break
            time.sleep(0.05)
        self.assertEqual(job["state"], "réussi")
        self.assertIn("compile --upload --port /dev/ttyACM0 --fqbn arduino:avr:mega", job["log"])

    def test_mrlcomm_missing_is_reported(self):
        self.c.put("/api/settings", json={"mrl_dir": self.tmp})
        data = self.c.get("/api/arduino/sketches").get_json()
        mrl = next(s for s in data["sketches"] if s["id"] == "mrlcomm")
        self.assertFalse(mrl["exists"])
        self.assertEqual(self.c.post("/api/arduino/compile", json={"sketch": "mrlcomm"}).status_code, 400)

    def test_legs_require_connection_and_gantry(self):
        info = self.c.get("/api/legs").get_json()
        self.assertFalse(info["connected"])
        self.assertIn("test_genoux_5deg", info["poses"])
        self.assertEqual(self.c.post("/api/legs/pose", json={"name": "debout"}).status_code, 502)

    def test_config_edit_validates(self):
        self.c.put("/api/settings", json={"legs_config": os.path.join(self.tmp, "legs.json"),
                                          "robot_config": os.path.join(self.tmp, "config.json")})
        legs = self.c.get("/api/config/legs").get_json()
        self.assertFalse(legs["exists"])
        cfg = json.loads(legs["text"])
        cfg["poses"]["trop"] = {"gauche_genou": 170}
        r = self.c.put("/api/config/legs", json={"text": json.dumps(cfg)})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.put("/api/config/robot", json={"text": "{pas du json"}).status_code, 400)
        robot = self.c.get("/api/config/robot").get_json()["text"]
        self.assertEqual(self.c.put("/api/config/robot", json={"text": robot}).status_code, 200)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "config.json")))

    def test_settings_validation(self):
        self.assertEqual(self.c.put("/api/settings", json={"mrl_url": "ftp://x"}).status_code, 400)

    def test_password(self):
        os.environ["INMOOV_APP_PASSWORD"] = "robot"
        try:
            c = atelier.create_app(data_dir=self.tmp, run=self.run, mrl=self.mrl).test_client()
            self.assertEqual(c.get("/api/settings").status_code, 401)
            import base64
            tok = base64.b64encode(b"x:robot").decode()
            self.assertEqual(c.get("/api/settings", headers={"Authorization": "Basic " + tok}).status_code, 200)
        finally:
            del os.environ["INMOOV_APP_PASSWORD"]


@unittest.skipIf(atelier is None, "Flask non installé")
class InventoryTest(unittest.TestCase):
    def test_defaults_are_valid(self):
        for service, cal in servo_inventory.default_calibration().items():
            servo_inventory.validate_calibration(cal)

    def test_commands(self):
        sk = {"fqbn": "arduino:avr:mega", "path": "/x/inmoov_legs"}
        self.assertEqual(arduino_tools.compile_command("cli", sk),
                         ["cli", "compile", "--fqbn", "arduino:avr:mega", "/x/inmoov_legs"])
        self.assertIn(["cli", "lib", "install", "Servo", "SCServo", "Adafruit BNO08x"],
                      arduino_tools.setup_commands("cli"))


if __name__ == "__main__":
    unittest.main()
