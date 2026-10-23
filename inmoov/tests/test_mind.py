"""« Raisonnement humain » : vision Coral, environnement, humeur, réflexion, souvenirs (aucun réseau)."""

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice"), os.path.join(ROOT, "vision")]

import scene  # noqa: E402
from episodes import EpisodeStore, summarize, transcript  # noqa: E402
from mind import Mind  # noqa: E402
from mood import Mood  # noqa: E402
from perception import EnvironmentMemory, read_vision  # noqa: E402
from reasoning import choose_effort  # noqa: E402

try:
    import anthropic  # noqa: F401
    from llm_brain import ClaudeBrain, build_tools
except ImportError:  # pragma: no cover
    anthropic = None


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class SceneTest(unittest.TestCase):
    def test_labels_and_positions(self):
        labels = {0: "person", 46: "cup", 11: "n/a", 62: "chair"}
        objs = [(0, 0.9, 280, 100, 360, 470), (46, 0.7, 560, 300, 620, 380), (11, 0.99, 0, 0, 10, 10),
                (62, 0.3, 0, 0, 100, 100)]
        out = scene.summarize_objects(objs, labels, 640, 480, 0.5)
        self.assertEqual([(o["label"], o["side"]) for o in out], [("personne", "au centre"), ("tasse", "à droite")])
        self.assertEqual(len(scene.FRENCH_LABELS), 80)          # les 80 catégories COCO
        self.assertEqual(scene.side_of(0.1), "à gauche")

    def test_state_file_and_pause(self):
        tmp = tempfile.mkdtemp()
        try:
            path = os.path.join(tmp, "v.json")
            scene.write_state(path, {"time": 10.0, "faces": 1})
            self.assertEqual(read_vision(path, 5, now=12.0)["faces"], 1)
            self.assertIsNone(read_vision(path, 5, now=30.0))           # trop ancien
            pause = os.path.join(tmp, "pause")
            self.assertFalse(scene.tracking_paused(pause, time.time()))
            open(pause, "w").close()
            self.assertTrue(scene.tracking_paused(pause, time.time()))
            self.assertFalse(scene.tracking_paused(pause, time.time() + 60))
        finally:
            shutil.rmtree(tmp)


class EnvironmentTest(unittest.TestCase):
    def test_appear_disappear_and_habitual(self):
        tmp = tempfile.mkdtemp()
        try:
            env = EnvironmentMemory(os.path.join(tmp, "env.json"), gone_after_s=30, habitual_min=3, save_every_s=0)
            for t in range(4):
                env.update({"time": 100.0 + t, "faces": 1, "face_height": 0.2,
                            "objects": [{"label": "table", "side": "au centre"}, {"label": "tasse", "side": "à droite"}]})
            env.update({"time": 200.0, "faces": 0, "objects": [{"label": "table", "side": "au centre"}]})
            text = env.describe(now=200.0)
            self.assertIn("table au centre", text)
            self.assertNotIn("tasse à droite", text.split("\n")[0])
            self.assertIn("apparition : tasse (à droite)", text)
            self.assertIn("disparition : tasse", text)
            self.assertIn("Objets habituels de la pièce : table", text)
            self.assertIn("dernier visage vu", text)
            again = EnvironmentMemory(os.path.join(tmp, "env.json"))   # relu depuis le disque
            self.assertIn("table", again.objects)
            self.assertIn("indisponible", again.describe(now=300.0, vision_ok=False))
        finally:
            shutil.rmtree(tmp)


class MoodTest(unittest.TestCase):
    def test_night_battery_and_feel(self):
        clock = Clock()
        m = Mood(clock=clock)
        start = m.state["energie"]
        clock.t += 7200
        m.tick(battery_percent=10, hour=2)
        self.assertLess(m.state["energie"], start - 0.3)
        self.assertIn("fatigué", m.describe())
        m.feel("joie", 1.0)
        self.assertIn("Émotion ressentie récemment : joie", m.describe())
        with self.assertRaises(ValueError):
            m.feel("colère cosmique", 1)
        m.feel("tristesse", 5)                       # intensité bornée à 1
        self.assertGreaterEqual(m.state["joie"], -1.0)


class ReasoningTest(unittest.TestCase):
    def test_choose_effort(self):
        self.assertEqual(choose_effort("Bonjour, ça va ?"), "low")
        for q in ("Pourquoi le ciel est bleu ?", "Tu peux m'expliquer la photosynthèse ?",
                  "Combien font 17 fois 23 ?", "À ton avis, je prends le train ou la voiture ?",
                  "Raconte-moi une histoire de pirates", "Regarde autour de toi"):
            self.assertEqual(choose_effort(q), "high", q)
        self.assertEqual(choose_effort(" ".join(["mot"] * 30)), "high")


class EpisodesTest(unittest.TestCase):
    def test_transcript_and_summary(self):
        msgs = [{"role": "user", "content": "Salut, je m'appelle Léa"},
                {"role": "system", "content": "état", "clear_at": "next_user_message"},
                {"role": "assistant", "content": [SimpleNamespace(type="text", text="Bonjour Léa !")]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]},
                {"role": "user", "content": "J'adore les dinosaures"}]
        self.assertEqual(transcript(msgs), "Personne : Salut, je m'appelle Léa\nRobot : Bonjour Léa !\n"
                                           "Personne : J'adore les dinosaures")
        seen = {}

        def create(**kw):
            seen.update(kw)
            return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(
                type="text", text=json.dumps({"summary": "Tu as parlé dinosaures avec Léa.", "people": ["Léa"]}))])
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        out = summarize(client, "claude-opus-5-5", msgs)
        self.assertEqual(out, {"summary": "Tu as parlé dinosaures avec Léa.", "people": ["Léa"]})
        self.assertEqual(seen["output_config"]["format"]["type"], "json_schema")
        self.assertIsNone(summarize(client, "m", msgs[:3]))          # un seul échange : rien à retenir

        def broken(**kw):
            raise OSError("réseau")
        self.assertIsNone(summarize(SimpleNamespace(messages=SimpleNamespace(create=broken)), "m", msgs))

    def test_store(self):
        tmp = tempfile.mkdtemp()
        try:
            st = EpisodeStore(os.path.join(tmp, "ep.json"))
            st.add("Tu as parlé de météo.", ["Paul"], when=1_800_000_000)
            self.assertFalse(st.add("   ", []))
            self.assertIn("(avec Paul) : Tu as parlé de météo.", st.as_text())
        finally:
            shutil.rmtree(tmp)


def mind_cfg(tmp):
    return {"enabled": True, "vision_state_path": os.path.join(tmp, "vision.json"), "vision_max_age_s": 10,
            "sensors_url": "http://capteurs", "environment_path": os.path.join(tmp, "env.json"),
            "mood_path": os.path.join(tmp, "mood.json"), "episodes_path": os.path.join(tmp, "ep.json"),
            "summarize_in_background": False}


class MindTest(unittest.TestCase):
    def test_situation(self):
        tmp = tempfile.mkdtemp()
        try:
            sensors = {"battery": {"percent": 15.4, "low": True}, "presence": {"distance_mm": 900, "present": True},
                       "touch": {"right.index": 0.6, "right.thumb": 0.1}, "boards": {"pca_tete": {"fault": "surintensité"}}}
            m = Mind(mind_cfg(tmp), sensors_reader=lambda url: sensors)
            scene.write_state(m.cfg["vision_state_path"], {"time": time.time(), "faces": 1, "face_height": 0.4,
                                                           "objects": [{"label": "personne", "side": "au centre"}]})
            m.tick()
            m.on_user_turn()
            text = m.situation()
            for part in ("Nous sommes", "personne au centre", "le plus proche tout près", "batterie 15 % (faible)",
                         "à 0.9 m", "(right.index)", "surintensité sur pca_tete", "Ton humeur", "1 échange"):
                self.assertIn(part, text)
        finally:
            shutil.rmtree(tmp)


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool(id_, name, inp):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def msg(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=list(blocks), stop_details=None)


@unittest.skipIf(anthropic is None, "paquet anthropic non installé")
class BrainWithMindTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            cfg = json.load(f)["brain"]
        self.frame = os.path.join(self.tmp, "frame.jpg")
        self.cfg = dict(cfg, camera_frame_path=self.frame, tracking_pause_path=os.path.join(self.tmp, "pause"),
                        look_around_settle_s=0, look_around_wait_s=0.5)
        self.mind = Mind(mind_cfg(self.tmp), sensors_reader=lambda url: None)
        self.calls, self.spoken, self.requests, self.responses = [], [], [], []
        self.summary_requests = []

        def create(**kw):
            self.requests.append({**kw, "messages": list(kw["messages"])})
            return self.responses.pop(0)

        def summary(**kw):
            self.summary_requests.append(kw)
            return SimpleNamespace(stop_reason="end_turn", content=[text(json.dumps({"summary": "Résumé.", "people": []}))])

        client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)),
                                 messages=SimpleNamespace(create=summary))

        def call(*a):
            self.calls.append(a)
            if a[1] == "moveTo" and a[0] == self.cfg["rothead_service"]:
                with open(self.frame, "wb") as f:     # la caméra « voit » la nouvelle position
                    f.write(b"\xff\xd8vue")
                t = time.time() + 1
                os.utime(self.frame, (t, t))
            return True, None

        self.brain = ClaudeBrain(self.cfg, call, self.spoken.append, client=client, mind=self.mind,
                                 sleep=lambda s: None)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_effort_and_situation_messages(self):
        self.responses = [msg("end_turn", text("Salut !")), msg("end_turn", text("Parce que la lumière bleue diffuse.")),
                          msg("end_turn", text("De rien."))]
        self.brain.ask("Bonjour")
        self.brain.ask("Pourquoi le ciel est bleu ?")
        self.brain.ask("Merci")
        first, second, third = self.requests
        self.assertEqual(first["betas"], ["server-side-fallback-2026-07-01", "mid-conversation-output-config-2026-07-01",
                                          "mid-conversation-system-clear-at-2026-08-21"])
        self.assertEqual(first["output_config"], {"effort": "low"})          # niveau de base constant (cache)
        self.assertEqual([m["role"] for m in first["messages"]], ["user", "system"])
        self.assertEqual(first["messages"][1]["clear_at"], "next_user_message")
        self.assertIn("Nous sommes", first["messages"][1]["content"])
        roles = [m["role"] for m in second["messages"]]
        self.assertEqual(roles, ["user", "system", "assistant", "system", "user", "system"])
        self.assertEqual(second["messages"][3], {"role": "system", "content": [], "output_config": {"effort": "high"}})
        self.assertIn(self.spoken[1], ("Laisse-moi réfléchir.", "Bonne question, je réfléchis.", "Hmm, voyons voir.",
                                       "Attends, je réfléchis un instant."))
        self.assertEqual(third["messages"][-3], {"role": "system", "content": [], "output_config": {"effort": "low"}})
        self.assertIn("Comment tu penses", first["system"])
        self.assertIn("feel", [t["name"] for t in first["tools"]])

    def test_feel_and_look_around(self):
        self.responses = [msg("tool_use", tool("t1", "feel", {"emotion": "joie", "intensity": 0.8}),
                              tool("t2", "look_around", {"question": "Qu'y a-t-il dans la pièce ?"})),
                          msg("end_turn", text("Je vois une table et une fenêtre."))]
        self.assertEqual(self.brain.ask("Regarde autour de toi"), "Je vois une table et une fenêtre.")
        results = self.requests[1]["messages"][-1]["content"]
        self.assertEqual(results[0]["content"], "émotion prise en compte")
        images = [b for b in results[1]["content"] if b["type"] == "image"]
        self.assertEqual(len(images), 3)
        rot = [a[2] for a in self.calls if a[0] == self.cfg["rothead_service"]]
        self.assertEqual(rot, [140.0, 90.0, 40.0, 90.0])                  # gauche, centre, droite, retour
        self.assertFalse(os.path.exists(self.cfg["tracking_pause_path"]))  # suivi de visage rendu
        self.assertIn("joie", self.mind.mood.describe())

    def test_conversation_summary_on_idle_reset(self):
        self.responses = [msg("end_turn", text("Bonjour Léa.")), msg("end_turn", text("Super !")),
                          msg("end_turn", text("Re-bonjour."))]
        self.brain.ask("Je m'appelle Léa")
        self.brain.ask("J'aime le dessin")
        self.brain.last_activity -= self.cfg["reset_after_idle_s"] + 1
        self.brain.ask("Coucou")
        self.assertEqual(len(self.summary_requests), 1)
        self.assertIn("Résumé.", self.requests[-1]["system"])     # souvenir donné à la conversation suivante

    def test_build_tools_without_pause(self):
        names = [t["name"] for t in build_tools(dict(self.cfg, tracking_pause_path=None), None, None)]
        self.assertIn("look", names)
        self.assertNotIn("look_around", names)
        self.assertNotIn("feel", names)


if __name__ == "__main__":
    unittest.main()
