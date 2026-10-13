#!/usr/bin/env python3
"""Fabrique le « HAT capteurs » qui s'enfiche sur le Raspberry Pi 5.

  - 3 convertisseurs ADS1115 (adresses 0x48, 0x49, 0x4A fixées par la carte) ;
  - 10 entrées pour les capteurs de force FSR du bout des doigts (connecteur JST-XH 2 broches,
    résistance de 10 kΩ vers la masse sur la carte : le pont diviseur est déjà fait) ;
  - 3 sorties I2C JST-XH 4 broches (GND, 3V3, SDA, SCL) : chaîne des cartes servos (mesure de
    courant), INA226 de la batterie, capteur de distance VL53L1X.

Dimensions et trous selon la spécification mécanique officielle des cartes HAT
(github.com/raspberrypi/hats, hat-board-mechanical.pdf) : 65 × 56 mm, coins arrondis de 3 mm,
4 trous M2.5 percés à 2,75 mm, entraxe 58 × 49 mm, connecteur 40 broches centré à 29 mm du trou gauche.
Pas d'EEPROM d'identification : c'est une carte d'extension simple (broches 27/28 non utilisées).
"""

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "common"))

import pcbnew  # noqa: E402
import pcbtools as pt  # noqa: E402
from pcbtools import rect  # noqa: E402

NAME = "hat_capteurs"
W, H = 65.0, 56.0
TITLE = "DOMOKAMI CONNECT"

ADS = ("ADS1115IDGSR", "C37593")
R10K = ("0603WAF1002T5E", "C25804")
C100N = ("CC0603KRX7R9BB104", "C14663")

# connecteur du Pi : broches impaires sur la rangée intérieure, paires (5 V) côté bord
HEADER_X0 = 3.5 + 29.0 - 9.5 * 2.54   # broche 1 (centre du connecteur à 29 mm du trou gauche)
ROW_ODD, ROW_EVEN = 3.5 + 1.27, 3.5 - 1.27
PI_NETS = {1: "+3V3", 17: "+3V3", 3: "SDA", 5: "SCL"}
for n in (6, 9, 14, 20, 25, 30, 34, 39):
    PI_NETS[n] = "GND"
HOLES = [(3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)]

FINGERS = [("U1", 0, "G pouce"), ("U1", 1, "G index"), ("U1", 2, "G majeur"), ("U1", 3, "G annulaire"),
           ("U2", 0, "D pouce"), ("U2", 1, "D index"), ("U2", 2, "D majeur"), ("U2", 3, "D annulaire"),
           ("U3", 0, "G auriculaire"), ("U3", 1, "D auriculaire")]


def pin_xy(n):
    col = (n - 1) // 2
    return HEADER_X0 + 2.54 * col, ROW_ODD if n % 2 else ROW_EVEN


def rounded_outline(b, w, h, r):
    for (x1, y1, x2, y2) in ((r, 0, w - r, 0), (w, r, w, h - r), (w - r, h, r, h), (0, h - r, 0, r)):
        s = pcbnew.PCB_SHAPE(b.board)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetStart(b.pt(x1, y1))
        s.SetEnd(b.pt(x2, y2))
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetWidth(pt.mm(0.1))
        b.board.Add(s)
    for cx, cy, a0 in ((r, r, 180), (w - r, r, 270), (w - r, h - r, 0), (r, h - r, 90)):
        pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in (a0, a0 + 45, a0 + 90)]
        s = pcbnew.PCB_SHAPE(b.board)
        s.SetShape(pcbnew.SHAPE_T_ARC)
        s.SetArcGeometry(*[b.pt(x, y) for x, y in pts])
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetWidth(pt.mm(0.1))
        b.board.Add(s)


def place_header(b):
    """Connecteur femelle 2x20 monté SOUS la carte : on essaie les orientations et on garde celle où
    chaque pastille tombe exactement sur la bonne broche du Pi."""
    for angle in (0, 90, 180, 270):
        x1, y1 = pin_xy(1)
        fp = b.place("Connector_PinSocket_2.54mm", "PinSocket_2x20_P2.54mm_Vertical", "J1", "Raspberry Pi",
                     x1, y1, angle=angle, back=True, hide_ref=True)
        ok = True
        for pad in fp.Pads():
            q = pad.GetPosition()
            px, py = pcbnew.ToMM(q.x) - b.x0, pcbnew.ToMM(q.y) - b.y0
            ex, ey = pin_xy(int(pad.GetNumber()))
            if abs(px - ex) > 0.02 or abs(py - ey) > 0.02:
                ok = False
                break
        if ok:
            for pad in fp.Pads():
                net = PI_NETS.get(int(pad.GetNumber()))
                if net:
                    pad.SetNet(b.net(net))
            b.bom.append(("J1", "2x20", "Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical",
                          "Connecteur femelle 2 x 20 broches 2,54 mm (hauteur standard HAT, soudé sous la carte)",
                          "", "", False))
            return angle
        b.board.Remove(fp)
    raise RuntimeError("aucune orientation du connecteur ne correspond au brochage du Pi")


def build(path):
    b = pt.Board(path)
    rounded_outline(b, W, H, 3.0)
    smd = dict(hide_ref=True)
    angle = place_header(b)
    for i, (x, y) in enumerate(HOLES):
        # perçage 2,7 mm de la bibliothèque : dans la tolérance de la spécification HAT (2,75 ± 0,05 mm)
        b.place("MountingHole", "MountingHole_2.7mm_M2.5", "H%d" % (i + 1), "M2.5", x, y, hide_ref=True)

    # 3 ADS1115 : 1 ADDR, 2 ALERT, 3 GND, 4-7 AIN0-3, 8 VDD, 9 SDA, 10 SCL
    addr = {"U1": "GND", "U2": "+3V3", "U3": "SDA"}
    for k, (ref, x) in enumerate((("U1", 12.0), ("U2", 27.0), ("U3", 42.0))):
        pads = {"1": addr[ref], "3": "GND", "8": "+3V3", "9": "SDA", "10": "SCL"}
        for ch in range(4):
            pads[str(4 + ch)] = "%s_A%d" % (ref, ch)
        b.place("Package_SO", "TSSOP-10_3x3mm_P0.5mm", ref, "ADS1115", x, 17.0, pads=pads,
                bom="ADS1115 convertisseur 16 bits", lcsc=ADS[1], mpn=ADS[0], **smd)
        b.place("Capacitor_SMD", "C_0603_1608Metric", "C%d" % (k + 1), "100nF", x + 4.6, 13.2,
                pads={"1": "+3V3", "2": "GND"}, bom="100 nF", lcsc=C100N[1], mpn=C100N[0], **smd)
        b.text("%s 0x%X" % (ref, 0x48 + k), x, 12.0, 0.8)
        # la broche GND (3) est coincée entre ses voisines au pas de 0,5 mm : piste vers un via de masse
        b.track("GND", [(x - 2.15, 17.0), (x - 3.7, 17.0)], 0.25)
        b.via("GND", x - 3.7, 17.0)
    # entrées FSR : 2 rangées de 5 connecteurs
    for i, (ref, ch, label) in enumerate(FINGERS):
        row, col = divmod(i, 5)
        x, y = 6.0 + 10.0 * col, 33.5 + 11.0 * row
        node = "%s_A%d" % (ref, ch)
        b.place("Connector_JST", "JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical", "J%d" % (10 + i), label, x, y,
                pads={"1": "+3V3", "2": node}, hide_ref=True, bom="JST-XH 2 broches droit (B2B-XH-A) + câble")
        b.place("Resistor_SMD", "R_0603_1608Metric", "R%d" % (1 + i), "10k", x + 1.25, y - 4.6,
                pads={"1": node, "2": "GND"}, bom="10 kΩ (pont diviseur du FSR)", lcsc=R10K[1], mpn=R10K[0], **smd)
        b.text(label, x + 1.25, y + 5.0, 0.8)
    # sorties I2C (bord droit) : 1 GND, 2 3V3, 3 SDA, 4 SCL
    for ref, y, label in (("J2", 10.5, "Cartes servos"), ("J3", 24.5, "Batterie INA226"), ("J4", 38.5, "VL53L1X")):
        b.place("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical", ref, label, 57.0, y, angle=270,
                pads={"1": "GND", "2": "+3V3", "3": "SDA", "4": "SCL"}, hide_ref=True,
                bom="JST-XH 4 broches droit (B4B-XH-A) + câble")
        b.text(label, 61.0, y + 3.75, 0.8, angle=90)
    for k, lab in enumerate(("GND", "3V3", "SDA", "SCL")):
        b.text(lab, 63.3, 10.5 + 2.5 * k, 0.8, angle=90)

    b.text(TITLE, 22.0, 25.0, 1.6, bold=True)
    b.text("HAT capteurs v1 · Raspberry Pi 5", 22.0, 27.6, 0.9)
    b.text("FSR : broche 1 = 3V3, broche 2 = mesure", 24.0, 51.5, 0.8)

    # masse sur les deux faces
    b.zone("GND", pcbnew.F_Cu, rect(0.3, 0.3, W - 0.3, H - 0.3), priority=0)
    b.zone("GND", pcbnew.B_Cu, rect(0.3, 0.3, W - 0.3, H - 0.3), priority=0)
    return b, angle


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--freerouting", required=True)
    ap.add_argument("--java", default="java")
    ap.add_argument("--passes", type=int, default=100)
    args = ap.parse_args()
    path = os.path.join(HERE, NAME + ".kicad_pcb")
    b, angle = build(path)
    print("connecteur du Pi : orientation %d° (face du dessous)" % angle)
    pcbnew.SaveBoard(path, b.board)
    print("pistes et vias importés :", pt.autoroute(path, args.freerouting, args.java, args.passes))
    print("vias de couture :", pt.stitch(path, "GND", [(5.0, 8.0, 50.0, 26.0), (2.0, 28.0, 62.0, 54.0)], step=5.0))
    print("vias de masse des composants :", pt.pad_vias(path, "GND", (0.0, 0.0, W, H)))
    report = os.path.join(HERE, "drc.txt")
    print(pt.fill_and_check(path, report)[-700:])
    pt.fabrication(path, os.path.join(HERE, "fabrication"), os.path.join(HERE, NAME + "-gerber.zip"))
    pt.write_bom(b.bom, os.path.join(HERE, "nomenclature.csv"))
    pt.write_jlc(path, b.bom, os.path.join(HERE, "bom_jlcpcb.csv"), os.path.join(HERE, "cpl_jlcpcb.csv"))
    pt.svg_previews(path, os.path.join(HERE, "apercu"))


if __name__ == "__main__":
    main()
