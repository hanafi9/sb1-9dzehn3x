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
    from llm_brain import ClaudeBrain, build_tools
    from memory_store import MemoryStore
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
        cfg = dict(self.cfg, camera_frame_path="/tmp/x.jpg", gestures=["salut"])
        tools = build_tools(cfg, MemoryStore("/tmp/nexiste-pas.json"))
        self.assertEqual([t["name"] for t in tools],
                         ["move_head", "hand", "rest_position", "look", "gesture", "remember"])
        for t in tools:
            self.assertTrue(t["strict"])
            self.assertFalse(t["input_schema"]["additionalProperties"])


@unittest.skipIf(anthropic is None, "paquet anthropic non installé")
class NewToolsTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            self.cfg = json.load(f)["brain"]
        self.tmp = tempfile.mkdtemp()
        self.frame = os.path.join(self.tmp, "frame.jpg")
        self.cfg = dict(self.cfg, camera_frame_path=self.frame, gestures=["salut", "daVinci"])
        self.memory = MemoryStore(os.path.join(self.tmp, "memory.json"))
        self.calls, self.spoken = [], []

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp)

    def make(self, responses):
        client, self.api = fake_client(responses)

        def call(*a):
            self.calls.append(a)
            return True, None

        return ClaudeBrain(self.cfg, call, self.spoken.append, client=client, memory=self.memory)

    def test_look_sends_image(self):
        with open(self.frame, "wb") as f:
            f.write(b"\xff\xd8fakejpeg")
        b = self.make([msg("tool_use", tool("l1", "look", {"question": "que tiens-je ?"})),
                       msg("end_turn", text("Tu tiens une tasse."))])
        b.ask("qu'est-ce que je tiens ?")
        result = self.api.requests[1]["messages"][2]["content"][0]
        self.assertNotIn("is_error", result)
        self.assertEqual(result["content"][0]["type"], "image")
        self.assertEqual(result["content"][0]["source"]["media_type"], "image/jpeg")
        self.assertEqual(self.spoken, ["Tu tiens une tasse."])

    def test_look_refuses_old_or_missing_frame(self):
        b = self.make([msg("tool_use", tool("l1", "look", {"question": "?"})), msg("end_turn", text("Je ne vois rien."))])
        b.ask("tu vois quoi ?")
        self.assertTrue(self.api.requests[1]["messages"][2]["content"][0]["is_error"])
        with open(self.frame, "wb") as f:
            f.write(b"x")
        old = os.path.getmtime(self.frame) - 60
        os.utime(self.frame, (old, old))
        b2 = self.make([msg("tool_use", tool("l2", "look", {"question": "?"})), msg("end_turn", text("..."))])
        b2.ask("et maintenant ?")
        self.assertIn("trop ancienne", self.api.requests[1]["messages"][2]["content"][0]["content"])

    def test_gesture(self):
        b = self.make([msg("tool_use", tool("g1", "gesture", {"name": "salut"})), msg("end_turn", text("Bonjour !"))])
        b.ask("fais coucou")
        self.assertIn(("i01", "execGesture", "salut"), self.calls)

    def test_remember_and_recall_in_next_conversation(self):
        b = self.make([msg("tool_use", tool("r1", "remember", {"person": "Paul", "fact": "aime le football"})),
                       msg("end_turn", text("C'est noté.")),
                       msg("end_turn", text("Bonjour Paul !"))])
        b.ask("je m'appelle Paul et j'aime le foot")
        self.assertEqual(self.memory.load()[0]["person"], "Paul")
        self.assertNotIn("Paul", self.api.requests[0]["system"])
        b.last_activity -= self.cfg["reset_after_idle_s"] + 1
        b.ask("salut")
        self.assertIn("Paul : aime le football", self.api.requests[2]["system"])

    def test_memory_store(self):
        self.assertTrue(self.memory.add("Léa", "a un chat"))
        self.assertFalse(self.memory.add("léa", "A un chat"))
        self.memory.add("Léa", "a 10 ans")
        self.assertEqual(self.memory.as_text(), "- Léa : a un chat ; a 10 ans")
        self.memory.delete(0)
        self.assertEqual(len(self.memory.load()), 1)
        self.memory.clear()
        self.assertEqual(self.memory.load(), [])


class LocalBrainTest(unittest.TestCase):
    def test_ollama_api_and_failure(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        from llm_local import LocalBrain
        seen = []

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                seen.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                data = json.dumps({"message": {"role": "assistant", "content": "Bonjour !"}}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            lb = LocalBrain({"url": "http://127.0.0.1:%d" % srv.server_port, "model": "qwen2.5:1.5b"})
            self.assertEqual(lb.ask("salut"), "Bonjour !")
            path, body = seen[0]
            self.assertEqual(path, "/api/chat")
            self.assertEqual(body["model"], "qwen2.5:1.5b")
            self.assertFalse(body["stream"])
            self.assertEqual(body["messages"][0]["role"], "system")
        finally:
            srv.shutdown()
        dead = LocalBrain({"url": "http://127.0.0.1:1", "model": "x", "timeout_s": 1})
        self.assertIsNone(dead.ask("salut"))
        self.assertEqual(dead.history, [])


if __name__ == "__main__":
    unittest.main()
