"""Pont entre la voix de Kamil et l'onglet « Kamil » de l'Atelier."""

import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from kamil_bridge import Bridges, LocalBridge, send_command  # noqa: E402


class FakeMqtt:
    def __init__(self):
        self.seen = []
        self.commands = None
        self.guard_state = None

    def state(self, s):
        self.seen.append(("etat", s))

    def publish(self, k, v):
        self.seen.append((k, v))

    def guard(self, on):
        self.seen.append(("garde", on))


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.now = 1000.0
        self.cfg = {"state_path": os.path.join(self.dir, "kamil.json"), "commands_dir": os.path.join(self.dir, "cmd"),
                    "history": 3}
        self.b = LocalBridge(self.cfg, clock=lambda: self.now)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def read(self):
        with open(self.cfg["state_path"], encoding="utf-8") as f:
            return json.load(f)

    def test_state_and_conversation(self):
        self.b.guard_state = lambda: True
        self.b.state("thinking")
        self.b.publish("entendu", "Kamil, quelle heure est-il ?")
        self.b.publish("reponse", "Il est midi pile !")
        self.b.publish("voix", "Hanafi")
        d = self.read()
        self.assertEqual((d["etat"], d["voix"], d["garde"], d["updated"]), ("thinking", "Hanafi", True, 1000.0))
        self.assertEqual([(m["qui"], m["texte"]) for m in d["history"]],
                         [("toi", "Kamil, quelle heure est-il ?"), ("kamil", "Il est midi pile !")])
        for i in range(3):
            self.b.publish("reponse", "phrase %d" % i)
        self.assertEqual(len(self.read()["history"]), 3)                    # historique limité

    def test_commands_from_the_atelier(self):
        send_command("question", "Raconte une blague", self.cfg["commands_dir"], clock=lambda: self.now)
        send_command("garde", True, self.cfg["commands_dir"], clock=lambda: self.now + 0.01)
        send_command("dire", "trop vieux", self.cfg["commands_dir"], clock=lambda: self.now - 500)
        with self.assertRaises(ValueError):
            send_command("effacer", "x", self.cfg["commands_dir"])
        self.b.poll()
        got = [self.b.commands.get_nowait() for _ in range(self.b.commands.qsize())]
        self.assertEqual(got, [("question", "Raconte une blague"), ("garde", True)])   # vieil ordre ignoré
        self.assertEqual(os.listdir(self.cfg["commands_dir"]), [])                       # fichiers consommés

    def test_bridges_share_one_queue(self):
        bridges = Bridges()
        local = bridges.add(self.b)
        mqtt = bridges.add(FakeMqtt())
        bridges.set_guard_state(lambda: False)
        self.assertIs(local.commands, mqtt.commands)
        bridges.state("speaking")
        bridges.publish("reponse", "Coucou")
        self.assertEqual(mqtt.seen, [("etat", "speaking"), ("reponse", "Coucou")])
        self.assertEqual(self.read()["etat"], "speaking")
        send_command("dire", "Bonjour", self.cfg["commands_dir"], clock=lambda: self.now)
        bridges.poll()
        self.assertEqual(bridges.commands.get_nowait(), ("dire", "Bonjour"))


if __name__ == "__main__":
    unittest.main()
