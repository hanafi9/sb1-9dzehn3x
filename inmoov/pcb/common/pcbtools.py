"""Outils communs pour fabriquer les circuits imprimés du robot avec KiCad 7 (pcbnew).

Chaque carte a son build.py qui place les composants (empreintes officielles KiCad),
puis appelle les fonctions ci-dessous : routage Freerouting, plans de cuivre,
vérification DRC, fichiers Gerber / perçage et, si besoin, fichiers d'assemblage
JLCPCB (nomenclature + positions des composants CMS).
"""

import csv
import os
import re
import subprocess
import zipfile

import pcbnew

FP = "/usr/share/kicad/footprints"


def mm(v):
    return pcbnew.FromMM(v)


class Board:
    def __init__(self, path, x0=100.0, y0=100.0, copper_oz=1):
        self.path = path
        self.x0, self.y0 = x0, y0
        self.board = pcbnew.NewBoard(path)
        self.nets = {}
        self.bom = []  # (repère, valeur, empreinte, description, lcsc, référence fabricant, cms?)
        ds = self.board.GetDesignSettings()
        ds.SetCopperLayerCount(2)
        ds.m_TrackMinWidth = mm(0.15)  # le routeur rétrécit parfois la piste entre deux broches (fabricable : 0,127 mm)
        ds.m_ViasMinSize = mm(0.6)
        ds.m_MinThroughDrill = mm(0.3)
        ds.m_CopperEdgeClearance = mm(0.3)
        nc = ds.m_NetSettings.m_DefaultNetClass
        nc.SetTrackWidth(mm(0.3))
        nc.SetClearance(mm(0.2))
        nc.SetViaDiameter(mm(0.7))
        nc.SetViaDrill(mm(0.35))
        self.copper_oz = copper_oz

    # ------------------------------------------------------------ outils
    def pt(self, x, y):
        return pcbnew.VECTOR2I(mm(self.x0 + x), mm(self.y0 + y))

    def net(self, name):
        if name not in self.nets:
            n = pcbnew.NETINFO_ITEM(self.board, name)
            self.board.Add(n)
            self.nets[name] = n
        return self.nets[name]

    def place(self, lib, fpname, ref, value, x, y, angle=0, pads=None, bom=None, lcsc="", mpn="", hide_ref=False,
              back=False, libdir=None, full=False):
        fp = pcbnew.FootprintLoad(os.path.join(libdir or FP, lib + ".pretty"), fpname)
        if fp is None:
            raise RuntimeError("empreinte introuvable : %s:%s" % (lib, fpname))
        fp.SetFPID(pcbnew.LIB_ID(lib, fpname))
        fp.SetReference(ref)
        fp.SetValue(value)
        fp.SetPosition(self.pt(x, y))
        fp.SetOrientationDegrees(angle)
        if hide_ref:
            fp.Reference().SetVisible(False)
        self.board.Add(fp)
        if back:
            fp.Flip(fp.GetPosition(), False)
        for pad in fp.Pads():
            name = (pads or {}).get(pad.GetNumber())
            if name:
                pad.SetNet(self.net(name))
            if full:  # fort courant : pastille reliée en plein au plan de cuivre
                pad.SetZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
        if bom:
            smd = fp.GetAttributes() & pcbnew.FP_SMD
            self.bom.append((ref, value, "%s:%s" % (lib, fpname), bom, lcsc, mpn, bool(smd)))
        return fp

    def pad_xy(self, ref, num):
        """Position (repère de la carte) d'une pastille."""
        fp = self.board.FindFootprintByReference(ref)
        for p in fp.Pads():
            if p.GetNumber() == num:
                q = p.GetPosition()
                return pcbnew.ToMM(q.x) - self.x0, pcbnew.ToMM(q.y) - self.y0
        raise KeyError("%s.%s" % (ref, num))

    def text(self, txt, x, y, size=1.0, layer=pcbnew.F_SilkS, angle=0, bold=False):
        t = pcbnew.PCB_TEXT(self.board)
        t.SetText(txt)
        t.SetPosition(self.pt(x, y))
        t.SetLayer(layer)
        t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
        t.SetTextThickness(mm(max(0.15, size * (0.2 if bold else 0.15))))
        t.SetTextAngleDegrees(angle)
        if layer == pcbnew.B_SilkS:
            t.SetMirrored(True)
        self.board.Add(t)

    def outline(self, w, h, radius=0):
        s = pcbnew.PCB_SHAPE(self.board)
        s.SetShape(pcbnew.SHAPE_T_RECT)
        s.SetStart(self.pt(0, 0))
        s.SetEnd(self.pt(w, h))
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetWidth(mm(0.1))
        self.board.Add(s)

    def track(self, net, pts, width, layer=pcbnew.F_Cu):
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            t = pcbnew.PCB_TRACK(self.board)
            t.SetStart(self.pt(x1, y1))
            t.SetEnd(self.pt(x2, y2))
            t.SetWidth(mm(width))
            t.SetLayer(layer)
            t.SetNet(self.net(net))
            t.SetLocked(True)
            self.board.Add(t)

    def via(self, net, x, y, size=0.8, drill=0.4):
        v = pcbnew.PCB_VIA(self.board)
        v.SetPosition(self.pt(x, y))
        v.SetWidth(mm(size))
        v.SetDrill(mm(drill))
        v.SetNet(self.net(net))
        v.SetLocked(True)
        self.board.Add(v)

    def zone(self, net, layer, poly, priority=0, clearance=0.3, thermal=True, name=""):
        z = pcbnew.ZONE(self.board)
        z.SetLayer(layer)
        if net:
            z.SetNet(self.net(net))
        z.SetAssignedPriority(priority) if hasattr(z, "SetAssignedPriority") else z.SetPriority(priority)
        z.SetLocalClearance(mm(clearance))
        z.SetMinThickness(mm(0.25))
        z.SetThermalReliefSpokeWidth(mm(0.6))
        z.SetThermalReliefGap(mm(0.4))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL if thermal else pcbnew.ZONE_CONNECTION_FULL)
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)  # pas de cuivre isolé
        if name:
            z.SetZoneName(name)
        ol = z.Outline()
        ol.NewOutline()
        for x, y in poly:
            ol.Append(mm(self.x0 + x), mm(self.y0 + y))
        self.board.Add(z)
        return z

    def keepout(self, layer, poly, tracks=True, vias=True, pour=False, name=""):
        z = pcbnew.ZONE(self.board)
        z.SetIsRuleArea(True)
        z.SetDoNotAllowCopperPour(pour)
        z.SetDoNotAllowVias(vias)
        z.SetDoNotAllowTracks(tracks)
        z.SetDoNotAllowPads(False)
        z.SetDoNotAllowFootprints(False)
        z.SetLayer(layer)
        if name:
            z.SetZoneName(name)
        ol = z.Outline()
        ol.NewOutline()
        for x, y in poly:
            ol.Append(mm(self.x0 + x), mm(self.y0 + y))
        self.board.Add(z)


LOCAL_LIB = "DomokamiConnect"


def local_library(board_dir):
    """Bibliothèque d'empreintes propre au projet (référencée par fp-lib-table)."""
    lib_dir = os.path.join(board_dir, LOCAL_LIB + ".pretty")
    os.makedirs(lib_dir, exist_ok=True)
    with open(os.path.join(board_dir, "fp-lib-table"), "w", encoding="utf-8") as fh:
        fh.write('(fp_lib_table\n  (lib (name "%s")(type "KiCad")(uri "${KIPRJMOD}/%s.pretty")(options "")'
                 '(descr "Empreintes DOMOKAMI CONNECT"))\n)\n' % (LOCAL_LIB, LOCAL_LIB))
    return lib_dir


def servo_block_footprint(lib_dir, name="Servo_4x3_P2.54mm"):
    """4 connecteurs de servo côte à côte (signal, +, −), pastilles reliées en plein aux plans de cuivre."""
    fp = pcbnew.FOOTPRINT(None)
    fp.SetFPID(pcbnew.LIB_ID(LOCAL_LIB, name))
    fp.SetReference("J**")
    fp.SetValue(name)
    fp.SetDescription("4 connecteurs de servo 3 broches au pas de 2,54 mm (S, +, -)")
    fp.SetAttributes(pcbnew.FP_THROUGH_HOLE)
    for c in range(4):
        for r in range(3):
            p = pcbnew.PAD(fp)
            p.SetNumber(str(3 * c + r + 1))
            p.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
            p.SetShape(pcbnew.PAD_SHAPE_RECT if (c, r) == (0, 0) else pcbnew.PAD_SHAPE_OVAL)
            p.SetSize(pcbnew.VECTOR2I(mm(1.7), mm(1.7)))
            p.SetDrillSize(pcbnew.VECTOR2I(mm(1.0), mm(1.0)))
            p.SetLayerSet(pcbnew.PAD.PTHMask())
            p.SetPos0(pcbnew.VECTOR2I(mm(2.54 * c), mm(2.54 * r)))
            p.SetPosition(pcbnew.VECTOR2I(mm(2.54 * c), mm(2.54 * r)))
            p.SetZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
            fp.Add(p)
    for layer, d, width in ((pcbnew.F_CrtYd, 1.4, 0.05), (pcbnew.F_SilkS, 1.33, 0.12)):
        sh = pcbnew.FP_SHAPE(fp)
        sh.SetShape(pcbnew.SHAPE_T_RECT)
        sh.SetStart0(pcbnew.VECTOR2I(mm(-d), mm(-d)))
        sh.SetEnd0(pcbnew.VECTOR2I(mm(3 * 2.54 + d), mm(2 * 2.54 + d)))
        sh.SetLayer(layer)
        sh.SetWidth(mm(width))
        fp.Add(sh)
        sh.SetDrawCoord()
    fp.Reference().SetLayer(pcbnew.F_Fab)
    fp.Value().SetLayer(pcbnew.F_Fab)
    pcbnew.FootprintSave(lib_dir, fp)
    return name


def rect(x1, y1, x2, y2):
    return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]


# ---------------------------------------------------------------- routage
def import_ses(board, ses_path):
    """Ajoute les pistes et vias d'une session Freerouting (.ses) au circuit."""
    text = open(ses_path, encoding="utf-8").read()
    res = re.search(r"\(resolution\s+(\w+)\s+(\d+)\)", text)
    scale = {"um": 0.001, "mm": 1.0, "mil": 0.0254}[res.group(1)] / float(res.group(2))
    nets = {n.GetNetname(): n for n in board.GetNetInfo().NetsByName().values()}
    layers = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}
    count = 0
    routes = text[text.find("(network_out"):]
    for m in re.finditer(r'\(net\s+("?)([^"\s)]+)\1(.*?)(?=\(net\s|\Z)', routes, re.S):
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
            v.SetWidth(mm(0.7))
            v.SetDrill(mm(0.35))
            v.SetNet(net)
            board.Add(v)
            count += 1
    return count


def autoroute(path, freerouting, java, passes=100, unrouted_nets=()):
    """Exporte le circuit en Specctra, le route avec Freerouting et réimporte les pistes.
    unrouted_nets : réseaux laissés aux plans de cuivre (retirés pendant le routage)."""
    board = pcbnew.LoadBoard(path)
    saved = []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetname() in unrouted_nets:
                saved.append((fp.GetReference(), pad.GetNumber(), pad.GetPosition(), pad.GetNetname()))
                pad.SetNetCode(0)
    dsn, ses = path[:-10] + ".dsn", path[:-10] + ".ses"
    if not pcbnew.ExportSpecctraDSN(board, dsn):
        raise RuntimeError("export DSN impossible")
    run = subprocess.run([java, "-jar", freerouting, "-de", dsn, "-do", ses, "-mp", str(passes),
                          "--gui.enabled=false"], check=True, capture_output=True, text=True)
    final = re.findall(r"Auto-routing stage completed.*?\((\d+) unrouted and (\d+) violations\)", run.stdout + run.stderr)
    if final:
        print("Freerouting : %s liaison(s) non routée(s), %s violation(s)" % final[-1])
    board = pcbnew.LoadBoard(path)  # circuit d'origine (avec ses pistes de puissance)
    n = import_ses(board, ses)
    remove_dangling_vias(board)
    for f in (dsn, ses):
        os.remove(f)
    pcbnew.SaveBoard(path, board)
    return n


def remove_dangling_vias(board):
    """Supprime les vias laissés par le routeur qui ne relient pas une piste du dessus à une du dessous."""
    ends = {}
    for t in board.GetTracks():
        if t.GetClass() == "PCB_TRACK":
            for p in (t.GetStart(), t.GetEnd()):
                ends.setdefault((p.x, p.y, t.GetNetCode()), set()).add(t.GetLayer())
    for v in [t for t in board.GetTracks() if t.GetClass() == "PCB_VIA" and not t.IsLocked()]:
        p = v.GetPosition()
        if ends.get((p.x, p.y, v.GetNetCode()), set()) != {pcbnew.F_Cu, pcbnew.B_Cu}:
            board.Remove(v)


def _seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / float(dx * dx + dy * dy)))
    return ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5


def stitch(path, net, regions, step=4.0, via=0.7, drill=0.35, clearance=0.35):
    """Vias de couture : relient les plans « net » des deux faces dans les régions données
    (rectangles x1, y1, x2, y2 en mm, repère de la carte), loin de tout autre élément."""
    board = pcbnew.LoadBoard(path)
    x0, y0 = 100.0, 100.0
    netinfo = board.GetNetInfo().GetNetItem(net)
    items = []
    for t in board.GetTracks():
        a, b = t.GetStart(), t.GetEnd()
        w = pcbnew.ToMM(t.GetWidth()) / 2
        items.append((pcbnew.ToMM(a.x), pcbnew.ToMM(a.y), pcbnew.ToMM(b.x), pcbnew.ToMM(b.y), w))
    for fp in board.GetFootprints():
        bb = fp.GetCourtyard(pcbnew.F_CrtYd).BBox() if fp.GetCourtyard(pcbnew.F_CrtYd).OutlineCount() else None
        if bb is not None:
            items.append(("box", pcbnew.ToMM(bb.GetX()), pcbnew.ToMM(bb.GetY()), pcbnew.ToMM(bb.GetRight()),
                          pcbnew.ToMM(bb.GetBottom())))
        for p in fp.Pads():
            q = p.GetPosition()
            r = max(pcbnew.ToMM(p.GetSize().x), pcbnew.ToMM(p.GetSize().y)) / 2
            items.append((pcbnew.ToMM(q.x), pcbnew.ToMM(q.y), pcbnew.ToMM(q.x), pcbnew.ToMM(q.y), r))
    for d in board.GetDrawings():  # pas de via à travers les inscriptions
        if d.GetClass() == "PCB_TEXT":
            bb = d.GetBoundingBox()
            items.append(("box", pcbnew.ToMM(bb.GetX()) - 0.3, pcbnew.ToMM(bb.GetY()) - 0.3,
                          pcbnew.ToMM(bb.GetRight()) + 0.3, pcbnew.ToMM(bb.GetBottom()) + 0.3))
    rule_areas = [z for z in board.Zones() if z.GetIsRuleArea()]
    added = 0
    for x1, y1, x2, y2 in regions:
        y = y1
        while y <= y2:
            x = x1
            while x <= x2:
                X, Y = x0 + x, y0 + y
                ok = True
                for it in items:
                    if it[0] == "box":
                        if it[1] - 0.2 <= X <= it[3] + 0.2 and it[2] - 0.2 <= Y <= it[4] + 0.2:
                            ok = False
                            break
                    elif _seg_dist(X, Y, *it[:4]) < it[4] + via / 2 + clearance:
                        ok = False
                        break
                pos = pcbnew.VECTOR2I(mm(X), mm(Y))
                if ok and any(z.GetDoNotAllowVias() and z.Outline().Contains(pos) for z in rule_areas):
                    ok = False
                if ok:
                    v = pcbnew.PCB_VIA(board)
                    v.SetPosition(pos)
                    v.SetWidth(mm(via))
                    v.SetDrill(mm(drill))
                    v.SetNet(netinfo)
                    board.Add(v)
                    items.append((X, Y, X, Y, via / 2))
                    added += 1
                x += step
            y += step
    pcbnew.SaveBoard(path, board)
    return added


def pad_vias(path, net, region, offset=1.3, via=0.7, drill=0.35, clearance=0.3):
    """Un via (et une courte piste) à côté de chaque pastille CMS « net » de la face du dessus située
    dans region (x1, y1, x2, y2) : chaque pastille rejoint directement le plan du dessous."""
    board = pcbnew.LoadBoard(path)
    netinfo = board.GetNetInfo().GetNetItem(net)
    x1, y1, x2, y2 = [v + 100.0 for v in region]
    obstacles = []
    for t in board.GetTracks():
        a, b = t.GetStart(), t.GetEnd()
        obstacles.append((pcbnew.ToMM(a.x), pcbnew.ToMM(a.y), pcbnew.ToMM(b.x), pcbnew.ToMM(b.y),
                          pcbnew.ToMM(t.GetWidth()) / 2, t.GetNetname()))
    pads = []
    for fp in board.GetFootprints():
        for p in fp.Pads():
            q = p.GetPosition()
            pads.append((pcbnew.ToMM(q.x), pcbnew.ToMM(q.y), max(pcbnew.ToMM(p.GetSize().x),
                         pcbnew.ToMM(p.GetSize().y)) / 2, p.GetNetname(), p))
    holes = [(pcbnew.ToMM(t.GetPosition().x), pcbnew.ToMM(t.GetPosition().y))
             for t in board.GetTracks() if t.GetClass() == "PCB_VIA"]
    added = 0
    for px, py, pr, pnet, pad in pads:
        if pnet != net or pad.GetAttribute() != pcbnew.PAD_ATTRIB_SMD or not (x1 <= px <= x2 and y1 <= py <= y2):
            continue
        for dx, dy in ((0, offset), (0, -offset), (offset, 0), (-offset, 0), (offset, offset), (-offset, offset),
                       (offset, -offset), (-offset, -offset)):
            vx, vy = px + dx, py + dy
            ok = all(_seg_dist(vx, vy, *o[:4]) >= o[4] + via / 2 + clearance for o in obstacles if o[5] != net)
            ok = ok and all(((vx - qx) ** 2 + (vy - qy) ** 2) ** 0.5 >= qr + via / 2 + clearance
                            for qx, qy, qr, qn, _ in pads if qn != net)
            # la piste du pad au via ne doit pas frôler un autre réseau
            ok = ok and all(_seg_dist(qx, qy, px, py, vx, vy) >= qr + 0.15 + clearance
                            for qx, qy, qr, qn, _ in pads if qn != net)
            ok = ok and all(((vx - hx) ** 2 + (vy - hy) ** 2) ** 0.5 >= via + clearance for hx, hy in holes)
            # la courte piste ne doit croiser aucune piste d'un autre réseau
            samples = [(px + (vx - px) * k / 10.0, py + (vy - py) * k / 10.0) for k in range(11)]
            ok = ok and all(_seg_dist(sx, sy, *o[:4]) >= o[4] + 0.15 + clearance
                            for sx, sy in samples for o in obstacles if o[5] != net)
            if ok:
                holes.append((vx, vy))
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(pcbnew.VECTOR2I(mm(px), mm(py)))
                t.SetEnd(pcbnew.VECTOR2I(mm(vx), mm(vy)))
                t.SetWidth(mm(0.3))
                t.SetLayer(pcbnew.F_Cu)
                t.SetNet(netinfo)
                board.Add(t)
                v = pcbnew.PCB_VIA(board)
                v.SetPosition(pcbnew.VECTOR2I(mm(vx), mm(vy)))
                v.SetWidth(mm(via))
                v.SetDrill(mm(drill))
                v.SetNet(netinfo)
                board.Add(v)
                obstacles.append((vx, vy, vx, vy, via / 2, net))
                added += 1
                break
    pcbnew.SaveBoard(path, board)
    return added


def remove_floating_stitches(board, net="GND"):
    """Supprime les vias de couture qui ne relient que des îlots de cuivre entre eux (pas au plan principal).
    Les îlots, devenus isolés, sont ensuite retirés au remplissage."""
    frags = []  # (couche, polygone)
    for z in board.Zones():
        if z.GetNetname() == net and not z.GetIsRuleArea():
            poly = z.GetFilledPolysList(z.GetLayer())
            for i in range(poly.OutlineCount()):
                frags.append((z.GetLayer(), poly.Outline(i), abs(poly.Outline(i).Area())))
    if not frags:
        return 0

    def where(pos, layer):
        return [k for k, (l, o, _) in enumerate(frags) if l == layer and o.PointInside(pos)]

    parent = list(range(len(frags)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    links = []
    for t in board.GetTracks():
        if t.GetClass() == "PCB_VIA" and t.GetNetname() == net:
            ks = where(t.GetPosition(), pcbnew.F_Cu) + where(t.GetPosition(), pcbnew.B_Cu)
            links.append((t, ks))
    for fp in board.GetFootprints():
        for p in fp.Pads():
            if p.GetNetname() == net:
                ks = where(p.GetPosition(), pcbnew.F_Cu) + where(p.GetPosition(), pcbnew.B_Cu)
                links.append((None, ks))
    for _, ks in links:
        for k in ks[1:]:
            parent[find(k)] = find(ks[0])
    # le groupe principal : celui qui contient le plus grand morceau de cuivre
    main = find(max(range(len(frags)), key=lambda k: frags[k][2]))
    removed = 0
    for via, ks in links:
        if via is not None and not via.IsLocked() and ks and all(find(k) != main for k in ks):
            board.Remove(via)
            removed += 1
    return removed


def fill_and_check(path, report):
    """Remplit les plans, corrige les liaisons thermiques coincées et écrit le rapport DRC."""
    board = pcbnew.LoadBoard(path)
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    for _ in range(3):
        if not remove_floating_stitches(board):
            break
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    text = ""
    for _ in range(4):
        pcbnew.SaveBoard(path, board)
        pcbnew.WriteDRCReport(board, report, pcbnew.EDA_UNITS_MILLIMETRES, True)
        text = open(report, encoding="utf-8").read()
        starved = re.findall(r"starved_thermal.*?\n.*?\n.*?\n\s+@\([^)]*\): (?:PTH pad|SMD pad|Pad) (\S+) \[[^\]]+\] of (\S+)",
                             text)
        if not starved:
            break
        for num, ref in starved:
            for pad in board.FindFootprintByReference(ref).Pads():
                if pad.GetNumber() == num:
                    pad.SetZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    return text


def fabrication(path, out_dir, zip_path):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    layers = "F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,F.Paste,Edge.Cuts"
    subprocess.run(["kicad-cli", "pcb", "export", "gerbers", "-o", out_dir + "/", "--layers", layers,
                    "--subtract-soldermask", path], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["kicad-cli", "pcb", "export", "drill", "-o", out_dir + "/", "--format", "excellon",
                    "--excellon-separate-th", "--generate-map", "--map-format", "pdf", path], check=True,
                   stdout=subprocess.DEVNULL)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(out_dir)):
            if not f.endswith(".pdf"):
                z.write(os.path.join(out_dir, f), f)


def write_bom(bom, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["Repère", "Valeur", "Empreinte KiCad", "Composant", "LCSC", "Référence fabricant", "Soudé par"])
        for ref, value, fp, desc, lcsc, mpn, smd in bom:
            w.writerow([ref, value, fp, desc, lcsc, mpn, "JLCPCB" if smd else "vous"])


def write_jlc(board_path, bom, bom_path, cpl_path):
    """Fichiers d'assemblage JLCPCB pour les composants CMS (face avant)."""
    groups = {}
    for ref, value, fp, desc, lcsc, mpn, smd in bom:
        if smd:
            groups.setdefault((value, fp.split(":")[1], lcsc), []).append(ref)
    with open(bom_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
        for (value, fp, lcsc), refs in sorted(groups.items()):
            w.writerow([value, ",".join(refs), fp, lcsc])
    board = pcbnew.LoadBoard(board_path)
    smd_refs = {r for refs in groups.values() for r in refs}
    with open(cpl_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        for fp in board.GetFootprints():
            if fp.GetReference() in smd_refs:
                p = fp.GetPosition()
                w.writerow([fp.GetReference(), "%.4fmm" % pcbnew.ToMM(p.x), "%.4fmm" % -pcbnew.ToMM(p.y),
                            "Top" if fp.GetLayer() == pcbnew.F_Cu else "Bottom",
                            "%.0f" % (fp.GetOrientationDegrees() % 360)])


def svg_previews(path, out_prefix):
    subprocess.run(["kicad-cli", "pcb", "export", "svg", "-o", out_prefix + "-dessus.svg", "--layers",
                    "F.Cu,F.SilkS,Edge.Cuts", "--exclude-drawing-sheet", "--page-size-mode", "2", path],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["kicad-cli", "pcb", "export", "svg", "-o", out_prefix + "-dessous.svg", "--layers",
                    "B.Cu,B.SilkS,Edge.Cuts", "--exclude-drawing-sheet", "--page-size-mode", "2", "--mirror",
                    path], check=True, stdout=subprocess.DEVNULL)
