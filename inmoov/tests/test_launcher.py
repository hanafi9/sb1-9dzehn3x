"""Atelier : lancer et arrêter les programmes du robot sans systemd (vrais processus, faux programmes)."""

import os
import shutil
import sys
import tempfile
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "app")]

import launcher  # noqa: E402

FAKE_PROGRAM = """import os, sys, time
print("démarré", sys.argv[1:], "clé :", "oui" if os.environ.get("FAKE_KEY") == "abc" else "non", flush=True)
while True:
    time.sleep(0.1)
"""


class LauncherTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, ".venv-vision", "bin"))
        # le « Python » de l'environnement : un lien vers celui qui fait tourner les tests
        os.symlink(sys.executable, os.path.join(self.root, ".venv-vision", "bin", "python"))
        os.makedirs(os.path.join(self.root, "vision"))
        with open(os.path.join(self.root, "vision", "face_tracker.py"), "w") as f:
            f.write(FAKE_PROGRAM)
        with open(os.path.join(self.root, "anthropic.env"), "w") as f:
            f.write("FAKE_KEY='abc'\n\n# commentaire\nAUTRE=1\n")
        self.l = launcher.Launcher(self.root, os.path.join(self.root, "logs"),
                                   config_path=lambda: "/chemin/config.json")

    def tearDown(self):
        self.l.stop("vision", timeout=3)
        shutil.rmtree(self.root, ignore_errors=True)

    def wait_log(self, text, timeout=5):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if text in self.l.logs("vision"):
                return True
            time.sleep(0.05)
        return False

    def test_start_logs_and_stop(self):
        st = self.l.status()
        self.assertFalse(st["vision"]["running"])
        self.assertTrue(st["vision"]["installed"])
        self.assertFalse(st["voice"]["installed"])                     # .venv-voice absent
        self.assertIn(".venv-voice", st["voice"]["problem"])
        self.assertEqual(self.l.start("vision"), "démarré")
        self.assertTrue(self.wait_log("démarré"))
        log = self.l.logs("vision")
        self.assertIn("'--config', '/chemin/config.json'", log)
        self.assertIn("clé : oui", log)                                  # anthropic.env lu, guillemets retirés
        self.assertTrue(self.l.status()["vision"]["running"])
        self.assertEqual(self.l.start("vision"), "déjà en marche")      # jamais deux fois (caméra, micro)
        self.assertEqual(self.l.stop("vision", timeout=3), "arrêté")
        self.assertFalse(self.l.status()["vision"]["running"])
        self.assertEqual(self.l.stop("vision"), "déjà arrêté")
        self.l.start("vision")
        self.assertTrue(self.wait_log("démarré"))
        self.assertTrue(os.path.exists(os.path.join(self.root, "logs", "vision.log.1")))   # ancien journal gardé

    def test_missing_program_and_unknown(self):
        with self.assertRaises(ValueError):
            self.l.start("voice")
        with self.assertRaises(ValueError):
            self.l.start("inconnu")
        with self.assertRaises(ValueError):
            self.l.start("mrl")                                         # myrobotlab.sh introuvable
        self.assertIn("Pas encore de journal", self.l.logs("sensors"))

    def test_myrobotlab(self):
        mrl = os.path.join(self.root, "myrobotlab-1.1.1500")
        os.makedirs(mrl)
        with open(os.path.join(mrl, "myrobotlab.sh"), "w") as f:
            f.write("#!/bin/bash\n")
        l = launcher.Launcher(self.root, os.path.join(self.root, "logs"), config_path=lambda: "",
                              mrl_dir=lambda: mrl, mrl_args=lambda: "--config inmoov2")
        argv, folder = l.command("mrl")
        self.assertEqual((argv[1:], folder), ([os.path.join(mrl, "myrobotlab.sh"), "--config", "inmoov2"], mrl))
        self.assertTrue(l._matches("mrl", ["/usr/bin/java", "-jar", "/home/x/myrobotlab-1.1/myrobotlab.jar"]))
        self.assertFalse(l._matches("mrl", ["/usr/bin/java", "-jar", "autre.jar"]))
        self.assertTrue(l._matches("voice", ["../.venv-voice/bin/python", "speech_listener.py", "--config", "x"]))
        self.assertFalse(l._matches("voice", ["nano", "speech_listener.py"]))

    def test_env_file(self):
        env = launcher.read_env_file(os.path.join(self.root, "anthropic.env"))
        self.assertEqual(env, {"FAKE_KEY": "abc", "AUTRE": "1"})


if __name__ == "__main__":
    unittest.main()
