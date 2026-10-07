#!/usr/bin/env python3
"""Fabrique le circuit imprimé « shield jambes » pour l'Arduino Mega 2560 n°2.

Ce que fait la carte : elle s'enfiche sur la Mega et remplace le câblage volant
des jambes par des connecteurs à verrou JST-XH :
  - 8 connecteurs HX711 (cellules de charge des pieds) -> broches 22 à 37 ;
  - 1 connecteur centrale BNO085 (I2C, broches 20/21) ;
  - 1 connecteur adaptateur de bus des servos (TX1 18 / RX1 19) ;
  - 1 connecteur arrêt d'urgence (broche 2, résistance de rappel 4,7 kΩ + filtre 100 nF) ;
  - condensateurs de découplage du 5 V et LED « sous tension ».

Prérequis (Linux) : KiCad 7 avec ses bibliothèques (paquets kicad, kicad-footprints)
et Java 25 + Freerouting 2.5 pour le routage automatique.

    python3 build.py --freerouting /chemin/freerouting-2.5.0-executable.jar --java /chemin/java

Sorties dans ce dossier : shield_jambes.kicad_pcb (+ .kicad_pro), rapport DRC,
fabrication/ (Gerber + perçage, et le .zip à envoyer au fabricant), nomenclature.
Les positions des connecteurs de la Mega viennent de la bibliothèque « arduino-kicad-library »
(Alarm-Siren) et ont été recoupées avec l'empreinte officielle Arduino UNO R3 de KiCad
(connecteurs communs) et les trous de fixation publiés de la Mega.
"""

import argparse
import csv
import os
import re
import subprocess
import sys
import zipfile

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "shield_jambes"
FP = "/usr/share/kicad/footprints"
X0, Y0 = 100.0, 100.0  # coin bas-gauche de la Mega sur la feuille (mm)
W, H = 101.6, 53.34    # dimensions de la Mega 2560

# Broches de la Mega (repère : coin bas-gauche, y vers le haut négatif, en mm)
MEGA = {"5V_P": (38.1, -2.54), "GND_P1": (40.64, -2.54), "GND_P2": (43.18, -2.54)}
for i, name in enumerate(["NC", "IOREF", "RESET", "3V3", "5V", "GND", "GND2", "VIN"]):
    MEGA["P_" + name] = (27.94 + 2.54 * i, -2.54)
for d in range(8):
    MEGA["D%d" % d] = (63.5 - 2.54 * d, -50.8)
for d in range(14, 22):
    MEGA["D%d" % d] = (68.58 + 2.54 * (d - 14), -50.8)
for d in range(22, 54):
    MEGA["D%d" % d] = (93.98 if d % 2 == 0 else 96.52, -48.26 + 2.54 * ((d - 22) // 2))
MEGA.update({"E_5V_a": (93.98, -50.8), "E_5V_b": (96.52, -50.8), "E_GND_a": (93.98, -7.62),
             "E_GND_b": (96.52, -7.62)})
# trous de la Mega utilisés (les deux près du connecteur 2x18 sont trop proches de ses broches)
HOLES = [(13.97, -2.54), (15.24, -50.8), (66.04, -7.62), (66.04, -35.56)]

# signal de chaque broche utilisée
PIN_NET = {"P_5V": "+5V", "P_GND": "GND", "P_GND2": "GND", "E_5V_a": "+5V", "E_5V_b": "+5V",
           "E_GND_a": "GND", "E_GND_b": "GND", "D2": "ARRET", "D18": "TX1", "D19": "RX1",
           "D20": "SDA", "D21": "SCL"}
for n in range(8):
    PIN_NET["D%d" % (22 + 2 * n)] = "HX%d_DT" % n
    PIN_NET["D%d" % (23 + 2 * n)] = "HX%d_SCK" % n

FEET = ["G avant-ext", "G avant-int", "G arrière-ext", "G arrière-int",
        "D avant-ext", "D avant-int", "D arrière-ext", "D arrière-int"]


def mm(v):
    return pcbnew.FromMM(v)


def pt(x, y):
    """Point dans le repère de la Mega -> coordonnées KiCad."""
    return pcbnew.VECTOR2I(mm(X0 + x), mm(Y0 + y))


class Builder:
    def __init__(self, path):
        self.board = pcbnew.NewBoard(path)
        self.nets = {}
        self.bom = []
        ds = self.board.GetDesignSettings()
        ds.SetCopperLayerCount(2)
        ds.m_TrackMinWidth = mm(0.2)  # rétrécissement entre deux broches (signaux faibles)
        ds.m_ViasMinSize = mm(0.6)
        ds.m_MinThroughDrill = mm(0.3)
        ds.m_CopperEdgeClearance = mm(0.3)  # minimum JLCPCB / PCBWay : 0,3 mm
        nc = ds.m_NetSettings.m_DefaultNetClass
        nc.SetTrackWidth(mm(0.4))
        nc.SetClearance(mm(0.25))
        nc.SetViaDiameter(mm(0.8))
        nc.SetViaDrill(mm(0.4))

    def net(self, name):
        if name not in self.nets:
            n = pcbnew.NETINFO_ITEM(self.board, name)
            self.board.Add(n)
            self.nets[name] = n
        return self.nets[name]

    def place(self, lib, fpname, ref, value, x, y, angle=0, pads=None, bom=None):
        fp = pcbnew.FootprintLoad(os.path.join(FP, lib + ".pretty"), fpname)
        if fp is None:
            raise RuntimeError("empreinte introuvable : %s:%s" % (lib, fpname))
        fp.SetFPID(pcbnew.LIB_ID(lib, fpname))
        fp.SetReference(ref)
        fp.SetValue(value)
        fp.Reference().SetVisible(False)  # le repère est écrit dans l'étiquette de chaque connecteur
        fp.SetPosition(pt(x, y))
        fp.SetOrientationDegrees(angle)
        self.board.Add(fp)
        for pad in fp.Pads():
            name = (pads or {}).get(pad.GetNumber())
            if name:
                pad.SetNet(self.net(name))
        if bom:
            self.bom.append((ref, value, "%s:%s" % (lib, fpname), bom))
        return fp

    def header(self, ref, fpname, x, y, angle):
        """Barrette mâle qui s'enfiche dans la Mega : chaque pastille doit tomber sur une broche."""
        fp = self.place("Connector_PinHeader_2.54mm", fpname, ref, "Barrette Mega", x, y, angle,
                        bom="Barrette mâle sécable 2,54 mm")
        for pad in fp.Pads():
            p = pad.GetPosition()
            px, py = pcbnew.ToMM(p.x) - X0, pcbnew.ToMM(p.y) - Y0
            match = [k for k, (mx, my) in MEGA.items() if abs(mx - px) < 0.05 and abs(my - py) < 0.05]
            if not match:
                raise RuntimeError("%s pastille %s hors d'une broche Mega (%.2f, %.2f)" % (ref, pad.GetNumber(), px, py))
            net = next((PIN_NET[k] for k in match if k in PIN_NET), None)
            if net:
                pad.SetNet(self.net(net))
        return fp

    def text(self, txt, x, y, size=1.0, layer=pcbnew.F_SilkS, angle=0):
        t = pcbnew.PCB_TEXT(self.board)
        t.SetText(txt)
        t.SetPosition(pt(x, y))
        t.SetLayer(layer)
        t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
        t.SetTextThickness(mm(max(0.12, size * 0.15)))
        t.SetTextAngleDegrees(angle)
        self.board.Add(t)

    def outline(self):
        s = pcbnew.PCB_SHAPE(self.board)
        s.SetShape(pcbnew.SHAPE_T_RECT)
        s.SetStart(pt(0, -H))
        s.SetEnd(pt(W, 0))
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetWidth(mm(0.1))
        self.board.Add(s)

    def keepout(self, x1, y1, x2, y2, label):
        """Zone interdite au cuivre sur la face du dessous (au-dessus d'une pièce haute de la Mega)."""
        z = pcbnew.ZONE(self.board)
        z.SetIsRuleArea(True)
        z.SetDoNotAllowCopperPour(True)
        z.SetDoNotAllowVias(True)
        z.SetDoNotAllowTracks(True)
        z.SetDoNotAllowPads(False)
        z.SetDoNotAllowFootprints(False)
        z.SetLayer(pcbnew.B_Cu)
        z.SetZoneName(label)
        ol = z.Outline()
        ol.NewOutline()
        for x, y in ((x1, y1), (x2, y1), (x2, y2), (x1, y2)):
            ol.Append(mm(X0 + x), mm(Y0 + y))
        self.board.Add(z)

    def zones(self):
        for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
            z = pcbnew.ZONE(self.board)
            z.SetLayer(layer)
            z.SetNet(self.net("GND"))
            z.SetLocalClearance(mm(0.3))
            z.SetMinThickness(mm(0.25))
            z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
            ol = z.Outline()
            ol.NewOutline()
            for x, y in ((0.5, -H + 0.5), (W - 0.5, -H + 0.5), (W - 0.5, -0.5), (0.5, -0.5)):
                ol.Append(mm(X0 + x), mm(Y0 + y))
            self.board.Add(z)
        pcbnew.ZONE_FILLER(self.board).Fill(self.board.Zones())


def build_board(path):
    b = Builder(path)
    b.outline()
    # barrettes vers la Mega
    b.header("J1", "PinHeader_1x08_P2.54mm_Vertical", 27.94, -2.54, 90)   # alimentation
    b.header("J2", "PinHeader_1x08_P2.54mm_Vertical", 45.72, -50.8, 90)   # D7..D0
    b.header("J3", "PinHeader_1x08_P2.54mm_Vertical", 68.58, -50.8, 90)   # D14..D21
    b.header("J4", "PinHeader_2x18_P2.54mm_Vertical", 93.98, -50.8, 0)     # 5V, D22..D53, GND
    for i, (x, y) in enumerate(HOLES):
        b.place("MountingHole", "MountingHole_3.2mm_M3", "H%d" % (i + 1), "M3", x, y)
    # 8 connecteurs HX711 : broche 1 GND, 2 DT, 3 SCK, 4 VCC (ordre du module HX711 vert)
    for n in range(8):
        col, row = divmod(n, 4)
        x, y = 24.0 + 18.0 * col, -41.0 + 9.5 * row
        b.place("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical", "J%d" % (10 + n),
                "HX711 n°%d" % n, x, y,
                pads={"1": "GND", "2": "HX%d_DT" % n, "3": "HX%d_SCK" % n, "4": "+5V"},
                bom="JST-XH 4 broches droit (B4B-XH-A) + câble")
        b.text("J%d HX%d %s" % (10 + n, n, FEET[n]), x + 3.75, y - 3.6, 0.9)
        b.text("GND DT SCK 5V", x + 3.75, y + 4.6, 0.8)
    b.place("Connector_JST", "JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical", "J20", "BNO085", 73.0, -42.5,
            pads={"1": "GND", "2": "+5V", "3": "SDA", "4": "SCL"}, bom="JST-XH 4 broches droit (B4B-XH-A) + câble")
    b.text("J20 BNO085 (I2C)", 76.75, -46.1, 0.9)
    b.text("GND 5V SDA SCL", 76.75, -37.9, 0.8)
    b.place("Connector_JST", "JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical", "J21", "Bus servos", 73.0, -33.0,
            pads={"1": "TX1", "2": "RX1", "3": "GND"}, bom="JST-XH 3 broches droit (B3B-XH-A) + câble")
    b.text("J21 bus servos", 75.5, -36.6, 0.9)
    b.text("TX RX GND", 75.5, -28.4, 0.8)
    b.place("Connector_JST", "JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical", "J22", "Arret urgence", 73.0, -22.5,
            pads={"1": "ARRET", "2": "GND"}, bom="JST-XH 2 broches droit (B2B-XH-A) + câble")
    b.text("J22 arrêt NF", 74.25, -26.1, 0.9)
    # composants
    b.place("Resistor_THT", "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal", "R1", "4,7k", 82.0, -22.5,
            pads={"1": "+5V", "2": "ARRET"}, bom="Résistance 4,7 kΩ 1/4 W")
    b.place("Capacitor_THT", "C_Disc_D5.0mm_W2.5mm_P5.00mm", "C1", "100nF", 82.0, -29.5,
            pads={"1": "ARRET", "2": "GND"}, bom="Condensateur céramique 100 nF")
    b.place("Capacitor_THT", "CP_Radial_D6.3mm_P2.50mm", "C2", "100uF", 73.0, -14.5,
            pads={"1": "+5V", "2": "GND"}, bom="Condensateur électrolytique 100 µF 16 V, Ø 6,3 mm")
    b.place("Capacitor_THT", "C_Disc_D5.0mm_W2.5mm_P5.00mm", "C3", "100nF", 81.0, -14.5,
            pads={"1": "+5V", "2": "GND"}, bom="Condensateur céramique 100 nF")
    b.place("LED_THT", "LED_D3.0mm", "D1", "LED", 72.0, -7.5,
            pads={"1": "GND", "2": "LED_A"}, bom="LED 3 mm verte")
    b.place("Resistor_THT", "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal", "R2", "1k", 78.0, -7.5,
            pads={"1": "LED_A", "2": "+5V"}, bom="Résistance 1 kΩ 1/4 W")
    # pièces hautes de la Mega sous le shield : pas de cuivre ni de via au-dessous
    b.keepout(60.5, -33.5, 69.5, -22.5, "ICSP de la Mega")
    b.keepout(0.5, -45.0, 18.0, -27.0, "prise USB de la Mega")
    b.keepout(0.5, -15.0, 15.0, -0.5, "prise d'alimentation de la Mega")
    b.text("InMoov · shield jambes v1", 24.0, -48.0, 1.2)
    b.text("Arduino Mega n°2", 24.0, -46.2, 0.9)
    b.text("Isoler sous la carte au-dessus de la prise USB", 3.0, -30.0, 0.8, pcbnew.B_SilkS, 90)
    return b


# ---------------------------------------------------------------- routage
def import_ses(board, ses_path):
    """Ajoute les pistes et vias d'une session Freerouting (.ses) au circuit."""
    text = open(ses_path, encoding="utf-8").read()
    res = re.search(r"\(resolution\s+(\w+)\s+(\d+)\)", text)
    unit, per = res.group(1), float(res.group(2))
    scale = {"um": 0.001, "mm": 1.0, "mil": 0.0254}[unit] / per
    nets = {n.GetNetname(): n for n in board.GetNetInfo().NetsByName().values()}
    layers = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}
    count = 0
    for m in re.finditer(r'\(net\s+("?)([^"\s)]+)\1(.*?)(?=\(net\s|\)\s*\)\s*\)\s*$)', text, re.S):
        net = nets[m.group(2)]
        body = m.group(3)
        for layer, width, coords in re.findall(r"\(path\s+(\S+)\s+(\d+)\s+([-\d\s]+)\)", body):
            vals = [float(v) for v in coords.split()]
            ptsl = [(vals[i] * scale, -vals[i + 1] * scale) for i in range(0, len(vals), 2)]
            for (x1, y1), (x2, y2) in zip(ptsl, ptsl[1:]):
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(pcbnew.VECTOR2I(mm(x1), mm(y1)))
                t.SetEnd(pcbnew.VECTOR2I(mm(x2), mm(y2)))
                t.SetWidth(mm(float(width) * scale))
                t.SetLayer(layers[layer])
                t.SetNet(net)
                board.Add(t)
                count += 1
        for x, y in re.findall(r'\(via\s+"?[^"\s]+"?\s+(-?\d+)\s+(-?\d+)', body):
            v = pcbnew.PCB_VIA(board)
            v.SetPosition(pcbnew.VECTOR2I(mm(float(x) * scale), mm(-float(y) * scale)))
            v.SetWidth(mm(0.8))
            v.SetDrill(mm(0.4))
            v.SetNet(net)
            board.Add(v)
            count += 1
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--freerouting", required=True)
    ap.add_argument("--java", default="java")
    ap.add_argument("--passes", type=int, default=40)
    args = ap.parse_args()
    pcb = os.path.join(HERE, NAME + ".kicad_pcb")
    b = build_board(pcb)
    pcbnew.SaveBoard(pcb, b.board)
    dsn, ses = os.path.join(HERE, NAME + ".dsn"), os.path.join(HERE, NAME + ".ses")
    if not pcbnew.ExportSpecctraDSN(b.board, dsn):
        sys.exit("export DSN impossible")
    subprocess.run([args.java, "-jar", args.freerouting, "-de", dsn, "-do", ses, "-mp", str(args.passes),
                    "--gui.enabled=false"], check=True)
    board = pcbnew.LoadBoard(pcb)
    print("pistes et vias importés :", import_ses(board, ses))
    # plans de masse sur les deux faces, après le routage
    b.board = board
    b.nets = {n.GetNetname(): n for n in board.GetNetInfo().NetsByName().values()}
    b.zones()
    report = os.path.join(HERE, "drc.txt")
    for _ in range(3):
        pcbnew.SaveBoard(pcb, board)
        pcbnew.WriteDRCReport(board, report, pcbnew.EDA_UNITS_MILLIMETRES, True)
        text = open(report, encoding="utf-8").read()
        # pastille de masse coincée entre d'autres broches : liaison pleine au plan de masse
        starved = re.findall(r"starved_thermal.*?\n.*?\n.*?\n\s+@\([^)]*\): PTH pad (\S+) \[GND\] of (\S+)", text)
        if not starved:
            break
        for num, ref in starved:
            for pad in board.FindFootprintByReference(ref).Pads():
                if pad.GetNumber() == num:
                    pad.SetZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    print(text[-1200:])
    for f in (dsn, ses):
        os.remove(f)
    # fabrication
    fab = os.path.join(HERE, "fabrication")
    os.makedirs(fab, exist_ok=True)
    for f in os.listdir(fab):
        os.remove(os.path.join(fab, f))
    layers = "F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
    subprocess.run(["kicad-cli", "pcb", "export", "gerbers", "-o", fab + "/", "--layers", layers,
                    "--subtract-soldermask", pcb], check=True)
    subprocess.run(["kicad-cli", "pcb", "export", "drill", "-o", fab + "/", "--format", "excellon",
                    "--excellon-separate-th", "--generate-map", "--map-format", "pdf", pcb], check=True)
    zpath = os.path.join(HERE, NAME + "-gerber.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(fab)):
            if not f.endswith(".pdf"):
                z.write(os.path.join(fab, f), f)
    with open(os.path.join(HERE, "nomenclature.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["Repère", "Valeur", "Empreinte KiCad", "Composant à acheter"])
        for row in b.bom:
            w.writerow(row)
    print("écrit :", zpath)


if __name__ == "__main__":
    main()
