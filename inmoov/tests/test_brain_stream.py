"""Réponse de Claude reçue en direct et dite phrase par phrase (voix Piper).

Vrai SDK anthropic, avec un faux serveur (MockTransport) qui renvoie un flux SSE :
aucun appel réseau.
"""

import json
import os
import sys
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

    def make(self, bodies):
        bodies = list(bodies)

        def handler(request):
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
            stream_body([("text", ["Désolé, seul Hanafi peut me faire bouger."])], "end_turn"),
        ])
        b.owner, b.restricted_tools = "Hanafi", {"move_head"}
        b.ask("tourne la tête", speaker="")
        self.assertEqual(self.requests[0]["messages"][-1]["content"], "[Voix inconnue] tourne la tête")
        result = self.requests[1]["messages"][-1]["content"][0]
        self.assertTrue(result["is_error"])
        self.assertIn("réservée à Hanafi", result["content"])
        self.assertFalse(any(e[0] == "geste" for e in self.events))        # la tête n'a pas bougé

    def test_owner_voice_can_move(self):
        b = self.make([
            stream_body([("tool_use", "toolu_1", "move_head", {"rothead": 90, "neck": 90})], "tool_use"),
            stream_body([("text", ["Voilà !"])], "end_turn"),
        ])
        b.owner, b.restricted_tools = "Hanafi", {"move_head"}
        b.ask("tourne la tête", speaker="Hanafi")
        self.assertEqual(self.requests[0]["messages"][-1]["content"], "[Voix de Hanafi] tourne la tête")
        self.assertTrue(any(e[0] == "geste" for e in self.events))

    def test_without_pipeline_no_stream(self):
        self.cfg["stream"] = False
        b = self.make([])
        self.assertFalse(b._streaming())


if __name__ == "__main__":
    unittest.main()
