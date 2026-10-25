"""IA de secours compatible OpenAI (OpenAI, Grok/xAI) : faux serveur local, outil home_assistant."""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "voice")]

from llm_local import LocalBrain  # noqa: E402


class FakeOpenAI(BaseHTTPRequestHandler):
    seen = []
    replies = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeOpenAI.seen.append((self.path, self.headers.get("Authorization"), body))
        status, data = FakeOpenAI.replies.pop(0)
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def answer(text=None, calls=None):
    return 200, {"choices": [{"message": {"role": "assistant", "content": text, "tool_calls": calls}}]}


class FakeHome:
    def __init__(self):
        self.asked = []

    def ask(self, command):
        self.asked.append(command)
        return True, "Allumé"


class OpenAIBackupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeOpenAI)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.cfg = {"api": "openai", "base_url": "http://127.0.0.1:%d/v1" % cls.server.server_port,
                   "model": "grok-test", "api_key_env": "TEST_XAI_KEY", "timeout_s": 5}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        os.environ["TEST_XAI_KEY"] = "cle"
        FakeOpenAI.seen.clear()

    def test_chat(self):
        FakeOpenAI.replies = [answer("Salut ! Je suis Kamil.")]
        brain = LocalBrain(self.cfg, "Kamil")
        self.assertEqual(brain.ask("bonjour"), "Salut ! Je suis Kamil.")
        path, auth, body = FakeOpenAI.seen[-1]
        self.assertEqual((path, auth, body["model"]), ("/v1/chat/completions", "Bearer cle", "grok-test"))
        self.assertEqual(body["messages"][-1], {"role": "user", "content": "bonjour"})
        self.assertNotIn("tools", body)                          # pas de maison branchée

    def test_home_assistant_tool(self):
        FakeOpenAI.replies = [
            answer(calls=[{"id": "c1", "type": "function",
                           "function": {"name": "home_assistant", "arguments": '{"command": "allume le lustre"}'}}]),
            answer("Et voilà, le lustre brille !"),
        ]
        brain = LocalBrain(self.cfg, "Kamil")
        brain.home = FakeHome()
        self.assertEqual(brain.ask("allume le lustre"), "Et voilà, le lustre brille !")
        self.assertEqual(brain.home.asked, ["allume le lustre"])
        second = FakeOpenAI.seen[-1][2]["messages"]
        self.assertEqual(second[-1], {"role": "tool", "tool_call_id": "c1", "content": "Allumé"})
        self.assertEqual(len(brain.history), 2)                  # question + réponse finale seulement

    def test_errors_give_none(self):
        FakeOpenAI.replies = [(404, {"error": {"message": "The model `grok-test` does not exist"}})]
        brain = LocalBrain(self.cfg, "Kamil")
        self.assertIsNone(brain.ask("bonjour"))
        self.assertEqual(brain.history, [])
        os.environ.pop("TEST_XAI_KEY")
        self.assertIsNone(brain.ask("bonjour"))                  # clé absente


if __name__ == "__main__":
    unittest.main()
