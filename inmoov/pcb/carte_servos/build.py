#!/usr/bin/env python3
"""Fabrique la « carte servos 16 voies » (à faire en 3 exemplaires : cartes A, B, C).

Elle remplace, pour une carte, le module PCA9685 + le bornier + le fusible + le module INA226 :
  - PCA9685 (16 sorties servo, bus I2C de l'Arduino Mega i01.left) ;
  - INA226 + résistance de mesure 2 mΩ (courant de la carte, bus I2C du Raspberry Pi) ;
  - porte-fusible ATO (lame de voiture) et bornier à vis 24 A pour l'arrivée du 6 V ;
  - 16 connecteurs de servo, alimentés par un plan de cuivre (le + sur la face du dessous,
    le − sur la face du dessus), jamais à travers la puce ;
  - 2 connecteurs JST-XH par bus (entrée / sortie) pour chaîner les cartes A, B, C.

Les composants CMS (puces, résistances, condensateurs, LED) sont posés par JLCPCB
(fichiers bom_jlcpcb.csv et cpl_jlcpcb.csv) ; les connecteurs traversants sont à souder.

    python3 build.py --freerouting freerouting-2.5.0-executable.jar --java /chemin/java25
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "common"))

import pcbnew  # noqa: E402
import pcbtools as pt  # noqa: E402
from pcbtools import rect  # noqa: E402

NAME = "carte_servos"
W, H = 100.0, 96.0
TITLE = "DOMOKAMI CONNECT"

# composants CMS vérifiés dans le catalogue JLCPCB / LCSC
PCA = ("PCA9685PW,118", "C2678753")
INA = ("INA226AIDGSR", "C49851")
SHUNT = ("HoJLR2512-2W-2mR-1%", "C2904228")
R220 = ("0603WAF2200T5E", "C22962")
R10K = ("0603WAF1002T5E", "C25804")
R1K = ("0603WAF1001T5E", "C21190")
C100N = ("CC0603KRX7R9BB104", "C14663")
C10U = ("CL10A106KP8NNNC", "C19702")
LED = ("KT-0603G", "C12624")

# plan +6 V de la face du dessous : sous les servos, la résistance de mesure, la LED et C4
PLAN_6V = [(37.5, 53.5), (99.6, 53.5), (99.6, 73.5), (80.5, 73.5), (80.5, 83.0), (37.5, 83.0)]
# régions où la face du dessous est en masse (vias de couture possibles)
MASSE_DESSOUS = [(2.0, 2.0, 98.0, 52.0), (2.0, 52.0, 36.0, 74.0), (40.0, 84.5, 98.0, 94.0), (81.5, 74.5, 98.0, 83.0)]
UNROUTED = ("+6V_IN", "+6V_F", "+6V")  # réseaux de puissance : uniquement des plans de cuivre


def col_x(i):
    """Abscisse de la voie i : 4 groupes de 4 (une fiche de servo est plus large que 2,54 mm)."""
    return 40.0 + 2.54 * (i + i // 4)


def build(path):
    b = pt.Board(path)
    b.outline(W, H)
    servo_fp = pt.servo_block_footprint(pt.local_library(HERE))
    smd = dict(hide_ref=True)

    # ------------------------------------------------ puissance (en bas)
    b.place("TerminalBlock_Phoenix", "TerminalBlock_Phoenix_MKDS-3-2-5.08_1x02_P5.08mm_Horizontal", "J1",
            "6V entrée", 6.0, 80.0, pads={"1": "GND", "2": "+6V_IN"}, hide_ref=True, full=True,
            bom="Bornier à vis 2 points pas 5,08 mm, 24 A (Phoenix MKDS 3/2-5,08 ou équivalent)")
    b.place("Fuse", "FuseHolder_Blade_ATO_Littelfuse_FLR_178.6165", "F1", "Fusible ATO", 20.0, 79.0,
            pads={"1": "+6V_IN", "2": "+6V_F"}, full=True,
            bom="Porte-fusible ATO pour circuit imprimé 30 A (Littelfuse 178.6165) + fusible lame ATO 10 ou 15 A")
    b.place("Resistor_SMD", "R_2512_6332Metric", "RS1", "2mR", 42.0, 80.5, pads={"1": "+6V_F", "2": "+6V"},
            bom="Résistance de mesure 2 mΩ 2 W 2512", lcsc=SHUNT[1], mpn=SHUNT[0], **smd)
    b.place("Package_SO", "VSSOP-10_3x3mm_P0.5mm", "U2", "INA226", 50.0, 80.5, angle=180,
            pads={"1": "INA_A1", "2": "INA_A0", "4": "SDA_P", "5": "SCL_P", "6": "+3V3_PI", "7": "GND",
                  "8": "+6V", "9": "+6V", "10": "+6V_F"},
            bom="INA226 mesure de courant", lcsc=INA[1], mpn=INA[0], **smd)
    b.place("Capacitor_SMD", "C_0603_1608Metric", "C3", "100nF", 51.0, 76.5, angle=90,
            pads={"1": "+3V3_PI", "2": "GND"}, bom="100 nF", lcsc=C100N[1], mpn=C100N[0], **smd)
    for i, (sig, y) in enumerate((("INA_A0", 74.8), ("INA_A1", 72.3))):
        b.place("Jumper", "SolderJumper-2_P1.3mm_Open_RoundedPad1.0x1.5mm", "JP%d" % (3 + i), "INA A%d" % i,
                55.5, y, pads={"1": "+3V3_PI", "2": sig}, hide_ref=True)
        b.place("Resistor_SMD", "R_0603_1608Metric", "R%d" % (21 + i), "10k", 59.0, y,
                pads={"1": sig, "2": "GND"}, bom="10 kΩ", lcsc=R10K[1], mpn=R10K[0], **smd)
    b.place("Resistor_SMD", "R_0603_1608Metric", "R25", "1k", 66.0, 80.5, pads={"1": "+6V", "2": "LED_A"},
            bom="1 kΩ", lcsc=R1K[1], mpn=R1K[0], **smd)
    b.place("LED_SMD", "LED_0603_1608Metric", "D1", "LED", 69.5, 80.5, angle=180, pads={"1": "GND", "2": "LED_A"},
            bom="LED verte 0603", lcsc=LED[1], mpn=LED[0], **smd)
    b.place("Capacitor_THT", "CP_Radial_D10.0mm_P5.00mm", "C4", "1000uF", 78.0, 80.5,
            pads={"1": "+6V", "2": "GND"}, full=True, bom="Condensateur électrolytique 1000 µF 10 V, Ø 10 mm, pas 5 mm")

    # ------------------------------------------------ servos
    for g in range(4):
        x0 = col_x(4 * g)
        pads = []
        for c in range(4):
            i = 4 * g + c
            dx = 2.54 * c
            pads += [(str(3 * c + 1), dx, 0.0, "S%d" % i, "rect" if c == 0 else "oval"),
                     (str(3 * c + 2), dx, 2.54, "+6V", "oval"), (str(3 * c + 3), dx, 5.08, "GND", "oval")]
        b.place(pt.LOCAL_LIB, servo_fp, "J%d" % (10 + g), "Servos %d-%d" % (4 * g, 4 * g + 3), x0, 64.0,
                pads={n: net for n, _, _, net, _ in pads}, hide_ref=True, libdir=HERE,
                bom="Barrette mâle 2,54 mm : 4 morceaux de 3 broches (sécable)")
    for i in range(16):
        x = col_x(i)
        b.place("Resistor_SMD", "R_0603_1608Metric", "R%d" % (1 + i), "220", x, 58.5, angle=90,
                pads={"1": "S%d" % i, "2": "LED%d" % i}, bom="220 Ω", lcsc=R220[1], mpn=R220[0], **smd)
        b.text(str(i), x, 61.8, 0.8)
    b.text("S", 37.2, 64.0, 1.0)
    b.text("+", 37.2, 66.54, 1.0)
    b.text("−", 37.2, 69.08, 1.0)

    # ------------------------------------------------ logique (en haut)
    pca = {"1": "PCA_A0", "2": "PCA_A1", "3": "GND", "4": "GND", "5": "GND", "14": "GND", "23": "GND", "24": "GND",
           "25": "GND", "26": "SCL_M", "27": "SDA_M", "28": "+5V_M"}
    for n in range(8):
        pca[str(6 + n)] = "LED%d" % n
        pca[str(15 + n)] = "LED%d" % (8 + n)
    b.place("Package_SO", "TSSOP-28_4.4x9.7mm_P0.65mm", "U1", "PCA9685", 55.0, 30.0, pads=pca,
            bom="PCA9685 16 voies PWM", lcsc=PCA[1], mpn=PCA[0], **smd)
    b.place("Capacitor_SMD", "C_0603_1608Metric", "C1", "10uF", 61.5, 22.5, pads={"1": "+5V_M", "2": "GND"},
            bom="10 µF", lcsc=C10U[1], mpn=C10U[0], **smd)
    b.place("Capacitor_SMD", "C_0603_1608Metric", "C2", "100nF", 61.5, 25.0, pads={"1": "+5V_M", "2": "GND"},
            bom="100 nF", lcsc=C100N[1], mpn=C100N[0], **smd)
    for i, (sig, y) in enumerate((("PCA_A0", 22.0), ("PCA_A1", 26.0))):
        b.place("Resistor_SMD", "R_0603_1608Metric", "R%d" % (17 + i), "10k", 44.0, y, pads={"1": "GND", "2": sig},
                bom="10 kΩ", lcsc=R10K[1], mpn=R10K[0], **smd)
        b.place("Jumper", "SolderJumper-2_P1.3mm_Open_RoundedPad1.0x1.5mm", "JP%d" % (1 + i), "PCA A%d" % i,
                39.0, y, pads={"1": "+5V_M", "2": sig}, hide_ref=True)
    for i, (sig, y) in enumerate((("SDA_M", 12.0), ("SCL_M", 15.0))):
        b.place("Resistor_SMD", "R_0603_1608Metric", "R%d" % (19 + i), "10k", 70.0, y, pads={"1": "+5V_M", "2": sig},
                bom="10 kΩ", lcsc=R10K[1], mpn=R10K[0], **smd)
    # connecteurs I2C (bord droit) : 1 GND, 2 alimentation, 3 SDA, 4 SCL
    conns = (("J2", 5.0, "Mega entrée", "+5V_M", "SDA_M", "SCL_M"),
             ("J3", 19.0, "Mega sortie", "+5V_M", "SDA_M", "SCL_M"),
             )
    for ref, y, label, pwr, sda, scl in conns:
        b.place("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical", ref, label, 95.0, y, angle=270,
                pads={"1": "GND", "2": pwr, "3": sda, "4": scl}, hide_ref=True,
                bom="JST-XH 4 broches droit (B4B-XH-A) + câble")
        b.text("%s %s" % (ref, label), 86.5, y + 3.75, 0.9, angle=90)
    for k, lab in enumerate(("GND", "5V", "SDA", "SCL")):
        b.text(lab, 89.0, 5.0 + 2.5 * k, 0.8)
    # bus I2C du Raspberry Pi (mesure de courant) : en bas, à côté de l'INA226
    for ref, x, label in (("J4", 64.0, "Pi entrée"), ("J5", 80.0, "Pi sortie")):
        b.place("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical", ref, label, x, 91.5,
                pads={"1": "GND", "2": "+3V3_PI", "3": "SDA_P", "4": "SCL_P"}, hide_ref=True,
                bom="JST-XH 4 broches droit (B4B-XH-A) + câble")
        b.text("%s %s" % (ref, label), x + 3.75, 86.6, 0.8)
        b.text("GND 3V3 SDA SCL", x + 3.75, 88.0, 0.8)

    for i, (x, y) in enumerate(((4.0, 4.0), (80.0, 4.0), (4.0, 68.0), (95.5, 91.5))):
        b.place("MountingHole", "MountingHole_3.2mm_M3", "H%d" % (i + 1), "M3", x, y, hide_ref=True)

    # ------------------------------------------------ textes
    b.text(TITLE, 22.0, 6.0, 1.8, bold=True)
    b.text("carte servos 16 voies v1", 22.0, 9.0, 1.0)
    b.text("Carte : A  B  C  (cocher)", 22.0, 12.0, 0.9)
    b.text("Adresses (souder les ponts) :", 14.0, 34.0, 0.9)
    b.text("A : aucun pont PCA, INA A0", 14.0, 36.2, 0.85)
    b.text("B : PCA A0, INA A1", 14.0, 38.4, 0.85)
    b.text("C : PCA A1, INA A0 + A1", 14.0, 40.6, 0.85)
    b.text("JP1 PCA A0", 32.0, 22.0, 0.8)
    b.text("JP2 PCA A1", 32.0, 26.0, 0.8)
    b.text("JP3 INA A0", 65.5, 74.8, 0.8)
    b.text("JP4 INA A1", 65.5, 72.3, 0.8)
    b.text("6 V", 8.5, 73.0, 1.2, bold=True)
    b.text("−  +", 8.5, 75.0, 1.2, bold=True)
    b.text("FUSIBLE 10-15 A", 26.4, 85.5, 0.9)
    b.text("6 V 15 A max · cuivre 2 oz", 26.0, 91.5, 0.9)

    # ------------------------------------------------ pistes de puissance et de mesure (fixes)
    # résistances 220 Ω -> broches S des servos (droites, sur le dessus)
    for i in range(16):
        x = col_x(i)
        _, ry = b.pad_xy("R%d" % (1 + i), "1")
        b.track("S%d" % i, [(x, ry), (x, 64.0)], 0.4)
    # INA226 : mesure Kelvin sur les bords intérieurs de la résistance de 2 mΩ
    p10, p9, p8 = b.pad_xy("U2", "10"), b.pad_xy("U2", "9"), b.pad_xy("U2", "8")
    s1, s2 = b.pad_xy("RS1", "1"), b.pad_xy("RS1", "2")
    b.track("+6V", [p9, (s2[0] + 0.6, p9[1])], 0.25)
    b.track("+6V", [p8, (s2[0] + 0.6, p8[1])], 0.25)
    b.track("+6V_F", [p10, (p10[0] - 0.9, p10[1]), (p10[0] - 0.9, 83.4), (s1[0] + 0.4, 83.4), (s1[0] + 0.4, 82.0)],
            0.25)
    # descente du +6 V vers le plan du dessous, à côté de la résistance de mesure
    # masses du PCA9685 : broches voisines reliées entre elles, puis un via vers le plan du dessous
    for a_, b_, via_side in (("3", "5", -1), ("23", "25", 1)):
        (xa, ya), (xb, yb) = b.pad_xy("U1", a_), b.pad_xy("U1", b_)
        b.track("GND", [(xa, ya), (xb, yb)], 0.25)
        xm, ym = b.pad_xy("U1", "4" if a_ == "3" else "24")
        b.track("GND", [(xm, ym), (xm + via_side * 1.9, ym)], 0.3)
        b.via("GND", xm + via_side * 1.9, ym)
    x14, y14 = b.pad_xy("U1", "14")
    b.track("GND", [(x14, y14), (x14 - 1.9, y14)], 0.3)
    b.via("GND", x14 - 1.9, y14)
    # masse de l'INA226 : sous le boîtier vers le plan de masse du dessus (au-dessus de la puce)
    gx, gy = b.pad_xy("U2", "7")
    b.track("GND", [(gx, gy), (gx + 1.8, gy), (gx + 1.8, 77.8)], 0.3)
    # LED de présence : liaison au plan +6 V du dessous
    rx, ry = b.pad_xy("R25", "1")
    b.track("+6V", [(rx, ry), (rx, ry - 2.0)], 0.4)
    b.via("+6V", rx, ry - 2.0)
    for vx in (44.9, 46.3):
        for vy in (74.6, 75.8, 77.0, 78.2):
            b.via("+6V", vx, vy, size=0.9, drill=0.5)

    # ------------------------------------------------ plans de cuivre
    # dessus : masse partout ; zones +6 V d'arrivée, après fusible et après la mesure
    b.zone("GND", pcbnew.F_Cu, rect(0.4, 0.4, W - 0.4, H - 0.4), priority=0)
    b.zone("+6V_IN", pcbnew.F_Cu, rect(9.4, 75.6, 25.6, 86.6), priority=2, thermal=False)
    b.zone("+6V_F", pcbnew.F_Cu, rect(27.6, 75.6, 39.9, 86.6), priority=2, thermal=False)
    b.zone("+6V", pcbnew.F_Cu, [(44.1, 73.8), (47.1, 73.8), (47.1, 79.6), (46.2, 79.6), (46.2, 82.6), (44.1, 82.6)],
           priority=2, thermal=False)
    # dessous : masse en haut et à gauche, +6 V sous les servos (sans aucune piste qui le coupe)
    b.zone("GND", pcbnew.B_Cu, rect(0.4, 0.4, W - 0.4, H - 0.4), priority=0)
    b.zone("+6V", pcbnew.B_Cu, PLAN_6V, priority=1, thermal=False)
    b.keepout(pcbnew.B_Cu, PLAN_6V, tracks=True, vias=False, pour=False, name="plan +6V sous les servos")
    b.keepout(pcbnew.F_Cu, rect(9.4, 75.6, 38.0, 86.6), tracks=True, vias=True, pour=False,
              name="arrivée 6 V et fusible")
    return b


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--freerouting", required=True)
    ap.add_argument("--java", default="java")
    ap.add_argument("--passes", type=int, default=100)
    args = ap.parse_args()
    path = os.path.join(HERE, NAME + ".kicad_pcb")
    b = build(path)
    pcbnew.SaveBoard(path, b.board)
    print("pistes et vias importés :", pt.autoroute(path, args.freerouting, args.java, args.passes, UNROUTED))
    # vias de couture : masse du dessus <-> masse du dessous (là où le dessous est en masse)
    print("vias de couture :", pt.stitch(path, "GND", MASSE_DESSOUS, step=5.0))
    print("vias de masse des composants :", sum(pt.pad_vias(path, "GND", r) for r in MASSE_DESSOUS))
    # les pastilles retirées du routage retrouvent leur réseau (le fichier d'origine est rechargé)
    report = os.path.join(HERE, "drc.txt")
    text = pt.fill_and_check(path, report)
    print(text[-900:])
    pt.fabrication(path, os.path.join(HERE, "fabrication"), os.path.join(HERE, NAME + "-gerber.zip"))
    pt.write_bom(b.bom, os.path.join(HERE, "nomenclature.csv"))
    pt.write_jlc(path, b.bom, os.path.join(HERE, "bom_jlcpcb.csv"), os.path.join(HERE, "cpl_jlcpcb.csv"))
    pt.svg_previews(path, os.path.join(HERE, "apercu"))
    print("écrit :", NAME + "-gerber.zip, bom_jlcpcb.csv, cpl_jlcpcb.csv")


if __name__ == "__main__":
    main()
