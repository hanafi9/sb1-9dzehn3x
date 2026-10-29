"""Onglet « Banc d'essai » de l'Atelier : caméras, voix, haut-parleurs, micro, servos (sans matériel)."""

import array
import json
import os
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
    import bench
except ImportError:  # pragma: no cover
    atelier = None


class FakeMrl:
    def __init__(self):
        self.up = True
        self.calls = []

    def call_checked(self, service, method, *params):
        self.calls.append((service, method) + params)
        return (True, None) if self.up else (False, None)

    def call(self, *a):
        return self.call_checked(*a)[1]


class Run:
    """Faux subprocess.run : pgrep, aplay, arecord, Python de la voix."""

    def __init__(self, voice_running=False):
        self.calls, self.voice_running = [], voice_running

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        out, rc = "", 0
        if cmd[0] == "pgrep":
            running = self.voice_running and cmd[-1] == "speech_listener.py"
            out, rc = ("1234\n", 0) if running else ("", 1)
        elif cmd[0] == "arecord":
            out = array.array("h", [0, 16384, -8192, 0] * 100).tobytes()
        elif cmd[0] == "lsusb":
            out = "ID 18d1:9302 Google Inc.\n"
        return subprocess.CompletedProcess(cmd, rc, out, b"" if cmd[0] == "arecord" else "")


@unittest.skipIf(atelier is None, "Flask non installé")
class BenchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.frame = os.path.join(self.tmp, "frame.jpg")
        self.state = os.path.join(self.tmp, "vision.json")
        cfg = {"vision": {"share_frame_path": self.frame, "share_frame2_path": os.path.join(self.tmp, "f2.jpg"),
                          "state_path": self.state, "second_camera_index": None},
               "voice": {"piper_model": os.path.join(self.tmp, "voix.onnx")}}
        path = os.path.join(self.tmp, "config.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
        self.mrl, self.run = FakeMrl(), Run()
        self.c = atelier.create_app(data_dir=self.tmp, run=self.run, mrl=self.mrl).test_client()
        self.c.put("/api/settings", json={"robot_config": path})

    def test_state_without_vision(self):
        s = self.c.get("/api/bench/state").get_json()
        self.assertTrue(s["mrl"])
        self.assertFalse(s["voice"])
        self.assertIsNone(s["vision"])
        self.assertEqual([c["live"] for c in s["cameras"]], [False, False])
        self.assertEqual(self.c.get("/api/bench/camera/0.jpg").status_code, 404)

    def test_camera_and_vision_state(self):
        with open(self.frame, "wb") as f:
            f.write(b"\xff\xd8jpeg")
        with open(self.state, "w", encoding="utf-8") as f:
            json.dump({"time": time.time(), "faces": 1, "face_boxes": [[0.1, 0.1, 0.3, 0.4, 0.9]], "objects": []}, f)
        s = self.c.get("/api/bench/state").get_json()
        self.assertTrue(s["cameras"][0]["live"])
        self.assertTrue(s["vision"]["fresh"])
        r = self.c.get("/api/bench/camera/0.jpg")
        self.assertEqual((r.status_code, r.mimetype, r.data), (200, "image/jpeg", b"\xff\xd8jpeg"))
        self.assertEqual(self.c.get("/api/bench/camera/7.jpg").status_code, 404)

    def test_results_color_the_robot(self):
        r = self.c.put("/api/bench/results/i01.head.jaw", json={"result": "ok"}).get_json()
        self.assertEqual(r["results"], {"i01.head.jaw": "ok"})
        r = self.c.put("/api/bench/results/i01.head.jaw", json={"result": ""}).get_json()
        self.assertEqual(r["results"], {})
        self.assertEqual(self.c.put("/api/bench/results/i01.bidon", json={"result": "ok"}).status_code, 400)
        self.assertEqual(self.c.put("/api/bench/results/i01.head.jaw", json={"result": "?"}).status_code, 400)

    def test_all_rest_and_stop(self):
        self.assertTrue(self.c.post("/api/bench/all/rest").get_json()["ok"])
        self.assertIn(("i01.head.rothead", "rest"), self.mrl.calls)
        self.c.post("/api/bench/all/disable")
        self.assertIn(("i01.rightHand.thumb", "disable"), self.mrl.calls)
        self.mrl.up = False
        r = self.c.post("/api/bench/all/rest").get_json()
        self.assertFalse(r["ok"])
        self.assertEqual(len(r["errors"]), 1)

    def test_speakers(self):
        self.assertTrue(self.c.post("/api/bench/speaker", json={"side": "left"}).get_json()["ok"])
        self.assertEqual(self.run.calls[-1], ["aplay", "-q", "/usr/share/sounds/alsa/Front_Left.wav"])
        self.assertEqual(self.c.post("/api/bench/speaker", json={"side": "haut"}).status_code, 400)

    def test_speak_needs_voice_install(self):
        r = self.c.post("/api/bench/speak", json={"text": "Bonjour"})
        self.assertEqual(r.status_code, 400)   # Python de la voix ou modèle Piper absent ici
        self.assertEqual(self.c.post("/api/bench/speak", json={"text": "  "}).status_code, 400)

    def test_piper_command(self):
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, ".venv-voice", "bin"))
        os.makedirs(os.path.join(root, "models"))
        for p in (".venv-voice/bin/python", "models/fr_FR-tom-medium.onnx"):
            open(os.path.join(root, p), "w").close()
        cmd = bench.piper_command(root, {"voice": {"piper_model": "models/fr_FR-tom-medium.onnx",
                                                   "piper_speaker_id": 3}}, "Salut")
        self.assertEqual(cmd[0], os.path.join(root, ".venv-voice", "bin", "python"))
        self.assertEqual(cmd[-4:-1], [os.path.join(root, "voice"), os.path.join(root, "models/fr_FR-tom-medium.onnx"),
                                      "Salut"])
        self.assertEqual(json.loads(cmd[-1]), {"length_scale": None, "speaker_id": 3})   # même voix que le robot

    def test_mic(self):
        r = self.c.post("/api/bench/mic").get_json()
        self.assertEqual(r["peak"], 50.0)
        busy = atelier.create_app(data_dir=self.tmp, run=Run(voice_running=True), mrl=self.mrl).test_client()
        r = busy.post("/api/bench/mic")
        self.assertEqual(r.status_code, 400)
        self.assertIn("utilisé par la voix", r.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
