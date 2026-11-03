"""Bilan de santé de Kamil (app/health.py et /api/check)."""

import os
import shutil
import sys
import tempfile
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "app")]

import health  # noqa: E402


class HealthTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_programs(self):
        status = {"vision": {"label": "Caméras", "installed": True, "running": True},
                  "voice": {"label": "Voix", "installed": True, "running": False},
                  "sensors": {"label": "Capteurs", "installed": False, "running": False, "problem": "venv absent"}}
        out = {c["name"]: c["status"] for c in health.check_programs(status, ["vision"])}
        self.assertEqual(out, {"Caméras": "ok", "Voix": "bad", "Capteurs": "warn"})

    def test_camera_unplugged_and_fresh_image(self):
        frame = os.path.join(self.tmp, "f.jpg")
        open(frame, "w").close()
        cfg = {"vision": {"camera_index": frame, "share_frame_path": frame,
                          "second_camera_index": "/dev/v4l/by-path/n-existe-plus"}}
        out = health.check_vision(cfg, self.tmp, time.time(), "ID 18d1:9302 Google Inc.")
        self.assertEqual([c["status"] for c in out], ["ok", "ok", "bad"])          # Coral, caméra 1, caméra 2
        self.assertIn("by-path", out[2]["fix"])
        self.assertEqual(health.check_vision({}, self.tmp, time.time(), "")[0]["status"], "bad")   # Coral absent

    def test_sound_card(self):
        cards = " 0 [vc4hdmi0       ]: vc4-hdmi\n 2 [AK4571         ]: USB-Audio - AK4571\n"
        self.assertEqual(health.check_sound({}, self.tmp, cards)[0]["status"], "bad")      # pas de ~/.asoundrc : HDMI
        with open(os.path.join(self.tmp, ".asoundrc"), "w") as f:
            f.write('pcm.!default {\n  type plug\n  slave.pcm "hw:AK4571"\n}\n')
        self.assertEqual(health.check_sound({}, self.tmp, cards)[0]["status"], "ok")
        out = health.check_sound({}, self.tmp, " 0 [vc4hdmi0       ]: vc4-hdmi\n")
        self.assertIn("débranchée", out[0]["detail"])

    def test_keys_never_show_values(self):
        out = health.check_keys({"ANTHROPIC_API_KEY": "sk-secret"}, {})
        self.assertEqual(out[0]["detail"], "présente")
        self.assertNotIn("sk-secret", str(out))


try:
    import flask  # noqa: F401
    import app as atelier
except ImportError:  # pragma: no cover
    atelier = None


@unittest.skipIf(atelier is None, "Flask absent")
class CheckApiTest(unittest.TestCase):
    def test_api_check(self):
        tmp = tempfile.mkdtemp()
        try:
            run = lambda cmd, **kw: type("R", (), {"stdout": "ID 18d1:9302\n" if cmd[0] == "lsusb" else "",
                                                  "returncode": 0})()
            c = atelier.create_app(data_dir=tmp, run=run).test_client()
            r = c.get("/api/check").get_json()
            self.assertTrue(r["ok"])
            groups = {x["group"] for x in r["checks"]}
            self.assertTrue({"Programmes", "Vision", "Son", "Kamil"} <= groups)
            self.assertEqual(r["bad"], sum(x["status"] == "bad" for x in r["checks"]))
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
