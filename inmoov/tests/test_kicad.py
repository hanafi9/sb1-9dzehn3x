"""Tests de l'export KiCad (sans KiCad ; la comparaison du netlist n'est faite que si kicad-cli est installé)."""

import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [os.path.join(ROOT, "app")]

import electrical  # noqa: E402
import kicad_export  # noqa: E402


def balanced(text):
    depth, in_str, esc = 0, False, False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0 and not in_str


class KicadExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.files = kicad_export.export(cls.tmp)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def read(self, name):
        with open(os.path.join(self.tmp, name), encoding="utf-8") as f:
            return f.read()

    def test_one_file_per_section_plus_root(self):
        self.assertEqual(self.files[0], "inmoov-electrique.kicad_sch")
        self.assertEqual(self.files[1:], ["%s.kicad_sch" % sid for sid, _ in electrical.SHEETS])
        root = self.read("inmoov-electrique.kicad_sch")
        for name in self.files[1:]:
            self.assertIn('"Sheetfile" "%s"' % name, root)
        for extra in ("inmoov-electrique.kicad_pro", "inmoov.kicad_sym", "sym-lib-table"):
            self.assertTrue(os.path.isfile(os.path.join(self.tmp, extra)), extra)

    def test_files_are_well_formed(self):
        for name in self.files + ["inmoov.kicad_sym", "sym-lib-table"]:
            self.assertTrue(balanced(self.read(name)), name)

    def test_symbols_defined_and_references_unique(self):
        refs = []
        for name in self.files[1:]:
            text = self.read(name)
            defined = set(re.findall(r'\(symbol "(InMoov:[^"]+)" \(in_bom', text))
            used = set(re.findall(r'\(lib_id "([^"]+)"\)', text))
            self.assertEqual(used, defined, name)
            refs += re.findall(r'\(reference "([^"]+)"\)', text)
        self.assertEqual(len(refs), len(set(refs)))

    def test_wires_on_grid(self):
        for name in self.files[1:]:
            for x, y in re.findall(r"\(xy ([\d.]+) ([\d.]+)\)", self.read(name)):
                for v in (float(x), float(y)):
                    self.assertAlmostEqual(v / 1.27, round(v / 1.27), places=3, msg=name)

    def test_zip(self):
        zf = zipfile.ZipFile(io.BytesIO(kicad_export.zip_bytes()))
        self.assertIn("inmoov-kicad/inmoov-electrique.kicad_pro", zf.namelist())
        self.assertEqual(len([n for n in zf.namelist() if n.endswith(".kicad_sch")]), 9)

    def test_check_netlist_detects_errors(self):
        groups = kicad_export.expected_nets()["cou"]
        nodes = sorted(next(iter(groups.values())))
        fake = '(export (nets (net (code "1") (name "X") (node (ref "%s") (pin "%s")))\n))' % nodes[0]
        self.assertTrue(kicad_export.check_netlist(fake))

    @unittest.skipUnless(shutil.which("kicad-cli"), "kicad-cli absent")
    def test_kicad_netlist_matches(self):
        out = os.path.join(self.tmp, "net.net")
        subprocess.run(["kicad-cli", "sch", "export", "netlist", "-o", out,
                        os.path.join(self.tmp, "inmoov-electrique.kicad_sch")], check=True, capture_output=True)
        with open(out, encoding="utf-8") as f:
            self.assertEqual(kicad_export.check_netlist(f.read()), [])


if __name__ == "__main__":
    unittest.main()
