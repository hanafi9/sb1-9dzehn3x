"""Tests du cerveau Claude avec un faux client (aucun appel réseau).

Nécessite le paquet anthropic (pip install -r voice/requirements.txt).
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

try:
    import anthropic  # noqa: F401
    from llm_brain import TOOLS, ClaudeBrain
except ImportError:  # pragma: no cover
    anthropic = None


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool(id_, name, inp):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=inp)


def msg(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=list(blocks), stop_details=None)


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def create(self, **kw):
        self.requests.append({**kw, "messages": list(kw["messages"])})
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def fake_client(responses):
    messages = FakeMessages(responses)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


@unittest.skipIf(anthropic is None, "paquet anthropic non installé")
class BrainTest(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)["brain"]
        self.calls, self.spoken = [], []

    def make(self, responses):
        client, self.api = fake_client(responses)

        def call(*a):
            self.calls.append(a)
            return True, None

        return ClaudeBrain(self.cfg, call, self.spoken.append, client=client)

    def test_simple_answer(self):
        b = self.make([msg("end_turn", text("Bonjour ! Je suis InMoov."))])
        self.assertEqual(b.ask("bonjour"), "Bonjour ! Je suis InMoov.")
        self.assertEqual(self.spoken, ["Bonjour ! Je suis InMoov."])
        req = self.api.requests[0]
        self.assertEqual(req["model"], "claude-opus-5-5")
        self.assertEqual(req["fallbacks"], "default")
        self.assertEqual(req["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(req["output_config"], {"effort": "low"})
        self.assertNotIn("thinking", req)

    def test_tool_call_is_clamped_and_looped(self):
        b = self.make([
            msg("tool_use", text("Je regarde à gauche."), tool("t1", "move_head", {"rothead": 400, "neck": 90})),
            msg("end_turn", text("Voilà.")),
        ])
        b.ask("regarde tout à gauche")
        self.assertEqual(self.calls, [("i01.head.rothead", "moveTo", 150.0), ("i01.head.neck", "moveTo", 90.0)])
        self.assertEqual(self.spoken, ["Je regarde à gauche.", "Voilà."])
        # 2e requête : historique en ajout seul, avec le résultat de l'outil
        second = self.api.requests[1]["messages"]
        self.assertEqual([m["role"] for m in second], ["user", "assistant", "user"])
        self.assertEqual(second[2]["content"][0]["tool_use_id"], "t1")
        self.assertNotIn("is_error", second[2]["content"][0])

    def test_hand_and_unknown_tool(self):
        b = self.make([
            msg("tool_use", tool("a", "hand", {"side": "right", "action": "open"}), tool("b", "fly", {})),
            msg("end_turn", text("Ma main est ouverte, mais je ne sais pas voler.")),
        ])
        b.ask("ouvre la main et vole")
        self.assertEqual(self.calls, [("i01.rightHand", "open")])
        results = self.api.requests[1]["messages"][2]["content"]
        self.assertEqual(len(results), 2)  # tous les résultats dans un seul message
        self.assertTrue(results[1]["is_error"])

    def test_refusal_resets(self):
        b = self.make([msg("refusal")])
        b.ask("question interdite")
        self.assertEqual(b.messages, [])
        self.assertEqual(len(self.spoken), 1)

    def test_connection_error_returns_none_for_fallback(self):
        import httpx2

        err = anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com"))
        b = self.make([err])
        self.assertIsNone(b.ask("bonjour"))
        self.assertEqual(b.messages, [])

    def test_conversation_memory_and_idle_reset(self):
        b = self.make([msg("end_turn", text("Enchanté Paul.")), msg("end_turn", text("Tu es Paul.")),
                       msg("end_turn", text("Bonjour !"))])
        b.ask("je m'appelle Paul")
        b.ask("comment je m'appelle ?")
        self.assertEqual(len(self.api.requests[1]["messages"]), 3)
        b.last_activity -= self.cfg["reset_after_idle_s"] + 1
        b.ask("salut")
        self.assertEqual(len(self.api.requests[2]["messages"]), 1)

    def test_tool_schemas_are_strict(self):
        for t in TOOLS:
            self.assertTrue(t["strict"])
            self.assertFalse(t["input_schema"]["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
