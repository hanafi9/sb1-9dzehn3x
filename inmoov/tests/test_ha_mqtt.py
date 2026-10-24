"""Kamil dans Home Assistant par MQTT : découverte, états, commandes, caméras (faux client MQTT)."""

import json
import os
import sys
import tempfile
import time
import types
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from ha_mqtt import KamilMQTT  # noqa: E402


class FakeClient:
    def __init__(self):
        self.published, self.subscribed = [], []

    def publish(self, topic, payload, retain=False):
        self.published.append((topic, payload, retain))

    def subscribe(self, topic):
        self.subscribed.append(topic)

    def get(self, topic):
        return [p for t, p, r in self.published if t == topic]


def message(topic, payload):
    return types.SimpleNamespace(topic=topic, payload=payload.encode("utf-8"))


class KamilMQTTTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.ha = KamilMQTT({"enabled": True}, client=self.client)

    def test_discovery_creates_the_kamil_device(self):
        self.ha.guard_state = lambda: True
        self.ha._on_connect(self.client, None, {}, 0, None)
        configs = {t: json.loads(p) for t, p, r in self.client.published if t.endswith("/config")}
        self.assertIn("homeassistant/switch/kamil/garde/config", configs)
        self.assertIn("homeassistant/notify/kamil/dire/config", configs)
        self.assertIn("homeassistant/camera/kamil/camera2/config", configs)
        sw = configs["homeassistant/switch/kamil/garde/config"]
        self.assertEqual((sw["command_topic"], sw["state_topic"]), ("kamil/garde/set", "kamil/garde"))
        self.assertEqual(sw["device"]["name"], "Kamil")
        self.assertTrue(all(r for t, p, r in self.client.published if t.endswith("/config")))   # gardées
        self.assertEqual(self.client.get("kamil/disponible"), ["online"])
        self.assertEqual(self.client.get("kamil/garde"), ["ON"])
        self.assertIn("kamil/dire", self.client.subscribed)
        self.assertIn("homeassistant/status", self.client.subscribed)

    def test_refused_connection_announces_nothing(self):
        self.ha._on_connect(self.client, None, {}, 5, None)
        self.assertEqual(self.client.published, [])

    def test_commands_go_to_the_listening_loop(self):
        self.ha._on_message(self.client, None, message("kamil/dire", "Le linge est sec !"))
        self.ha._on_message(self.client, None, message("kamil/question", "Quelle heure est-il ?"))
        self.ha._on_message(self.client, None, message("kamil/garde/set", "ON"))
        self.ha._on_message(self.client, None, message("kamil/dire", "  "))          # vide : ignoré
        got = [self.ha.commands.get_nowait() for _ in range(self.ha.commands.qsize())]
        self.assertEqual(got, [("dire", "Le linge est sec !"), ("question", "Quelle heure est-il ?"),
                               ("garde", True)])

    def test_home_assistant_restart_reannounces(self):
        self.ha.state("thinking")
        self.client.published.clear()
        self.ha._on_message(self.client, None, message("homeassistant/status", "online"))
        self.assertTrue(any(t.endswith("/config") for t, p, r in self.client.published))
        self.assertEqual(self.client.get("kamil/etat"), ["réfléchit"])            # dernier état republié

    def test_states_sent_only_when_they_change(self):
        self.ha.state("idle")
        self.ha.state("idle")
        self.ha.state("speaking")
        self.assertEqual(self.client.get("kamil/etat"), ["en veille", "parle"])

    def test_vision_and_cameras(self):
        d = tempfile.mkdtemp()
        vision = os.path.join(d, "vision.json")
        with open(vision, "w") as f:
            json.dump({"time": time.time(), "faces": 1, "people": 2, "motion": {"level": 0.0},
                       "camera2": {"motion": {"level": 0.08}}}, f)
        frame = os.path.join(d, "frame.jpg")
        with open(frame, "wb") as f:
            f.write(b"\xff\xd8image")
        ha = KamilMQTT({"frame_paths": [frame, os.path.join(d, "absente.jpg")]}, vision, client=self.client)
        ha.poll_vision()
        ha.poll_cameras()
        ha.poll_cameras()                                                             # même image : pas renvoyée
        self.assertEqual(self.client.get("kamil/personnes"), ["2"])
        self.assertEqual(self.client.get("kamil/mouvement"), ["ON"])
        self.assertEqual(self.client.get("kamil/camera1"), [b"\xff\xd8image"])
        self.assertEqual(self.client.get("kamil/camera2"), [])


if __name__ == "__main__":
    unittest.main()
