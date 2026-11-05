"""Garde-fou : deux méthodes du même nom dans une classe, la seconde efface la première sans erreur
(c'est arrivé : la bouche avait pris le nom du rappel du micro, Kamil n'entendait plus rien)."""

import ast
import os
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class NoDuplicateMethodsTest(unittest.TestCase):
    def test_no_method_defined_twice(self):
        for folder in ("voice", "app", "vision", "sensors"):
            path = os.path.join(ROOT, folder)
            if not os.path.isdir(path):
                continue
            for name in sorted(os.listdir(path)):
                if not name.endswith(".py"):
                    continue
                with open(os.path.join(path, name), encoding="utf-8") as f:
                    tree = ast.parse(f.read())
                for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
                    seen = set()
                    for item in cls.body:
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            # @property + @x.setter ont le droit d'avoir le même nom
                            if item.name in seen and not item.decorator_list:
                                self.fail("%s/%s : %s.%s défini deux fois" % (folder, name, cls.name, item.name))
                            seen.add(item.name)

    def test_microphone_callback_signature(self):
        with open(os.path.join(ROOT, "voice", "speech_listener.py"), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Listener")
        cb = [f for f in cls.body if isinstance(f, ast.FunctionDef) and f.name == "_on_audio"]
        self.assertEqual(len(cb), 1)
        self.assertEqual([a.arg for a in cb[0].args.args], ["self", "indata", "n_frames", "time_info", "status"])


if __name__ == "__main__":
    unittest.main()
