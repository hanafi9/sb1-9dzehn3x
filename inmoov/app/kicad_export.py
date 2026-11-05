"""Export des schémas électriques (electrical.py) en projet KiCad.

    python app/kicad_export.py kicad/          # écrit le projet dans le dossier kicad/

Produit un projet KiCad 7 (s'ouvre aussi avec KiCad 8 et 9, qui le mettent à jour) :
  - inmoov-electrique.kicad_pro / .kicad_sch : feuille racine avec les 8 sections ;
  - une feuille hiérarchique par section (alimentation, tete, cou, ...) ;
  - inmoov.kicad_sym + sym-lib-table : la bibliothèque des symboles utilisés.

Les fils suivent le même tracé que les schémas de l'Atelier. Les masses portent
l'étiquette globale « GND » et les rails d'alimentation une étiquette globale
(+6V_A, +3V3_PI…), ce qui relie ces réseaux d'une feuille à l'autre.
Ce sont des schémas de câblage (documentation) : aucun circuit imprimé n'est prévu.
"""

import datetime
import json
import os
import re
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import electrical  # noqa: E402

PROJECT = "inmoov-electrique"
LIB = "InMoov"
SCALE = 0.2      # mm par pixel des schémas de l'Atelier
GRID = 1.27
MARGIN = 25.4
PITCH = 2.54     # écart entre deux broches
NS = uuid.UUID("6f1d7c1e-6b0b-4b8e-9a52-2f3c1d0a7e11")
VERSION = "20230121"  # format KiCad 7

# nom des réseaux reliés d'une feuille à l'autre (étiquettes globales)
RAIL_NET = {
    "p_pca_tete": "+6V_A", "p_pca_gauche": "+6V_B", "p_pca_droite": "+6V_C",
    "r33": "+3V3_PI", "t33": "+3V3_PI", "rsda": "PI_SDA", "rscl": "PI_SCL",
    "h5": "+5V_MEGA2", "p13": "+12V8_PROTEGE",
    "m5": "+5V_MEGA1", "msda": "MEGA1_SDA", "mscl": "MEGA1_SCL",
}
PAPERS = [("A4", 210, 297), ("A3", 297, 420), ("A2", 420, 594), ("A1", 594, 841)]


def U(*key):
    return str(uuid.uuid5(NS, "/".join(str(k) for k in key)))


def q(text):
    return '"%s"' % str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def g(v):
    """Aligne sur la grille de 1,27 mm (sinon KiCad ne relie pas les fils)."""
    return round(round(v / GRID) * GRID, 2)


def f(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def font(size=1.27, extra=""):
    return "(effects (font (size %s %s))%s)" % (f(size), f(size), extra)


def on_seg(p, s):
    """Le point p est-il sur le segment horizontal ou vertical s (extrémités comprises) ?"""
    (x1, y1), (x2, y2) = s
    if x1 == x2 == p[0]:
        return min(y1, y2) <= p[1] <= max(y1, y2)
    if y1 == y2 == p[1]:
        return min(x1, x2) <= p[0] <= max(x1, x2)
    return False


def wrap(text, width=110):
    out, line = [], ""
    for word in text.split():
        if len(line) + len(word) + 1 > width:
            out.append(line)
            line = word
        else:
            line = (line + " " + word).strip()
    out.append(line)
    return out


# ---------------------------------------------------------------------- symboles
class Symbol:
    """Rectangle avec broches à gauche et à droite, en coordonnées KiCad (mm)."""

    def __init__(self, sheet_id, comp):
        self.name = "%s_%s" % (sheet_id, re.sub(r"[^A-Za-z0-9_]", "_", comp.id))
        self.comp = comp
        n = max(len(comp.left), len(comp.right), 1)
        longest = max([len(l) for _, l in comp.left] or [0]) + max([len(l) for _, l in comp.right] or [0])
        self.w = g(max(comp.w * SCALE, longest * 1.05 + 8, len(comp.sub) * 0.9 + 4, 20))
        self.h = (n + 2) * PITCH
        self.pins = []  # (clé, nom, numéro, x, y, côté) ; y vers le bas depuis le haut du rectangle
        num = 1
        for side, pins in (("left", comp.left), ("right", comp.right)):
            for i, (key, label) in enumerate(pins):
                x = -PITCH if side == "left" else self.w + PITCH
                # KiCad remplace les espaces des noms de broches par « _ » : espace insécable
                self.pins.append((key, (label or "~").replace(" ", "\u00a0"), str(num), x, (i + 2) * PITCH, side))
                num += 1

    def pin(self, key):
        for p in self.pins:
            if p[0] == key:
                return p
        raise KeyError(key)

    def lib(self, prefix=True):
        name = ("%s:%s" % (LIB, self.name)) if prefix else self.name
        c = self.comp
        out = ['(symbol %s (in_bom yes) (on_board yes)' % q(name),
               '(property "Reference" "U" (at 0 %s 0) %s)' % (f(1.27), font(1.27, " (justify left)")),
               '(property "Value" %s (at 0 %s 0) %s)' % (q(c.title), f(3.81), font(1.27, " (justify left)")),
               '(property "Footprint" "" (at 0 0 0) %s)' % font(1.27, " hide"),
               '(property "Datasheet" "" (at 0 0 0) %s)' % font(1.27, " hide"),
               '(symbol %s (rectangle (start 0 0) (end %s %s) (stroke (width 0.254) (type default)) '
               '(fill (type background)))' % (q(self.name + "_0_1"), f(self.w), f(-self.h))]
        if c.sub:
            out.append('(text %s (at 1.27 -1.905 0) %s)' % (q(c.sub), font(1.0, " (justify left)")))
        out.append(")")
        out.append("(symbol %s" % q(self.name + "_1_1"))
        for key, label, num, x, y, side in self.pins:
            angle = 0 if side == "left" else 180
            out.append('(pin passive line (at %s %s %d) (length 2.54) (name %s %s) (number %s %s))'
                       % (f(x), f(-y), angle, q(label), font(1.0), q(num), font(1.0)))
        out.append("))")
        return "\n".join(out)


# ---------------------------------------------------------------------- feuille
class KicadSheet:
    def __init__(self, sheet, root_uuid, sheet_uuid, page):
        self.s = sheet
        self.root_uuid, self.sheet_uuid, self.page = root_uuid, sheet_uuid, page
        self.symbols = {}
        self.pos = {}
        self.segments = {}   # réseau -> liste de segments ((x1, y1), (x2, y2))
        self.labels = []     # (nom, x, y, angle, global)
        self.no_connect = []
        self.texts = []
        self.nets = self._nets()

    # ------------------------------------------------------------ réseaux
    def _nets(self):
        parent = {}

        def find(a):
            parent.setdefault(a, a)
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for w in self.s.wires:
            parent[find(w["a"])] = find(w["b"])
        groups = {}
        for node in list(parent):
            groups.setdefault(find(node), set()).add(node)
        net_of = {}
        for members in groups.values():
            name = None
            types = {w["net"] for w in self.s.wires if w["a"] in members}
            if "gnd" in members or types == {"gnd"} or any(
                    m.startswith("rail:") and self.s.rails[m[5:]]["net"] == "gnd" for m in members):
                name = "GND"
            for m in sorted(members):
                if m.startswith("rail:") and m[5:] in RAIL_NET:
                    name = RAIL_NET[m[5:]]
            for m in members:
                net_of[m] = name or "N%d" % len(set(net_of.values()))
        # un nom unique par groupe local
        uniq = {}
        for m, n in net_of.items():
            if n.startswith("N"):
                key = find(m)
                uniq.setdefault(key, "net%d" % (len(uniq) + 1))
                net_of[m] = uniq[key]
        return net_of

    # ------------------------------------------------------------ géométrie
    def X(self, px):
        return g(MARGIN + px * SCALE)

    def place(self):
        for cid, c in self.s.comps.items():
            sym = Symbol(self.s.id, c)
            self.symbols[cid] = sym
            self.pos[cid] = (self.X(c.x), self.X(c.y))

    def pin_xy(self, ref):
        cid, key = ref.split(".", 1)
        sym = self.symbols[cid]
        _, _, _, x, y, side = sym.pin(key)
        ox, oy = self.pos[cid]
        return g(ox + x), g(oy + y), side

    def seg(self, net, a, b):
        a, b = (g(a[0]), g(a[1])), (g(b[0]), g(b[1]))
        if a != b:
            self.segments.setdefault(net, []).append((a, b))

    def clash(self, net, pts):
        """Vrai si ce tracé toucherait un fil, une broche ou une étiquette d'un autre réseau."""
        pts = [(g(x), g(y)) for x, y in pts]
        segs = list(zip(pts, pts[1:]))
        for onet, osegs in self.segments.items():
            if onet == net:
                continue
            for sa in segs:
                for so in osegs:
                    if on_seg(sa[0], so) or on_seg(sa[1], so) or on_seg(so[0], sa) or on_seg(so[1], sa):
                        return True
        for p, pnet in self.pin_points.items():
            if pnet != net and any(on_seg(p, sg) for sg in segs):
                return True
        return any(lnet != net and any(on_seg((x, y), sg) for sg in segs)
                   for _, x, y, _, _, lnet in self.labels)

    def add_path(self, net, pts):
        pts = [(g(x), g(y)) for x, y in pts]
        for p1, p2 in zip(pts, pts[1:]):
            self.seg(net, p1, p2)

    def route(self):
        self.problems = []
        self.pin_points = {}
        for cid, sym in self.symbols.items():
            for key, *_ in sym.pins:
                ref = "%s.%s" % (cid, key)
                x, y, _ = self.pin_xy(ref)
                self.pin_points[(x, y)] = self.nets.get(ref, "NC:" + ref)
        rails = {rid: {"x": self.X(r["x"]), "y1": self.X(r["y1"]), "y2": self.X(r["y2"])}
                 for rid, r in self.s.rails.items()}
        for rid, r in rails.items():
            net = self.nets.get("rail:" + rid, "GND")
            self.seg(net, (r["x"], r["y1"]), (r["x"], r["y2"]))
            name = RAIL_NET.get(rid, "GND" if self.s.rails[rid]["net"] == "gnd" else None)
            if name:
                self.labels.append((name, r["x"], r["y1"], 90, True, net))
        used = set()
        lanes = {}
        offsets = [0] + [k * GRID * sgn for k in range(1, 11) for sgn in (1, -1)]
        for w in self.s.wires:
            a, b = w["a"], w["b"]
            net = self.nets[a]
            if b == "gnd" or (w["net"] == "gnd" and not a.startswith("rail:") and not b.startswith("rail:")
                              and not w["via"]):
                # masse : petit fil + étiquette globale GND à chaque broche
                for ref in (a, b):
                    if ref == "gnd" or ref in used:
                        continue
                    used.add(ref)
                    x, y, side = self.pin_xy(ref)
                    for step in (PITCH, 2 * PITCH, 0):
                        x2 = g(x - step if side == "left" else x + step)
                        if step == 0 or not self.clash(net, [(x, y), (x2, y)]):
                            break
                    self.add_path(net, [(x, y), (x2, y)])
                    self.labels.append(("GND", x2, y, 180 if side == "left" else 0, True, net))
                continue
            if a.startswith("rail:") or b.startswith("rail:"):
                rid, ref = (a[5:], b) if a.startswith("rail:") else (b[5:], a)
                rail = rails[rid]
                x, y, side = self.pin_xy(ref)
                pts = [(x, y)]
                if w["via"]:
                    vias = [(self.X(px), self.X(py)) for px, py in w["via"]]
                    vias[0] = (vias[0][0], y)
                    pts += vias
                last = pts[-1]
                ry = min(max(last[1], rail["y1"]), rail["y2"])
                pts.append((rail["x"], last[1]))
                if ry != last[1]:
                    pts.append((rail["x"], ry))
                if self.clash(net, pts):
                    self.problems.append("%s : %s -> %s" % (self.s.id, a, b))
                self.add_path(net, pts)
                continue
            ax, ay, aside = self.pin_xy(a)
            bx, by, bside = self.pin_xy(b)
            if w["via"]:
                vias = [(self.X(px), self.X(py)) for px, py in w["via"]]
                # premier et dernier coude : même écart à la broche que sur le dessin de l'Atelier
                sax, sbx = self.s._end(a)[0], self.s._end(b)[0]
                vias[0] = (g(ax + (w["via"][0][0] - sax) * SCALE), ay)
                vias[-1] = (g(bx + (w["via"][-1][0] - sbx) * SCALE), by)
                if len(vias) > 1:
                    vias[1] = (vias[0][0], vias[1][1])
                    vias[-2] = (vias[-1][0], vias[-2][1])
                pts = [(ax, ay)] + vias + [(bx, by)]
                if self.clash(net, pts):
                    self.problems.append("%s : %s -> %s" % (self.s.id, a, b))
                self.add_path(net, pts)
                continue
            lane = w["lane"]
            if lane is None:  # même choix de couloir que le dessin de l'Atelier
                lo, hi = sorted((self.s._end(a)[0], self.s._end(b)[0]))
                k = lanes.get((lo, hi), 0)
                lanes[(lo, hi)] = k + 1
                lane = lo + 14 + k * electrical.LANE_DY
                if lane > hi - 10:
                    lane = (lo + hi) // 2
            lane = self.X(lane)
            for off in offsets:
                if ay == by and off == 0:
                    pts = [(ax, ay), (bx, by)]
                else:
                    lx = g(lane + off)
                    pts = [(ax, ay), (lx, ay), (lx, by), (bx, by)]
                if not self.clash(net, pts):
                    break
            else:
                self.problems.append("%s : %s -> %s" % (self.s.id, a, b))
            self.add_path(net, pts)
        # broches libres : drapeau « non connecté »
        connected = {w["a"] for w in self.s.wires} | {w["b"] for w in self.s.wires}
        for cid, sym in self.symbols.items():
            for key, *_ in sym.pins:
                if "%s.%s" % (cid, key) not in connected:
                    x, y, _ = self.pin_xy("%s.%s" % (cid, key))
                    self.no_connect.append((x, y))

    def split(self):
        """Coupe chaque segment là où un autre segment du même réseau s'y raccorde,
        pour que toutes les connexions se fassent bout à bout (règle de KiCad)."""
        out, junctions = [], []
        for net, segs in self.segments.items():
            pts = {p for s in segs for p in s}
            pieces = set()
            for (x1, y1), (x2, y2) in segs:
                if x1 == x2:
                    ys = sorted({y for (x, y) in pts if x == x1 and min(y1, y2) <= y <= max(y1, y2)})
                    pieces |= {((x1, ya), (x1, yb)) for ya, yb in zip(ys, ys[1:])}
                elif y1 == y2:
                    xs = sorted({x for (x, y) in pts if y == y1 and min(x1, x2) <= x <= max(x1, x2)})
                    pieces |= {((xa, y1), (xb, y1)) for xa, xb in zip(xs, xs[1:])}
                else:
                    raise ValueError("fil en biais dans %s : %s" % (self.s.id, ((x1, y1), (x2, y2))))
            ends = {}
            for p1, p2 in pieces:
                ends[p1] = ends.get(p1, 0) + 1
                ends[p2] = ends.get(p2, 0) + 1
            junctions += [p for p, n in ends.items() if n >= 3]
            out += [(net, p1, p2) for p1, p2 in sorted(pieces)]
        return out, sorted(set(junctions))

    def paper(self, extra_h):
        w = max(self.X(c.x + c.w) + 40 for c in self.s.comps.values())
        w = max(w, max(self.X(r["x"]) for r in self.s.rails.values()) + 20 if self.s.rails else 0)
        h = self.X(self.s.bottom) + extra_h + 45  # cartouche en bas à droite
        for name, pw, ph in PAPERS:
            if w <= pw and h <= ph:
                return name, pw, ph
        return PAPERS[-1]

    # ------------------------------------------------------------ fichier
    def render(self):
        self.place()
        self.route()
        segs, junctions = self.split()
        notes = []
        for n in self.s.notes:
            notes += wrap("• " + n)
        notes_h = (len(notes) + 2) * 2.0
        paper, pw, ph = self.paper(notes_h)
        today = datetime.date.today().isoformat()
        out = ['(kicad_sch (version %s) (generator eeschema)' % VERSION,
               '(uuid %s)' % self.sheet_uuid,
               '(paper "%s" portrait)' % paper,
               '(title_block (title %s) (date "%s") (rev "1") (company "Robot InMoov - Atelier InMoov") '
               '(comment 1 %s) (comment 2 "Généré par app/kicad_export.py depuis les schémas de l\'Atelier"))'
               % (q(self.s.title), today, q(self.s.subtitle)),
               "(lib_symbols"]
        out += [sym.lib() for sym in self.symbols.values()]
        out.append(")")
        for p in junctions:
            out.append('(junction (at %s %s) (diameter 0) (color 0 0 0 0) (uuid %s))'
                       % (f(p[0]), f(p[1]), U(self.s.id, "j", p)))
        for x, y in self.no_connect:
            out.append('(no_connect (at %s %s) (uuid %s))' % (f(x), f(y), U(self.s.id, "nc", x, y)))
        for net, (x1, y1), (x2, y2) in segs:
            out.append('(wire (pts (xy %s %s) (xy %s %s)) (stroke (width 0) (type default)) (uuid %s))'
                       % (f(x1), f(y1), f(x2), f(y2), U(self.s.id, "w", net, x1, y1, x2, y2)))
        for name, x, y, angle, is_global, _ in self.labels:
            just = {0: "left", 180: "right", 90: "left", 270: "right"}[angle]
            out.append('(global_label %s (shape passive) (at %s %s %d) (fields_autoplaced) %s (uuid %s))'
                       % (q(name), f(x), f(y), angle, font(1.27, " (justify %s)" % just),
                          U(self.s.id, "gl", name, x, y)))
        for x, y, txt, cls in self.s.labels:
            size = 2.0 if cls == "el-h" else 1.27
            out.append('(text %s (at %s %s 0) %s (uuid %s))'
                       % (q(txt), f(self.X(x)), f(self.X(y)), font(size, " (justify left bottom)"),
                          U(self.s.id, "t", x, y)))
        if notes:
            y0 = g(self.X(self.s.bottom) + 10)
            out.append('(text %s (at %s %s 0) %s (uuid %s))'
                       % (q("À SAVOIR\n" + "\n".join(notes)), f(MARGIN), f(y0),
                          font(1.5, " (justify left top)"), U(self.s.id, "notes")))
        ref_n = 1
        for cid, sym in self.symbols.items():
            ox, oy = self.pos[cid]
            c = sym.comp
            ref = ("X%d" if c.kind == "ref" else "U%d") % (self.page * 100 + ref_n)
            ref_n += 1
            bom = "no" if c.kind == "ref" else "yes"  # rappel d'une autre feuille : hors nomenclature
            out.append('(symbol (lib_id %s) (at %s %s 0) (unit 1) (in_bom %s) (on_board yes) (dnp no) (uuid %s)'
                       % (q("%s:%s" % (LIB, sym.name)), f(ox), f(oy), bom, U(self.s.id, "s", cid)))
            out.append('(property "Reference" %s (at %s %s 0) %s)'
                       % (q(ref), f(ox), f(oy - 1.27), font(1.27, " (justify left)")))
            out.append('(property "Value" %s (at %s %s 0) %s)'
                       % (q(c.title), f(ox + 8.89), f(oy - 1.27), font(1.27, " (justify left)")))
            out.append('(property "Footprint" "" (at %s %s 0) %s)' % (f(ox), f(oy), font(1.27, " hide")))
            out.append('(property "Datasheet" "" (at %s %s 0) %s)' % (f(ox), f(oy), font(1.27, " hide")))
            for _, _, num, *_ in sym.pins:
                out.append('(pin %s (uuid %s))' % (q(num), U(self.s.id, "p", cid, num)))
            out.append('(instances (project %s (path "/%s/%s" (reference %s) (unit 1))))'
                       % (q(PROJECT), self.root_uuid, self.sheet_uuid, q(ref)))
            out.append(")")
        out.append(")")
        return "\n".join(out) + "\n"


# ---------------------------------------------------------------------- projet
def export(directory):
    os.makedirs(directory, exist_ok=True)
    root = U("root")
    sheets = [fn() for _, fn in electrical.SHEETS]
    all_symbols = []
    files = []
    for i, s in enumerate(sheets):
        ks = KicadSheet(s, root, U("sheet", s.id), i + 2)
        text = ks.render()
        if ks.problems:
            raise ValueError("fils qui se touchent : " + "; ".join(ks.problems))
        name = "%s.kicad_sch" % s.id
        with open(os.path.join(directory, name), "w", encoding="utf-8") as fh:
            fh.write(text)
        files.append((s, name, U("sheet", s.id)))
        all_symbols += [sym.lib(prefix=False) for sym in ks.symbols.values()]
    # feuille racine : une case par section
    out = ['(kicad_sch (version %s) (generator eeschema)' % VERSION, '(uuid %s)' % root,
           '(paper "A4")',
           '(title_block (title "Robot InMoov : schémas électriques") (date "%s") (rev "1") '
           '(company "Robot InMoov - Atelier InMoov") (comment 1 "Double-cliquer sur une case pour ouvrir la section"))'
           % datetime.date.today().isoformat(),
           "(lib_symbols)"]
    out.append('(text %s (at 25.4 30.48 0) %s (uuid %s))'
               % (q("Robot InMoov : schémas électriques par section"), font(2.5, " (justify left bottom)"), U("title")))
    out.append('(text %s (at 25.4 38.1 0) %s (uuid %s))'
               % (q("Les masses (GND) et les rails (+6V_A, +3V3_PI…) sont reliés entre les feuilles par des "
                    "étiquettes globales.\nCases en pointillés dans les feuilles : rappel d'un élément dessiné "
                    "sur une autre feuille (hors nomenclature)."),
                  font(1.5, " (justify left top)"), U("intro")))
    for i, (s, name, suuid) in enumerate(files):
        x, y = 25.4 + (i % 4) * 63.5, 60.96 + (i // 4) * 50.8
        out.append('(sheet (at %s %s) (size 50.8 30.48) (fields_autoplaced) (stroke (width 0.1524) (type solid)) '
                   '(fill (color 0 0 0 0.0000)) (uuid %s)' % (f(x), f(y), suuid))
        out.append('(property "Sheetname" %s (at %s %s 0) %s)'
                   % (q(s.title), f(x), f(y - 0.71), font(1.5, " (justify left bottom)")))
        out.append('(property "Sheetfile" %s (at %s %s 0) %s)'
                   % (q(name), f(x), f(y + 31.07), font(1.27, " (justify left top)")))
        out.append('(instances (project %s (path "/%s" (page "%d"))))' % (q(PROJECT), root, i + 2))
        out.append(")")
    out.append('(sheet_instances (path "/" (page "1")))')
    out.append(")")
    with open(os.path.join(directory, PROJECT + ".kicad_sch"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    # bibliothèque de symboles
    with open(os.path.join(directory, "inmoov.kicad_sym"), "w", encoding="utf-8") as fh:
        fh.write("(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)\n")
        fh.write("\n".join(all_symbols))
        fh.write("\n)\n")
    with open(os.path.join(directory, "sym-lib-table"), "w", encoding="utf-8") as fh:
        fh.write('(sym_lib_table\n  (lib (name "%s")(type "KiCad")(uri "${KIPRJMOD}/inmoov.kicad_sym")'
                 '(options "")(descr "Symboles du robot InMoov"))\n)\n' % LIB)
    pro = {"meta": {"filename": PROJECT + ".kicad_pro", "version": 1},
           "sheets": [[root, "Racine"]] + [[u, s.title] for s, _, u in files],
           "text_variables": {}, "boards": [], "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []}}
    with open(os.path.join(directory, PROJECT + ".kicad_pro"), "w", encoding="utf-8") as fh:
        json.dump(pro, fh, indent=2, ensure_ascii=False)
    return [PROJECT + ".kicad_sch"] + [name for _, name, _ in files]


def expected_nets():
    """Pour les tests : {feuille: [ensemble de (référence, numéro de broche)]} attendus."""
    root = U("root")
    out = {}
    for page, (_, fn) in enumerate(electrical.SHEETS, start=2):
        s = fn()
        ks = KicadSheet(s, root, U("sheet", s.id), page)
        ks.place()
        refs = {cid: ("X%d" if c.kind == "ref" else "U%d") % (page * 100 + i + 1)
                for i, (cid, c) in enumerate(s.comps.items())}
        groups = {}
        for node, net in ks.nets.items():
            if node.startswith("rail:") or node == "gnd":
                continue
            cid, key = node.split(".", 1)
            num = ks.symbols[cid].pin(key)[2]
            groups.setdefault((net if not net.startswith("net") else s.id + "/" + net), set()).add((refs[cid], num))
        out[s.id] = groups
    return out


def check_netlist(netlist_text):
    """Compare le netlist exporté par KiCad (kicad-cli sch export netlist) aux connexions
    attendues. Renvoie la liste des écarts (vide = identique)."""
    nets = {}
    for m in re.finditer(r'\(net \(code "\d+"\) \(name "((?:[^"\\]|\\.)*)"\)(.*?)\)\s*(?=\(net |\)\s*\)\s*$)',
                         netlist_text, re.S):
        nets[m.group(1)] = set(re.findall(r'\(node \(ref "([^"]+)"\) \(pin "([^"]+)"\)', m.group(2)))
    node_net = {n: name for name, nodes in nets.items() for n in nodes}
    groups = {}
    for gs in expected_nets().values():
        for name, nodes in gs.items():
            groups.setdefault(name, set()).update(nodes)
    errors = []
    for name, nodes in groups.items():
        found = {node_net.get(n) for n in nodes}
        if len(found) != 1 or None in found:
            errors.append("réseau %s coupé dans KiCad" % name)
        elif nets[found.pop()] - nodes:
            errors.append("réseau %s relié à tort à d'autres broches" % name)
    return errors


def zip_bytes():
    """Le projet KiCad complet dans un fichier .zip (pour le téléchargement depuis l'Atelier)."""
    import io
    import tempfile
    import zipfile

    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp:
        names = export(tmp) + ["inmoov.kicad_sym", "sym-lib-table", PROJECT + ".kicad_pro"]
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in names:
                zf.write(os.path.join(tmp, name), "inmoov-kicad/" + name)
    return buf.getvalue()


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "kicad")
    for name in export(target):
        print("écrit", os.path.join(target, name))
