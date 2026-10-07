"""Le circuit imprimé « shield jambes » relie bien les broches utilisées par le firmware des jambes."""

import os
import re
import unittest
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PCB = os.path.join(ROOT, "pcb", "shield_jambes")


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
        for suffix in ("F_Cu.gtl", "B_Cu.gbl", "F_Mask.gts", "B_Mask.gbs", "F_Silkscreen.gto", "Edge_Cuts.gm1",
                       "PTH.drl", "NPTH.drl"):
            self.assertTrue(any(n.endswith(suffix) for n in names), suffix)


if __name__ == "__main__":
    unittest.main()
