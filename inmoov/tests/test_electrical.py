"""Tests des schémas électriques détaillés (sans matériel)."""

import os
import re
import sys
import unittest
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [os.path.join(ROOT, "app")]

import electrical  # noqa: E402
import wiring  # noqa: E402


class ElectricalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sheets = electrical.all_sheets()

    def test_every_section_has_a_sheet(self):
        ids = [s["id"] for s in self.sheets]
        self.assertEqual(ids, ["alimentation", "tete", "cou", "torse", "bras", "mains", "bassin", "jambes"])
        self.assertEqual([s["id"] for s in electrical.sheet_list()], ids)
        self.assertIsNone(electrical.get_sheet("inconnu"))

    def test_svg_is_valid_xml(self):
        for s in self.sheets:
            for svg in [s["svg"]] + s["pages"]:
                ET.fromstring(svg)  # lève une erreur si le SVG est mal formé
            self.assertGreater(len(s["rows"]), 0, s["id"])

    def test_pages_fit_on_a4(self):
        for s in self.sheets:
            for svg in s["pages"]:
                _, _, w, h = (float(x) for x in re.search(r'viewBox="([^"]+)"', svg).group(1).split())
                self.assertLessEqual(h, electrical.PAGE_MAX + 100, s["id"])

    def test_every_upper_body_servo_is_drawn_once(self):
        drawn = {}
        for s in self.sheets:
            for r in s["rows"]:
                m = re.match(r"PCA9685 0x4\d \(carte (\w)\) · CH(\d+)", r["from"])
                if m and r["type"] == "Signal de servo":
                    drawn.setdefault((m.group(1), int(m.group(2))), set()).add(s["id"])
        letters = {"pca_tete": "A", "pca_gauche": "B", "pca_droite": "C"}
        expected = {(letters[b], ch) for b, ch, _ in wiring.SERVO_PLAN.values()}
        self.assertEqual(set(drawn), expected)
        for key, sheets in drawn.items():
            self.assertEqual(len(sheets), 1, key)

    def test_servo_power_never_from_pca_or_arduino(self):
        """Le + des servos vient toujours d'un rail 6 V, jamais de la PCA9685 ni de l'Arduino."""
        for s in self.sheets:
            for r in s["rows"]:
                if r["from"].endswith("· +") and "Signal" not in r["type"]:
                    self.assertTrue(r["to"].startswith("+6 V"), (s["id"], r))

    def test_legs_pins_match_firmware(self):
        with open(os.path.join(ROOT, "legs", "firmware", "inmoov_legs", "inmoov_legs.ino"), encoding="utf-8") as f:
            src = f.read()
        pin0 = int(re.search(r"CELL_PIN0\s*=\s*(\d+)", src).group(1))
        legs = next(s for s in self.sheets if s["id"] == "jambes")
        for n in range(8):
            rows = [r for r in legs["rows"] if r["to"].startswith("HX711 n°%d ·" % n)]
            dt = next(r for r in rows if r["to"].endswith("DT (DOUT)"))
            sck = next(r for r in rows if r["to"].endswith("SCK"))
            self.assertTrue(dt["from"].endswith("broche %d" % (pin0 + 2 * n)), dt)
            self.assertTrue(sck["from"].endswith("broche %d" % (pin0 + 2 * n + 1)), sck)
        uart = [r for r in legs["rows"] if "Bus Servo Adapter" in r["to"] and r["type"].startswith("Liaison")]
        self.assertEqual({(r["from"].split(" · ")[1][:3], r["to"].split(" · ")[1]) for r in uart},
                         {("TX1", "TX"), ("RX1", "RX")})  # RX-RX et TX-TX (Waveshare)

    def test_sensor_addresses_match_wiring(self):
        torse = next(s for s in self.sheets if s["id"] == "torse")
        text = " ".join(r["to"] for r in torse["rows"])
        for _, address, _, _ in wiring.SENSOR_PART["i2c_devices"]:
            self.assertIn(address, text)

    def test_emergency_stop_cuts_servo_power(self):
        power = next(s for s in self.sheets if s["id"] == "alimentation")
        pairs = {(r["from"], r["to"]) for r in power["rows"]}
        self.assertIn(("Arrêt d'urgence · 2", "Relais / contacteur 12 V 40 A · 85 bobine +"), pairs)
        relay_out = {to for fr, to in pairs if fr.startswith("Relais / contacteur 12 V 40 A · 87")}
        self.assertEqual(relay_out, {"Fusible · 1"})  # vers les fusibles 6 V et 12 V
        self.assertEqual(len([1 for fr, to in pairs if fr.startswith("Relais") and "87" in fr]), 1)


if __name__ == "__main__":
    unittest.main()
