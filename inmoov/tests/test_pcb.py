"""Les circuits imprimés relient bien les broches utilisées par le firmware et la configuration."""

import os
import re
import unittest
import csv
import json
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PCB = os.path.join(ROOT, "pcb", "shield_jambes")
GERBERS = ("F_Cu.gtl", "B_Cu.gbl", "F_Mask.gts", "B_Mask.gbs", "F_Silkscreen.gto", "Edge_Cuts.gm1", "PTH.drl",
           "NPTH.drl")


def pad_nets(text):
    """{référence: {numéro de pastille: réseau}} lus dans le fichier .kicad_pcb."""
    out = {}
    for block in re.split(r"\n  \(footprint ", text)[1:]:
        ref = re.search(r'\(fp_text reference "([^"]+)"', block).group(1)
        pads = {}
        for chunk in block.split("\n    (pad ")[1:]:
            net = re.search(r'\(net \d+ "([^"]+)"\)', chunk.split("\n    (", 1)[0])
            if net:
                pads[re.match(r'"([^"]+)"', chunk).group(1)] = net.group(1)
        out[ref] = pads
    return out


class ShieldJambesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(PCB, "shield_jambes.kicad_pcb"), encoding="utf-8") as f:
            cls.nets = pad_nets(f.read())
        with open(os.path.join(ROOT, "legs", "firmware", "inmoov_legs", "inmoov_legs.ino"), encoding="utf-8") as f:
            cls.fw = f.read()

    def test_load_cells_on_firmware_pins(self):
        pin0 = int(re.search(r"CELL_PIN0\s*=\s*(\d+)", self.fw).group(1))
        j4 = self.nets["J4"]  # 2x18 : pastille 1-2 = 5V, 3 = D22, 4 = D23, ..., 35-36 = GND
        for n in range(8):
            for offset, kind in ((0, "DT"), (1, "SCK")):
                pin = pin0 + 2 * n + offset
                self.assertEqual(j4[str(pin - 22 + 3)], "HX%d_%s" % (n, kind))
            conn = self.nets["J%d" % (10 + n)]
            self.assertEqual(conn, {"1": "GND", "2": "HX%d_DT" % n, "3": "HX%d_SCK" % n, "4": "+5V"})
        self.assertEqual((j4["1"], j4["2"], j4["35"], j4["36"]), ("+5V", "+5V", "GND", "GND"))

    def test_bus_imu_and_estop(self):
        self.assertIn("ESTOP_PIN         = 2", self.fw)
        self.assertEqual(self.nets["J2"]["6"], "ARRET")            # J2 : D7..D0, pastille 6 = D2
        j3 = self.nets["J3"]                                       # J3 : D14..D21
        self.assertEqual((j3["5"], j3["6"], j3["7"], j3["8"]), ("TX1", "RX1", "SDA", "SCL"))
        self.assertEqual(self.nets["J21"], {"1": "TX1", "2": "RX1", "3": "GND"})
        self.assertEqual(self.nets["J20"], {"1": "GND", "2": "+5V", "3": "SDA", "4": "SCL"})
        self.assertEqual(self.nets["J22"], {"1": "ARRET", "2": "GND"})
        self.assertEqual(self.nets["R1"], {"1": "+5V", "2": "ARRET"})

    def test_power_header_and_polarity(self):
        j1 = self.nets["J1"]  # NC, IOREF, RESET, 3V3, 5V, GND, GND, VIN
        self.assertEqual((j1["5"], j1["6"], j1["7"]), ("+5V", "GND", "GND"))
        self.assertEqual(self.nets["C2"], {"1": "+5V", "2": "GND"})   # pastille carrée = +
        self.assertEqual(self.nets["D1"]["1"], "GND")                 # pastille carrée = cathode

    def test_fabrication_files_and_drc(self):
        with open(os.path.join(PCB, "drc.txt"), encoding="utf-8") as f:
            drc = f.read()
        self.assertIn("Found 0 DRC violations", drc)
        self.assertIn("Found 0 unconnected pads", drc)
        names = zipfile.ZipFile(os.path.join(PCB, "shield_jambes-gerber.zip")).namelist()
        for suffix in GERBERS:
            self.assertTrue(any(n.endswith(suffix) for n in names), suffix)


def load_board(name):
    d = os.path.join(ROOT, "pcb", name)
    with open(os.path.join(d, name + ".kicad_pcb"), encoding="utf-8") as f:
        text = f.read()
    return d, text, pad_nets(text)


class FabricationMixin:
    def check_fabrication(self, d, name, text):
        self.assertIn('"DOMOKAMI CONNECT"', text)
        self.assertNotIn("InMoov", text)
        with open(os.path.join(d, "drc.txt"), encoding="utf-8") as f:
            drc = f.read()
        self.assertIn("Found 0 DRC violations", drc)
        self.assertIn("Found 0 unconnected pads", drc)
        names = zipfile.ZipFile(os.path.join(d, name + "-gerber.zip")).namelist()
        for suffix in GERBERS:
            self.assertTrue(any(n.endswith(suffix) for n in names), suffix)
        with open(os.path.join(d, "bom_jlcpcb.csv"), encoding="utf-8") as f:
            bom = f.read().splitlines()
        self.assertEqual(bom[0], "Comment,Designator,Footprint,LCSC Part #")
        self.assertTrue(all(re.search(r",C\d+$", line) for line in bom[1:]))
        with open(os.path.join(d, "cpl_jlcpcb.csv"), encoding="utf-8") as f:
            cpl = f.read().splitlines()
        self.assertEqual(cpl[0], "Designator,Mid X,Mid Y,Layer,Rotation")
        placed = {line.split(",")[0] for line in cpl[1:]}
        in_bom = set()
        for row in list(csv.reader(bom))[1:]:
            in_bom.update(row[1].split(","))
        self.assertEqual(placed, in_bom)
        return placed


class CarteServosTest(unittest.TestCase, FabricationMixin):
    @classmethod
    def setUpClass(cls):
        cls.dir, cls.text, cls.nets = load_board("carte_servos")

    def test_servo_outputs(self):
        u1 = self.nets["U1"]
        for i in range(16):
            led_pin = 6 + i if i < 8 else 7 + i            # LED0-7 = 6-13, LED8-15 = 15-22
            self.assertEqual(u1[str(led_pin)], "LED%d" % i)
            self.assertEqual(self.nets["R%d" % (i + 1)], {"1": "S%d" % i, "2": "LED%d" % i})
            block = self.nets["J%d" % (10 + i // 4)]
            k = i % 4                                       # colonne k : pastilles 3k+1 = S, 3k+2 = +, 3k+3 = -
            self.assertEqual((block[str(3 * k + 1)], block[str(3 * k + 2)], block[str(3 * k + 3)]), ("S%d" % i, "+6V", "GND"))

    def test_power_path(self):
        self.assertEqual(self.nets["J1"], {"1": "GND", "2": "+6V_IN"})
        self.assertEqual(self.nets["F1"], {"1": "+6V_IN", "2": "+6V_F"})
        self.assertEqual(self.nets["RS1"], {"1": "+6V_F", "2": "+6V"})
        u2 = self.nets["U2"]                                # INA226 : 10 IN+, 9 IN-, 8 VBUS
        self.assertEqual((u2["10"], u2["9"], u2["8"]), ("+6V_F", "+6V", "+6V"))
        self.assertEqual(self.nets["C4"], {"1": "+6V", "2": "GND"})

    def test_buses_and_addresses(self):
        u1, u2 = self.nets["U1"], self.nets["U2"]
        self.assertEqual((u1["26"], u1["27"], u1["28"], u1["23"]), ("SCL_M", "SDA_M", "+5V_M", "GND"))
        self.assertEqual((u2["4"], u2["5"], u2["6"]), ("SDA_P", "SCL_P", "+3V3_PI"))
        for ref in ("J2", "J3"):
            self.assertEqual(self.nets[ref], {"1": "GND", "2": "+5V_M", "3": "SDA_M", "4": "SCL_M"})
        for ref in ("J4", "J5"):
            self.assertEqual(self.nets[ref], {"1": "GND", "2": "+3V3_PI", "3": "SDA_P", "4": "SCL_P"})
        # ponts : relié = 1 (5 V ou 3V3), sinon tiré à la masse par 10 kΩ
        self.assertEqual(self.nets["JP1"], {"1": "+5V_M", "2": "PCA_A0"})
        self.assertEqual(self.nets["R17"], {"1": "GND", "2": "PCA_A0"})
        self.assertEqual(self.nets["JP3"], {"1": "+3V3_PI", "2": "INA_A0"})
        self.assertEqual(self.nets["R21"], {"1": "INA_A0", "2": "GND"})
        self.assertEqual((u1["1"], u1["2"], u2["2"], u2["1"]), ("PCA_A0", "PCA_A1", "INA_A0", "INA_A1"))
        # adresses des cartes A, B, C = celles de la configuration
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            cfg = json.load(f)["sensors"]["boards"]
        ina = {(0, 1): 0x41, (1, 0): 0x44, (1, 1): 0x45}    # (A1, A0) -> adresse (fiche TI)
        cards = {"A": (0, (0, 1)), "B": (1, (1, 0)), "C": (2, (1, 1))}  # PCA A1A0, INA (A1, A0)
        for k, (card, (pca, ina_bits)) in enumerate(sorted(cards.items())):
            self.assertEqual(int(cfg[k]["ina226"], 16), ina[ina_bits], card)
            self.assertAlmostEqual(cfg[k]["shunt_ohm"], 0.002)
            self.assertIn("%s : " % card, self.text)
        self.assertIn('"C : PCA A1, INA A0 + A1"', self.text)

    def test_fabrication(self):
        placed = self.check_fabrication(self.dir, "carte_servos", self.text)
        self.assertTrue({"U1", "U2", "RS1", "D1"} <= placed)
        self.assertFalse({"J1", "F1", "C4"} & placed)       # traversants : soudés à la main


class HatCapteursTest(unittest.TestCase, FabricationMixin):
    @classmethod
    def setUpClass(cls):
        cls.dir, cls.text, cls.nets = load_board("hat_capteurs")

    def test_pi_header(self):
        j1 = self.nets["J1"]
        self.assertEqual((j1["1"], j1["17"], j1["3"], j1["5"]), ("+3V3", "+3V3", "SDA", "SCL"))
        for n in (6, 9, 14, 20, 25, 30, 34, 39):
            self.assertEqual(j1[str(n)], "GND")
        for n in (2, 4, 27, 28):                            # 5 V et EEPROM HAT : non utilisés
            self.assertNotIn(str(n), j1)

    def test_adc_addresses_and_fingers(self):
        addr = {"U1": "GND", "U2": "+3V3", "U3": "SDA"}     # 0x48, 0x49, 0x4A (fiche TI)
        for ref, a in addr.items():
            u = self.nets[ref]
            self.assertEqual((u["1"], u["3"], u["8"], u["9"], u["10"]), (a, "GND", "+3V3", "SDA", "SCL"))
        with open(os.path.join(ROOT, "config.example.json"), encoding="utf-8") as f:
            tips = json.load(f)["sensors"]["fingertips"]
        chip = {"0x48": "U1", "0x49": "U2", "0x4A": "U3"}
        nodes = set()
        for side in ("left", "right"):
            for finger, (adr, ch) in tips[side].items():
                node = "%s_A%d" % (chip[adr], ch)
                self.assertEqual(self.nets[chip[adr]][str(4 + ch)], node)
                nodes.add(node)
        self.assertEqual(len(nodes), 10)
        conns = {self.nets["J%d" % n]["2"] for n in range(10, 20)}
        self.assertEqual(conns, nodes)
        for n in range(10, 20):
            node = self.nets["J%d" % n]["2"]
            self.assertEqual(self.nets["J%d" % n]["1"], "+3V3")
            self.assertEqual(self.nets["R%d" % (n - 9)], {"1": node, "2": "GND"})

    def test_i2c_outputs(self):
        for ref in ("J2", "J3", "J4"):
            self.assertEqual(self.nets[ref], {"1": "GND", "2": "+3V3", "3": "SDA", "4": "SCL"})

    def test_fabrication(self):
        placed = self.check_fabrication(self.dir, "hat_capteurs", self.text)
        self.assertEqual(placed, {"U1", "U2", "U3", "C1", "C2", "C3"} | {"R%d" % n for n in range(1, 11)})


if __name__ == "__main__":
    unittest.main()
