"""Réponse de Claude reçue en direct et dite phrase par phrase (voix Piper).

Vrai SDK anthropic, avec un faux serveur (MockTransport) qui renvoie un flux SSE :
aucun appel réseau.
"""

import json
import os
import sys
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import anthropic
    import httpx2 as httpx
    from llm_brain import ClaudeBrain
except ImportError:  # pragma: no cover
    anthropic = None


def sse(events):
    return "".join("event: %s\ndata: %s\n\n" % (e["type"], json.dumps(e)) for e in events).encode("utf-8")


def stream_body(blocks, stop_reason):
    """blocks : liste de ("text", [morceaux]) ou ("tool_use", id, nom, entrée)."""
    events = [{"type": "message_start", "message": {
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
        "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 0}}}]
    for i, b in enumerate(blocks):
        if b[0] == "text":
            events.append({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            for chunk in b[1]:
                events.append({"type": "content_block_delta", "index": i,
                               "delta": {"type": "text_delta", "text": chunk}})
        else:
            events.append({"type": "content_block_start", "index": i,
                           "content_block": {"type": "tool_use", "id": b[1], "name": b[2], "input": {}}})
            events.append({"type": "content_block_delta", "index": i,
                           "delta": {"type": "input_json_delta", "partial_json": json.dumps(b[3])}})
        events.append({"type": "content_block_stop", "index": i})
    events.append({"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None},
                   "usage": {"output_tokens": 20}})
    events.append({"type": "message_stop"})
    return sse(events)


@unittest.skipIf(anthropic is None, "paquet anthropic non installé")
class StreamTest(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)["brain"]
        self.cfg["adaptive_effort"] = False
        self.events = []      # ordre des paroles et des gestes
        self.requests = []

    def make(self, bodies, delay=0.0):
        bodies = list(bodies)

        def handler(request):
            time.sleep(delay)   # Claude « réfléchit » avant d'envoyer sa réponse
            self.requests.append(json.loads(request.content))
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=bodies.pop(0))

        client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(handler)))

        def call(*a):
            self.events.append(("geste",) + a)
            return True, None

        return ClaudeBrain(self.cfg, call, lambda t: self.events.append(("dit (bloquant)", t)), client=client,
                           say_async=lambda t: self.events.append(("dit", t)),
                           wait_speech=lambda: self.events.append(("attend",)))

    def test_sentences_spoken_as_they_arrive(self):
        b = self.make([stream_body([("text", ["Bonjour ! Je suis ", "Kamil, ton robot. Le ciel est ",
                                              "bleu à cause de la lumière."])], "end_turn")])
        said = b.ask("bonjour")
        self.assertEqual(said, "Bonjour ! Je suis Kamil, ton robot. Le ciel est bleu à cause de la lumière.")
        self.assertEqual(self.events, [("dit", "Bonjour ! Je suis Kamil, ton robot."),
                                       ("dit", "Le ciel est bleu à cause de la lumière."), ("attend",)])
        self.assertTrue(self.requests[0]["stream"])
        self.assertEqual(self.requests[0]["fallbacks"], "default")

    def test_text_before_tool_is_said_before_gesture(self):
        b = self.make([
            stream_body([("text", ["Je tourne la tête vers toi."]),
                         ("tool_use", "toolu_1", "move_head", {"rothead": 90, "neck": 90})], "tool_use"),
            stream_body([("text", ["Voilà, je te vois bien !"])], "end_turn"),
        ])
        b.ask("regarde-moi")
        kinds = [e[0] for e in self.events]
        self.assertEqual(self.events[0], ("dit", "Je tourne la tête vers toi."))
        self.assertLess(kinds.index("dit"), kinds.index("geste"))
        self.assertEqual(self.events[-2:], [("dit", "Voilà, je te vois bien !"), ("attend",)])
        # le résultat de l'outil est bien renvoyé à Claude au 2e tour
        last = self.requests[1]["messages"][-1]
        self.assertEqual(last["content"][0]["type"], "tool_result")
        self.assertEqual(last["content"][0]["tool_use_id"], "toolu_1")

    def test_notice_is_marked_and_quick(self):
        self.cfg["adaptive_effort"] = True
        b = self.make([stream_body([("text", ["Bonjour ! Comment tu t'appelles ?"])], "end_turn")])
        b.effort = "high"   # la question d'avant demandait de réfléchir
        said = b.notice("Une personne vient d'apparaître devant toi, à distance de conversation.")
        self.assertEqual(said, "Bonjour ! Comment tu t'appelles ?")
        msgs = self.requests[0]["messages"]
        self.assertEqual(msgs[-2], {"role": "system", "content": [], "output_config": {"effort": "low"}})
        self.assertTrue(msgs[-1]["content"].startswith("[Tes caméras remarquent] Une personne"))
        self.assertNotIn(("dit", "Laisse-moi réfléchir."), self.events)
        self.assertEqual(self.events[-1], ("attend",))

    def test_speaker_and_owner_only_tools(self):
        b = self.make([
            stream_body([("tool_use", "toolu_1", "move_head", {"rothead": 90, "neck": 90})], "tool_use"),
            stream_body([("text", ["Désolé, seul Sam peut me faire bouger."])], "end_turn"),
        ])
        b.owner, b.restricted_tools = "Sam", {"move_head"}
        b.ask("tourne la tête", speaker="")
        self.assertEqual(self.requests[0]["messages"][-1]["content"], "[Voix inconnue] tourne la tête")
        result = self.requests[1]["messages"][-1]["content"][0]
        self.assertTrue(result["is_error"])
        self.assertIn("réservée à Sam", result["content"])
        self.assertFalse(any(e[0] == "geste" for e in self.events))        # la tête n'a pas bougé

    def test_owner_voice_can_move(self):
        b = self.make([
            stream_body([("tool_use", "toolu_1", "move_head", {"rothead": 90, "neck": 90})], "tool_use"),
            stream_body([("text", ["Voilà !"])], "end_turn"),
        ])
        b.owner, b.restricted_tools = "Sam", {"move_head"}
        b.ask("tourne la tête", speaker="Sam")
        self.assertEqual(self.requests[0]["messages"][-1]["content"], "[Voix de Sam] tourne la tête")
        self.assertTrue(any(e[0] == "geste" for e in self.events))

    def test_filler_when_claude_is_slow(self):
        from reasoning import FILLERS
        self.cfg["filler_after_s"] = 0.05
        b = self.make([stream_body([("text", ["Il est midi pile."])], "end_turn")], delay=0.3)
        b.ask("quelle heure est-il")
        said = [e[1] for e in self.events if e[0] == "dit"]
        self.assertIn(said[0], FILLERS)                       # « Alors… » pendant l'attente
        self.assertEqual(said[1:], ["Il est midi pile."])

    def test_no_filler_when_fast_or_for_camera_events(self):
        self.cfg["filler_after_s"] = 0.2
        b = self.make([stream_body([("text", ["Coucou !"])], "end_turn")])
        b.ask("salut")
        self.assertEqual([e[1] for e in self.events if e[0] == "dit"], ["Coucou !"])
        self.events.clear()
        self.cfg["filler_after_s"] = 0.05
        b = self.make([stream_body([("text", ["Oh, bonjour toi !"])], "end_turn")], delay=0.3)
        b.notice("Une personne vient d'apparaître.")
        self.assertEqual([e[1] for e in self.events if e[0] == "dit"], ["Oh, bonjour toi !"])

    def test_home_assistant_tool(self):
        self.cfg["home_assistant"] = {"enabled": True, "url": "http://ha.local:8123"}
        b = self.make([
            stream_body([("tool_use", "toolu_1", "home_assistant", {"command": "allume la lumière du salon"})],
                        "tool_use"),
            stream_body([("text", ["Et la lumière fut !"])], "end_turn"),
        ])
        sent = []
        b.home = type("H", (), {"ask": lambda self, t: sent.append(t) or (True, "Lumière du salon allumée")})()
        b.ask("allume le salon")
        self.assertIn("home_assistant", [t["name"] for t in self.requests[0]["tools"]])
        self.assertEqual(sent, ["allume la lumière du salon"])
        result = self.requests[1]["messages"][-1]["content"][0]
        self.assertEqual(result["content"], "Lumière du salon allumée")
        self.assertNotIn("is_error", result)

    def test_surveillance_tool(self):
        self.cfg["watch"] = {"enabled": True}
        b = self.make([
            stream_body([("tool_use", "toolu_1", "surveillance", {"action": "journal", "hours": 3})], "tool_use"),
            stream_body([("text", ["Rien de spécial, à part toi à midi."])], "end_turn"),
        ])
        b.watcher = type("W", (), {"journal_text": lambda self, h: "12 h 00 : Arrivée : une personne devant moi"})()
        b.ask("il s'est passé quoi ?")
        self.assertIn("surveillance", [t["name"] for t in self.requests[0]["tools"]])
        self.assertIn("12 h 00 : Arrivée", self.requests[1]["messages"][-1]["content"][0]["content"])

    def test_silence_for_tv(self):
        self.cfg["adaptive_effort"] = True
        self.cfg["filler_after_s"] = 0.05
        b = self.make([stream_body([("text", ["[silence]"])], "end_turn")], delay=0.3)
        said = b.ask("le gouvernement a annoncé de nouvelles mesures pour les commerçants pourquoi", direct=False)
        self.assertEqual(said, "")
        self.assertEqual([e for e in self.events if e[0] == "dit"], [])     # ni « Alors… » ni réflexion
        msg = self.requests[0]["messages"][-1]["content"]
        self.assertTrue(msg.startswith("[Sans ton prénom : peut-être pas pour toi] "))
        self.assertIn("[silence]", self.requests[0]["system"][0]["text"] if isinstance(
            self.requests[0]["system"], list) else self.requests[0]["system"])

    def test_out_of_credit_is_said_clearly(self):
        body = json.dumps({"type": "error", "error": {"type": "invalid_request_error", "message":
                           "Your credit balance is too low to access the Anthropic API."}})
        client = anthropic.Anthropic(api_key="test", max_retries=0, http_client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(400, content=body,
                                                                   headers={"content-type": "application/json"}))))
        b = ClaudeBrain(self.cfg, lambda *a: (True, None), lambda t: self.events.append(("dit (bloquant)", t)),
                        client=client)
        self.assertEqual(b.ask("bonjour"), "crédit épuisé")         # pas de chatbot de secours ensuite
        self.assertIn("recharger le compte Anthropic", self.events[-1][1])
        b.ask("tu m'entends ?")
        self.assertEqual(self.events[-1][1], "Toujours plus de crédit, désolé.")
        b.has_backup = True                                         # OpenAI / Grok prend le relais
        n = len(self.events)
        self.assertIsNone(b.ask("et maintenant ?"))
        self.assertEqual(len(self.events), n)                       # rien dit, pas de nouvel appel à Claude

    def test_no_silence_when_called_by_name(self):
        b = self.make([stream_body([("text", ["[silence]"])], "end_turn")])
        said = b.ask("sait bien")
        self.assertIn("répéter", said)
        self.assertIn(("dit (bloquant)", "Pardon, je n'ai pas bien compris. Tu peux répéter ?"), self.events)

    def test_without_pipeline_no_stream(self):
        self.cfg["stream"] = False
        b = self.make([])
        self.assertFalse(b._streaming())


if __name__ == "__main__":
    unittest.main()
