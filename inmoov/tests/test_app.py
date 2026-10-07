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
    import wiring
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


@unittest.skipIf(atelier is None, "Flask non installé")
class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.mrl = FakeMrl()
        self.c = atelier.create_app(data_dir=self.tmp, run=FakeRun(), mrl=self.mrl).test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_every_servo_has_a_unique_channel(self):
        self.assertEqual(set(wiring.SERVO_PLAN), servo_inventory.all_services())
        used = {}
        for service, (board, channel, _m) in wiring.SERVO_PLAN.items():
            self.assertTrue(0 <= channel <= 15, service)
            self.assertNotIn((board, channel), used, "%s et %s" % (service, used.get((board, channel))))
            used[(board, channel)] = service
        addresses = [b["address"] for b in wiring.BOARDS]
        self.assertEqual(len(addresses), len(set(addresses)))

    def test_overview_and_parts(self):
        o = self.c.get("/api/schema").get_json()
        self.assertEqual([p["key"] for p in o["parts"]], ["tete", "torse", "bras", "mains", "bassin", "jambes", "capteurs"])
        head = self.c.get("/api/schema/tete").get_json()
        neck = next(s for s in head["servos"] if s["service"] == "i01.head.neck")
        self.assertEqual((neck["address"], neck["channel"]), ("0x40", 1))
        self.assertTrue(head["printed"] and head["hardware"])
        mains = self.c.get("/api/schema/mains").get_json()
        self.assertEqual(len(mains["servos"]), 12)
        self.assertEqual({b["address"] for b in mains["boards"]}, {"0x41", "0x42"})
        legs = self.c.get("/api/schema/jambes").get_json()
        self.assertEqual(len(legs["leg_servos"]), 12)
        self.assertEqual(self.c.get("/api/schema/queue").status_code, 400)

    def test_printed_checklist_persists(self):
        head = self.c.get("/api/schema/tete").get_json()
        g = head["printed"][0]
        r = self.c.post("/api/schema/tete/printed", json={"group": g["group"], "item": g["items"][0], "done": True})
        self.assertEqual(r.status_code, 200)
        again = self.c.get("/api/schema/tete").get_json()
        self.assertTrue(again["printed"][0]["done"][0])
        self.assertFalse(again["printed"][0]["done"][1])

    def test_script_and_apply(self):
        script = self.c.get("/api/schema/mrl_script").get_data(as_text=True)
        self.assertIn('runtime.start(nom, "Adafruit16CServoDriver")', script)
        self.assertIn('carte.attach("i01.left", "0", adresse)', script)
        self.assertIn('("i01.head.neck", "pca_tete", 1)', script)
        compile(script, "mrl_script", "exec")  # syntaxe Python valide
        self.assertEqual(self.c.post("/api/schema/apply", json={}).status_code, 400)
        r = self.c.post("/api/schema/apply", json={"confirm": True}).get_json()
        self.assertTrue(r["ok"])
        self.assertIn(("runtime", "start", "pca_gauche", "Adafruit16CServoDriver"), self.mrl.calls)
        self.assertIn(("pca_droite", "attach", "i01.left", "0", "0x42"), self.mrl.calls)
        i = self.mrl.calls.index(("i01.head.neck", "detach"))
        self.assertEqual(self.mrl.calls[i + 1:i + 3], [("i01.head.neck", "setPin", 1),
                                                       ("i01.head.neck", "attach", "pca_tete")])

    def test_servos_tab_shows_pca_channel(self):
        groups = self.c.get("/api/servos").get_json()["groups"]
        thumb = next(s for g in groups for s in g["servos"] if s["service"] == "i01.rightHand.thumb")
        self.assertEqual(thumb["pca"]["address"], "0x42")


@unittest.skipIf(atelier is None, "Flask non installé")
class AiAndSensorsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        cfg = json.load(open(os.path.join(ROOT, "config.example.json"), encoding="utf-8"))
        cfg["sensors"]["port"] = 1  # aucun serveur : centrale injoignable
        self.cfg_path = os.path.join(self.tmp, "config.json")
        json.dump(cfg, open(self.cfg_path, "w", encoding="utf-8"))
        self.mrl = FakeMrl()
        self.c = atelier.create_app(data_dir=self.tmp, run=FakeRun(), mrl=self.mrl).test_client()
        self.c.put("/api/settings", json={"robot_config": self.cfg_path})

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_sensors_hub_down(self):
        r = self.c.get("/api/sensors")
        self.assertEqual(r.status_code, 502)
        self.assertIn("capteurs injoignable", r.get_json()["error"])
        self.assertEqual(self.c.post("/api/sensors/grip", json={"side": "milieu"}).status_code, 400)

    def test_memory_management(self):
        from memory_store import MemoryStore
        store = MemoryStore(os.path.join(self.tmp, "data", "memory.json"))
        store.add("Paul", "aime le football")
        store.add("Léa", "a un chat")
        info = self.c.get("/api/ai").get_json()
        self.assertEqual([m["person"] for m in info["memory"]], ["Paul", "Léa"])
        self.assertEqual(self.c.delete("/api/ai/memory/0").status_code, 200)
        self.assertEqual(self.c.delete("/api/ai/memory/9").status_code, 400)
        self.assertEqual([m["person"] for m in store.load()], ["Léa"])
        self.c.post("/api/ai/memory/clear")
        self.assertEqual(store.load(), [])

    def test_recorded_gestures(self):
        import gesture_player
        gdir = os.path.join(self.tmp, "data", "gestures")
        gesture_player.save(gdir, "salut", [{"t": 0, "service": "i01.rightArm.bicep", "pos": 40}])
        info = self.c.get("/api/ai").get_json()
        self.assertEqual(info["recorded"], ["salut"])
        r = self.c.post("/api/ai/gestures/salut/play", json={})
        self.assertEqual(r.status_code, 200)
        for _ in range(50):
            if ("i01.rightArm.bicep", "moveTo", 40.0) in self.mrl.calls:
                break
            time.sleep(0.02)
        self.assertIn(("i01.rightArm.bicep", "moveTo", 40.0), self.mrl.calls)
        self.assertEqual(self.c.post("/api/ai/gestures/..%2Fx/play").status_code, 404)
        self.assertEqual(self.c.delete("/api/ai/gestures/salut").status_code, 200)
        self.assertEqual(self.c.get("/api/ai").get_json()["recorded"], [])

    def test_sensor_schema(self):
        v = self.c.get("/api/schema/capteurs").get_json()
        addrs = [d["address"] for d in v["i2c_devices"]]
        self.assertEqual(len(addrs), len(set(addrs)))
        self.assertIn("0x29", addrs)


@unittest.skipIf(atelier is None, "Flask non installé")
class ManualTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.c = atelier.create_app(data_dir=self.tmp, run=FakeRun(), mrl=FakeMrl()).test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_every_chapter_renders(self):
        index = self.c.get("/api/manual").get_json()["chapters"]
        ids = [c["id"] for c in index]
        self.assertEqual(len(ids), len(set(ids)))
        for part in ("tete", "torse", "bras", "mains", "bassin", "jambes", "capteurs"):
            self.assertIn(part, ids)
        all_ = self.c.get("/api/manual/all").get_json()["chapters"]
        self.assertEqual([c["id"] for c in all_], ids)
        for c in all_:
            self.assertTrue(c["blocks"], c["id"])
            for b in c["blocks"]:
                if b["type"] == "links":
                    for l in b["items"]:
                        self.assertTrue(l["url"].startswith("https://"), l["url"])
                if b["type"] in ("schema", "servos", "parts"):
                    self.assertIn("printed", b["view"])
                if b["type"] == "tab":
                    self.assertIn(b["tab"], ("guide", "servos", "schema", "sensors", "ai", "legs", "services"))

    def test_body_part_chapters_are_complete(self):
        for part in ("tete", "bras", "mains", "bassin"):
            types = [b["type"] for b in self.c.get("/api/manual/" + part).get_json()["blocks"]]
            for needed in ("servos", "schema", "parts", "steps", "links"):
                self.assertIn(needed, types, "%s : %s manquant" % (part, needed))

    def test_unknown_chapter(self):
        self.assertEqual(self.c.get("/api/manual/nexiste-pas").status_code, 400)


if __name__ == "__main__":
    unittest.main()
