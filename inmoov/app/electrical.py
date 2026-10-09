"""Schémas électriques détaillés, une feuille par section du robot.

Chaque feuille contient des composants (avec leurs broches), des fils entre
broches et des « rails » (barres d'alimentation ou de bus). On en tire :
  - un dessin SVG (même rendu à l'écran et à l'impression) ;
  - la liste de câblage (de → à, type de fil, couleur, section conseillée).

Les servos, cartes et canaux viennent de wiring.py : les schémas restent
cohérents avec l'onglet Servos et le script MyRobotLab.

Valeurs vérifiées (fiches techniques / documentation des fabricants) :
  - Hitec HS-805BB : 4,8 à 6,0 V, 6 A au blocage -> rail servos à 6,0 V maximum ;
  - HK15298B : 6 à 7,4 V ;
  - carte Adafruit PCA9685 : VCC = logique 3-5 V, V+ = puissance servos (facultatif),
    OE actif à l'état bas (tiré à la masse), 220 Ω en série sur chaque sortie ;
  - INA226 : IN+ côté source, IN- côté charge, VS 2,7 à 5,5 V ; le shunt R100
    (0,1 Ω) des modules est limité à 0,8 A ;
  - Raspberry Pi 5 : pas de prise audio jack ; ports USB limités à 600 mA sans
    alimentation 5 A (sinon usb_max_current_enable=1 dans config.txt) ;
  - Waveshare Bus Servo Adapter (A) : liaison RX-RX et TX-TX, cavalier en position A ;
  - Feetech STS3215 (12 V) : 4 à 14 V ; STS3250 : 6 à 12 V ;
  - HX711 : RATE à la masse = 10 mesures/s, au VCC = 80 ; une cellule 3 fils
    (demi-pont) se complète avec 2 résistances de 1 kΩ ;
  - BNO085 (Adafruit) : VIN 3 à 5 V, I2C adresse 0x4A, SDA/SCL adaptés 3-5 V.
"""

from html import escape

import wiring

PIN_DY = 22
HEAD = 46
LANE_DY = 9
PAGE_MAX = 1450  # hauteur maximale d'un morceau de schéma imprimé sur une page A4

# type de fil -> (nom, couleur du trait, couleur de fil conseillée, section par défaut)
NETS = {
    "bat": ("Batterie +12,8 V", "#991b1b", "rouge (gros fil)", "6 mm²"),
    "v12": ("+12 V servos des jambes", "#ea580c", "rouge", "2,5 mm²"),
    "v6": ("+6 V servos du haut du corps", "#dc2626", "rouge", "2,5 mm²"),
    "v5": ("+5 V", "#db2777", "rouge", "0,5 mm²"),
    "v33": ("+3,3 V", "#c026d3", "rouge", "0,25 mm²"),
    "gnd": ("Masse (GND, −)", "#111827", "noir", "même section que le +"),
    "pwm": ("Signal de servo", "#ca8a04", "orange / jaune / blanc", "fil de servo"),
    "sda": ("I2C SDA (données)", "#16a34a", "vert", "0,25 mm²"),
    "scl": ("I2C SCL (horloge)", "#2563eb", "bleu", "0,25 mm²"),
    "uart": ("Liaison série / bus de données", "#7c3aed", "violet", "0,25 mm²"),
    "usb": ("Câble USB", "#64748b", "câble USB", "câble USB"),
    "sig": ("Signal logique", "#0891b2", "au choix (pas rouge ni noir)", "0,25 mm²"),
    "ana": ("Signal analogique", "#92400e", "au choix", "0,25 mm² (blindé si long)"),
    "audio": ("Audio", "#4b5563", "câble jack / fils HP", "0,5 mm²"),
}

SVG_STYLE = (
    "text{font-family:Inter,Segoe UI,Arial,sans-serif;fill:#111827}"
    ".el-t{font-size:14px;font-weight:600}.el-s{font-size:11.5px;fill:#4b5563}"
    ".el-p{font-size:11.5px;fill:#1f2937}.el-h{font-size:16px;font-weight:700}"
    ".el-rail{font-size:12px;font-weight:700}"
    ".el-pin{fill:#ffffff;stroke:#111827;stroke-width:1.5}"
    ".el-box{fill:#f8fafc;stroke:#334155;stroke-width:1.5}"
    ".el-power{fill:#fff7ed;stroke:#c2410c;stroke-width:1.8}"
    ".el-ref{fill:#eff6ff;stroke:#1d4ed8;stroke-width:1.5;stroke-dasharray:5 3}"
    ".el-safety{fill:#fef2f2;stroke:#b91c1c;stroke-width:1.8}"
)

SERVO_WIRES = "Fil de servo : marron ou noir = −, rouge = +, orange / jaune / blanc = signal."


class Comp:
    def __init__(self, cid, x, y, w, title, sub="", left=(), right=(), kind="box"):
        self.id, self.x, self.y, self.w = cid, x, y, w
        self.title, self.sub, self.kind = title, sub, kind
        self.left = [p if isinstance(p, tuple) else (p, p) for p in left]
        self.right = [p if isinstance(p, tuple) else (p, p) for p in right]
        self.h = HEAD + max(len(self.left), len(self.right), 1) * PIN_DY

    def pin(self, key):
        for side, pins, x in (("left", self.left, self.x), ("right", self.right, self.x + self.w)):
            for i, (k, label) in enumerate(pins):
                if k == key:
                    return x, self.y + HEAD + i * PIN_DY + 6, side, label
        raise KeyError("%s.%s" % (self.id, key))


class Sheet:
    def __init__(self, sid, title, subtitle, width=1100):
        self.id, self.title, self.subtitle, self.width = sid, title, subtitle, width
        self.comps, self.wires, self.rails, self.labels, self.notes = {}, [], {}, [], []
        self.extra_rows = []
        self.bottom = 20

    def add(self, comp):
        if comp.id in self.comps:
            raise ValueError("composant en double : %s" % comp.id)
        self.comps[comp.id] = comp
        self.bottom = max(self.bottom, comp.y + comp.h)
        return comp

    def rail(self, rid, x, y1, y2, net, label):
        self.rails[rid] = {"x": x, "y1": y1, "y2": y2, "net": net, "label": label}
        self.bottom = max(self.bottom, y2)

    def wire(self, a, b, net, lane=None, section=None, note="", via=None):
        """via : points intermédiaires [(x, y), ...] (segments horizontaux / verticaux)."""
        self.wires.append({"a": a, "b": b, "net": net, "lane": lane, "section": section, "note": note,
                           "via": via})

    def text(self, x, y, txt, cls="el-h"):
        self.labels.append((x, y, txt, cls))
        self.bottom = max(self.bottom, y + 10)

    # ------------------------------------------------------------------ rendu
    def _end(self, ref):
        if ref == "gnd":
            return None, None, "gnd", "masse"
        if ref.startswith("rail:"):
            r = self.rails[ref[5:]]
            return r["x"], None, "rail", r["label"]
        cid, key = ref.split(".", 1)
        return self.comps[cid].pin(key)

    def _name(self, ref):
        if ref == "gnd":
            return "Masse commune (barre de masse)"
        if ref.startswith("rail:"):
            return self.rails[ref[5:]]["label"]
        cid, key = ref.split(".", 1)
        c = self.comps[cid]
        return "%s · %s" % (c.title, c.pin(key)[3])

    def rows(self):
        out = []
        for w in self.wires:
            name, color, wire_color, section = NETS[w["net"]]
            out.append({"from": self._name(w["a"]), "to": self._name(w["b"]), "type": name,
                        "color": wire_color, "section": w["section"] or section, "note": w["note"]})
        return out + self.extra_rows

    def pages(self):
        """Découpe la feuille en morceaux imprimables, juste au-dessus des titres de section."""
        height = self.bottom + 30
        breaks = sorted({y - 28 for x, y, t, cls in self.labels if cls == "el-h" and y > 60}) + [height]
        out, start, last = [], 0, 0
        for b in breaks:
            if b - start > PAGE_MAX and last > start:
                out.append((start, last))
                start = last
            last = b
        out.append((start, height))
        full = self.svg()
        head = 'viewBox="0 0 %d %d"' % (self.width, height)
        return [full.replace(head, 'viewBox="0 %d %d %d"' % (y0, self.width, y1 - y0), 1) for y0, y1 in out]

    def svg(self):
        height = self.bottom + 30
        parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" class="el-svg" role="img" '
                 'aria-label="%s">' % (self.width, height, escape(self.title)),
                 "<style>%s</style>" % SVG_STYLE,
                 '<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (self.width, height)]
        lanes = {}
        paths, dots, parts_gnd = [], [], []
        for w in self.wires:
            color = NETS[w["net"]][1]
            ax, ay, aside, _ = self._end(w["a"])
            bx, by, bside, _ = self._end(w["b"])
            if bside == "gnd":  # symbole de masse au bout d'un petit fil
                sx = ax - 18 if aside == "left" else ax + 18
                paths.append((["M%d %d" % (ax, ay), "H%d" % sx, "V%d" % (ay + 10)], color, "gnd"))
                for i, half in enumerate((9, 6, 3)):
                    parts_gnd.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#111827" stroke-width="2"/>'
                                     % (sx - half, ay + 10 + 4 * i, sx + half, ay + 10 + 4 * i))
                continue
            if bside == "rail" or aside == "rail":
                if aside == "rail":
                    ax, ay, bx, rail = bx, by, ax, self.rails[w["a"][5:]]
                else:
                    rail = self.rails[w["b"][5:]]
                d = ["M%d %d" % (ax, ay)]
                if w["via"]:
                    d += ["L%d %d" % p for p in w["via"]]
                    ay = w["via"][-1][1]
                d.append("H%d" % bx)
                ry = min(max(ay, rail["y1"]), rail["y2"])
                if ry != ay:  # broche au-dessus ou au-dessous du rail
                    d.append("V%d" % ry)
                dots.append((bx, ry, color))
                paths.append((d, color, w["net"]))
                continue
            if w["via"]:
                d = ["M%d %d" % (ax, ay)] + ["L%d %d" % p for p in w["via"]] + ["L%d %d" % (bx, by)]
                paths.append((d, color, w["net"]))
                continue
            lane = w["lane"]
            if lane is None:
                lo, hi = sorted((ax, bx))
                key = (lo, hi)
                k = lanes.get(key, 0)
                lanes[key] = k + 1
                lane = lo + 14 + k * LANE_DY
                if lane > hi - 10:
                    lane = (lo + hi) // 2
            paths.append((["M%d %d" % (ax, ay), "H%d" % lane, "V%d" % by, "H%d" % bx], color, w["net"]))
        placed = []
        for r in self.rails.values():
            color = NETS[r["net"]][1]
            ly = r["y1"] - 8
            while any(abs(px - r["x"]) < 50 and py == ly for px, py in placed):
                ly -= 15  # étiquettes de rails voisins décalées en hauteur
            placed.append((r["x"], ly))
            parts.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="5" stroke-linecap="round"/>'
                         % (r["x"], r["y1"], r["x"], r["y2"], color))
            parts.append('<text x="%d" y="%d" class="el-rail" text-anchor="middle">%s</text>'
                         % (r["x"], ly, escape(r["label"])))
        for d, color, net in paths:
            width = 3 if net in ("bat", "v12", "v6", "gnd") else 2
            dash = ' stroke-dasharray="6 4"' if net == "usb" else ""
            parts.append('<path d="%s" fill="none" stroke="%s" stroke-width="%d"%s/>' % (" ".join(d), color, width, dash))
        parts += parts_gnd
        for x, y, color in dots:
            parts.append('<circle cx="%d" cy="%d" r="4" fill="%s"/>' % (x, y, color))
        for c in self.comps.values():
            cls = {"power": "el-power", "ref": "el-ref", "safety": "el-safety"}.get(c.kind, "el-box")
            parts.append('<rect x="%d" y="%d" width="%d" height="%d" rx="6" class="%s"/>' % (c.x, c.y, c.w, c.h, cls))
            parts.append('<text x="%d" y="%d" class="el-t">%s</text>' % (c.x + 8, c.y + 18, escape(c.title)))
            if c.sub:
                parts.append('<text x="%d" y="%d" class="el-s">%s</text>' % (c.x + 8, c.y + 34, escape(c.sub)))
            for side, pins in (("left", c.left), ("right", c.right)):
                for k, label in pins:
                    px, py, _, _ = c.pin(k)
                    parts.append('<circle cx="%d" cy="%d" r="3" class="el-pin"/>' % (px, py))
                    if side == "left":
                        parts.append('<text x="%d" y="%d" class="el-p">%s</text>' % (px + 7, py + 4, escape(label)))
                    else:
                        parts.append('<text x="%d" y="%d" class="el-p" text-anchor="end">%s</text>'
                                     % (px - 7, py + 4, escape(label)))
        for x, y, txt, cls in self.labels:
            parts.append('<text x="%d" y="%d" class="%s">%s</text>' % (x, y, cls, escape(txt)))
        parts.append("</svg>")
        return "".join(parts)

    def to_dict(self):
        return {"id": self.id, "title": self.title, "subtitle": self.subtitle, "svg": self.svg(),
                "pages": self.pages(),
                "rows": self.rows(), "notes": self.notes,
                "legend": [{"net": k, "name": v[0], "color": v[1]} for k, v in NETS.items()
                           if any(w["net"] == k for w in self.wires)]}


# ---------------------------------------------------------------------- servos
# servos doubles : même signal (câble en Y) ou deux moteurs sur une seule carte
DOUBLE = {
    "i01.head.rollNeck": "2 servos HK15298B, câble en Y (même signal)",
    "i01.torso.topStom": "2 servos HS-805BB, câble en Y (même signal)",
    "i01.torso.midStom": "2 moteurs, 1 carte de servo, 1 potentiomètre",
}
SHORT = {"i01.torso.lowStom": "facultatif, absent de la plupart des InMoov"}
MODIFIED = ("Arm.omoplate", "Arm.shoulder", "Arm.bicep")
BOARD_RAIL = {"pca_tete": ("A", "10 A", "0x41"), "pca_gauche": ("B", "15 A", "0x44"),
              "pca_droite": ("C", "15 A", "0x45")}


def servo_group(sheet, board_name, services, y0, labels):
    """Carte PCA9685 + ses servos + rails +6 V / − de la carte. Renvoie le bas du groupe."""
    board = wiring.board_by_name(board_name)
    letter, fuse, ina = BOARD_RAIL[board_name]
    plan = [(s, wiring.SERVO_PLAN[s]) for s in services]
    pid = "pca_" + board_name
    ref = sheet.add(Comp("ref_" + board_name, 30, y0 + 20, 170, "Bus I2C de la Mega",
                         "i01.left, voir feuille Torse", right=[("5V", "5 V"), ("SDA", "SDA (broche 20)"),
                                                                ("SCL", "SCL (broche 21)"), ("GND", "GND")],
                         kind="ref"))
    pca = sheet.add(Comp(pid, 260, y0, 240, "PCA9685 %s (carte %s)" % (board["address"], letter),
                         board["jumpers"],
                         left=[("VCC", "VCC (logique)"), ("SDA", "SDA"), ("SCL", "SCL"), ("GND", "GND"),
                               ("OE", "OE (non relié)")],
                         right=[("CH%d" % ch, "CH%d · %s" % (ch, labels.get(s, s).split(" (")[0]))
                                for s, (_, ch, _) in plan]))
    for k, net in (("5V", "v5"), ("SDA", "sda"), ("SCL", "scl"), ("GND", "gnd")):
        sheet.wire("%s.%s" % (ref.id, k), "%s.%s" % (pid, "VCC" if k == "5V" else k), net)
    sup = sheet.add(Comp("sup_" + board_name, 640, y0, 250, "Départ carte %s" % letter,
                         "fusible %s + INA226 %s (feuille Torse)" % (fuse, ina),
                         right=[("P", "+6 V carte %s" % letter), ("N", "− (masse)")], kind="power"))
    y = max(pca.y + pca.h, sup.y + sup.h) + 30
    xp, xn = 975, 1040
    top = y - 10
    for k, (s, (_, ch, model)) in enumerate(plan):
        label = labels.get(s, s)
        lane = 610 - k * 10  # premier servo = couloir le plus à droite : aucun croisement
        units = 2 if s in DOUBLE and "Y" in DOUBLE[s] else 1
        sub = DOUBLE.get(s, SHORT.get(s, model))
        if any(m in s for m in MODIFIED):
            sub = model + " · potentiomètre déporté (3 fils)"
        for u in range(units):
            sid = "sv_%s_%d" % (s.replace(".", "_"), u)
            sv = sheet.add(Comp(sid, 620, y, 300, label + (" (%d/2)" % (u + 1) if units == 2 else ""),
                                sub if len(sub) <= 46 else sub[:45] + "…",
                                left=[("S", "signal")], right=[("P", "+"), ("N", "−")]))
            sheet.wire("%s.CH%d" % (pid, ch), sid + ".S", "pwm", lane=lane,
                       note="câble en Y" if units == 2 else "")
            sheet.wire(sid + ".P", "rail:p_" + board_name, "v6", section="fil de servo (rallonge 0,5 mm² si > 50 cm)")
            sheet.wire(sid + ".N", "rail:n_" + board_name, "gnd", section="fil de servo")
            y += sv.h + 14
    sheet.rail("p_" + board_name, xp, top, y - 14, "v6", "+6 V %s" % letter)
    sheet.rail("n_" + board_name, xn, top, y - 14, "gnd", "− %s" % letter)
    sheet.wire("sup_%s.P" % board_name, "rail:p_" + board_name, "v6", section="2,5 mm²")
    sheet.wire("sup_%s.N" % board_name, "rail:n_" + board_name, "gnd", section="2,5 mm²")
    sheet.bottom = max(sheet.bottom, y)
    return y + 10


def servo_labels():
    import servo_inventory
    labels = {}
    for g in servo_inventory.groups_with({}):
        side = " gauche" if "left" in g["key"] else " droit" if "right" in g["key"] else ""
        for s in g["servos"]:
            labels[s["service"]] = s["label"] + (side if side and "gauche" not in s["label"]
                                                 and "droit" not in s["label"] else "")
    return labels


# ---------------------------------------------------------------------- feuilles
def sheet_power():
    s = Sheet("alimentation", "Alimentation générale",
              "Batterie, protections, arrêt d'urgence et convertisseurs. Toutes les masses sont reliées.")
    s.text(30, 30, "Entrée : batterie → fusible → interrupteur → shunt de mesure")
    s.add(Comp("bat", 30, 50, 190, "Batterie LiFePO4 4S", "12,8 V, avec BMS",
               right=[("P", "+ 12,8 V"), ("N", "−")], kind="power"))
    s.add(Comp("f0", 290, 50, 150, "Fusible principal", "40 A (MIDI ou ANL)", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("sw", 510, 50, 160, "Interrupteur général", "40 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("sh", 740, 50, 190, "Shunt 1 mΩ", "mesuré par l'INA226 0x40",
               left=[("IN+", "IN+ batterie")], right=[("IN-", "IN− robot")]))
    s.wire("bat.P", "f0.1", "bat")
    s.wire("f0.2", "sw.1", "bat")
    s.wire("sw.2", "sh.IN+", "bat")
    s.wire("bat.N", "gnd", "gnd", section="6 mm²")
    s.rail("p13", 260, 185, 512, "bat", "+12,8 V protégé")
    py = s.comps["sh"].pin("IN-")[1]
    s.wire("sh.IN-", "rail:p13", "bat", via=[(950, py), (950, 160), (260, 160)])
    s.text(330, 190, "Logique : toujours alimentée (Raspberry Pi, bobine du relais)", "el-s")
    s.add(Comp("fl", 300, 200, 140, "Fusible logique", "5 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("dc5", 520, 200, 280, "Convertisseur 12 V → 5,1 V 5 A", "sortie USB-C vers le Pi 5",
               left=[("IN+", "entrée +"), ("IN-", "entrée −")], right=[("OUT", "USB-C 5,1 V")], kind="power"))
    s.add(Comp("pi", 870, 200, 210, "Raspberry Pi 5", "feuille Torse", left=[("USBC", "USB-C")], kind="ref"))
    s.wire("rail:p13", "fl.1", "bat", section="1,5 mm²")
    s.wire("fl.2", "dc5.IN+", "bat", section="1,5 mm²")
    s.wire("dc5.IN-", "gnd", "gnd", section="1,5 mm²")
    s.wire("dc5.OUT", "pi.USBC", "usb")
    s.add(Comp("fc", 300, 330, 140, "Fusible bobine", "1 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("au", 520, 330, 280, "Arrêt d'urgence", "coup de poing, contact NF n°1",
               left=["1"], right=["2"], kind="safety"))
    s.wire("rail:p13", "fc.1", "bat", section="0,5 mm²")
    s.wire("fc.2", "au.1", "bat", section="0,5 mm²")
    s.add(Comp("rl", 520, 440, 280, "Relais / contacteur 12 V 40 A", "diode 1N4007 sur la bobine",
               left=[("30", "30 entrée puissance"), ("85", "85 bobine +"), ("86", "86 bobine −")],
               right=[("87", "87 sortie servos")], kind="safety"))
    s.wire("rail:p13", "rl.30", "bat", section="6 mm²")
    ay, ry = s.comps["au"].pin("2")[1], s.comps["rl"].pin("85")[1]
    s.wire("au.2", "rl.85", "bat", section="0,5 mm²", note="bouton enfoncé = bobine coupée = servos coupés",
           via=[(815, ay), (815, 425), (490, 425), (490, ry)])
    s.wire("rl.86", "gnd", "gnd", section="0,5 mm²")
    s.text(290, 600, "Puissance : coupée par l'arrêt d'urgence", "el-s")
    s.add(Comp("f6", 300, 620, 140, "Fusible", "15 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("dc6", 520, 620, 280, "Convertisseur 12 V → 6,0 V 20 A", "réglé à 6,0 V (pas plus)",
               left=[("IN+", "entrée +"), ("IN-", "entrée −")], right=[("OUT+", "6,0 V +"), ("OUT-", "6 V −")],
               kind="power"))
    s.add(Comp("to6", 870, 620, 210, "Bornier 6 V du torse", "départs A, B, C",
               left=[("P", "+6 V"), ("N", "−")], kind="ref"))
    s.add(Comp("f12", 300, 760, 140, "Fusible", "25 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("dc12", 520, 760, 280, "Régulateur 12,0 V 20 A", "abaisseur-élévateur (buck-boost)",
               left=[("IN+", "entrée +"), ("IN-", "entrée −")], right=[("OUT+", "12 V +"), ("OUT-", "12 V −")],
               kind="power"))
    s.add(Comp("to12", 870, 760, 210, "Bornier 12 V des jambes", "feuille Jambes",
               left=[("P", "+12 V"), ("N", "−")], kind="ref"))
    oy = s.comps["rl"].pin("87")[1]
    for f in ("f6", "f12"):
        fy = s.comps[f].pin("1")[1]
        s.wire("rl.87", f + ".1", "bat", section="4 mm²", via=[(830, oy), (830, 585), (280, 585), (280, fy)])
    s.wire("f6.2", "dc6.IN+", "bat", section="4 mm²")
    s.wire("f12.2", "dc12.IN+", "bat", section="4 mm²")
    s.wire("dc6.IN-", "gnd", "gnd", section="4 mm²")
    s.wire("dc12.IN-", "gnd", "gnd", section="4 mm²")
    s.wire("dc6.OUT+", "to6.P", "v6", section="4 mm²")
    s.wire("dc6.OUT-", "to6.N", "gnd", section="4 mm²")
    s.wire("dc12.OUT+", "to12.P", "v12", section="4 mm²")
    s.wire("dc12.OUT-", "to12.N", "gnd", section="4 mm²")
    s.notes = [
        "Le contact NF n°1 de l'arrêt d'urgence alimente la bobine du relais : bouton enfoncé, tous les servos "
        "(6 V et 12 V) sont coupés ; le Raspberry Pi et les Arduino restent allumés.",
        "Le contact NF n°2 du même bouton va sur la broche 2 de l'Arduino Mega n°2 (feuille Bassin) pour que "
        "le firmware des jambes sache que l'arrêt est enfoncé.",
        "Diode 1N4007 en parallèle sur la bobine du relais : cathode (bague) côté 85 (+), anode côté 86 (−).",
        "Le HS-805BB accepte 6,0 V au maximum : réglez le convertisseur à 6,0 V au multimètre AVANT de brancher.",
        "Une LiFePO4 4S chargée dépasse 13 V et monte à 14,6 V en charge : les servos STS3250 (12 V maximum) "
        "doivent passer par le régulateur 12,0 V. Ne faites pas bouger le robot pendant la charge.",
        "Sans alimentation 5 V 5 A officielle, le Pi limite ses ports USB à 600 mA : ajoutez "
        "usb_max_current_enable=1 dans /boot/firmware/config.txt seulement si le convertisseur fournit 5 A.",
        "À l'atelier, la batterie peut être remplacée par une alimentation 12 V 40 A (mêmes protections).",
    ]
    return s


def sheet_servos(sid, title, subtitle, prefixes_by_board, notes):
    s = Sheet(sid, title, subtitle)
    labels = servo_labels()
    y = 40
    for board, prefixes in prefixes_by_board:
        services = [k for k, v in wiring.SERVO_PLAN.items() if v[0] == board and any(k.startswith(p) for p in prefixes)]
        services.sort(key=lambda k: wiring.SERVO_PLAN[k][1])
        b = wiring.board_by_name(board)
        s.text(30, y, "%s · PCA9685 %s" % (b["label"], b["address"]))
        y = servo_group(s, board, services, y + 20, labels) + 30
    s.notes = [SERVO_WIRES] + notes
    return s


def sheet_head():
    s = sheet_servos("tete", "Tête", "Mâchoire, yeux et paupières, caméras et micro.",
                     [("pca_tete", ["i01.head.jaw", "i01.head.eye"])],
                     ["Les rallonges de servo descendent de la tête au torse par le cou : laissez assez de mou "
                      "pour la rotation et l'inclinaison de la tête.",
                      "Les caméras et le micro se branchent en USB sur le hub USB alimenté du torse (pas directement "
                      "sur le Pi si les 4 ports sont déjà pris)."])
    y = s.bottom + 50
    s.text(30, y - 16, "USB de la tête")
    s.add(Comp("hub", 640, y, 300, "Hub USB alimenté", "dans le torse (feuille Torse)",
                     left=[("1", "port 1"), ("2", "port 2"), ("3", "port 3")], kind="ref"))
    s.add(Comp("camL", 30, y, 260, "Caméra USB œil gauche", "suivi de visage (Coral)", right=[("USB", "USB")]))
    s.add(Comp("camR", 30, y + 90, 260, "Caméra USB œil droit", "facultative", right=[("USB", "USB")]))
    s.add(Comp("mic", 30, y + 180, 260, "Micro USB", "orienté vers l'avant, loin des servos",
               right=[("USB", "USB")]))
    s.wire("camL.USB", "hub.1", "usb")
    s.wire("camR.USB", "hub.2", "usb")
    s.wire("mic.USB", "hub.3", "usb")
    return s


def sheet_neck():
    return sheet_servos("cou", "Cou", "Rotation, inclinaison avant/arrière et inclinaison latérale de la tête.",
                        [("pca_tete", ["i01.head.rothead", "i01.head.neck", "i01.head.rollNeck"])],
                        ["Les HS-805BB tirent jusqu'à 6 A au blocage : leur + et leur − vont directement sur les rails "
                         "+6 V et − de la carte A (jamais sur le connecteur V+ de la PCA9685).",
                         "rollNeck : deux servos sur le même canal grâce à un câble en Y (montés en miroir, "
                         "vérifier le sens avant de serrer les vis)."])


def sheet_torso():
    s = Sheet("torse", "Torse", "Raspberry Pi 5, Arduino Mega, 3 cartes PCA9685, départs 6 V, capteurs I2C et audio.")
    # cerveau et USB
    s.text(30, 30, "Cerveau et USB")
    s.add(Comp("pi", 30, 50, 250, "Raspberry Pi 5", "MyRobotLab, Atelier, IA",
               right=[("U3a", "USB 3 (bleu)"), ("U3b", "USB 3 (bleu)"), ("U2a", "USB 2")], kind="ref"))
    s.add(Comp("coral", 400, 40, 230, "Coral USB Accelerator", "sur un port USB 3", left=[("USB", "USB")]))
    s.add(Comp("hub", 400, 130, 230, "Hub USB alimenté 7 ports", "alimentation 5 V propre",
               left=[("IN", "entrée USB")],
               right=[("1", "port 1"), ("2", "port 2"), ("3", "port 3"), ("4", "port 4"), ("5", "port 5"),
                      ("6", "port 6")]))
    s.add(Comp("m1", 820, 40, 250, "Arduino Mega i01.left", "MrlComm, passerelle I2C", left=[("USB", "USB")],
               kind="ref"))
    s.add(Comp("m2", 820, 120, 250, "Arduino Mega n°2", "jambes (feuille Bassin)", left=[("USB", "USB")], kind="ref"))
    s.add(Comp("cams", 820, 200, 250, "Caméras et micro", "feuille Tête", left=[("USB", "3 câbles USB")], kind="ref"))
    s.add(Comp("snd", 820, 280, 250, "Carte son USB", "le Pi 5 n'a pas de prise jack",
               left=[("USB", "USB")], right=[("OUT", "sortie jack")]))
    s.wire("pi.U3a", "coral.USB", "usb")
    s.wire("pi.U3b", "hub.IN", "usb")
    s.wire("hub.1", "m1.USB", "usb", lane=790)
    s.wire("hub.2", "m2.USB", "usb", lane=776)
    s.wire("hub.3", "cams.USB", "usb", lane=762)
    s.wire("hub.4", "snd.USB", "usb", lane=748)
    # audio
    y = 400
    s.text(30, y, "Audio")
    s.add(Comp("amp", 400, y + 20, 260, "Amplificateur PAM8403", "2 × 3 W, alimenté en 5 V",
               left=[("IN", "entrée L/R"), ("5V", "5 V"), ("GND", "GND")],
               right=[("L", "HP gauche"), ("R", "HP droit")]))
    s.add(Comp("hp", 820, y + 20, 250, "2 haut-parleurs 4 Ω", "dans le torse", left=[("L", "gauche"), ("R", "droit")]))
    s.add(Comp("p5", 30, y + 40, 250, "+5 V (sortie du hub ou 5 V)", "voir Alimentation",
               right=[("P", "+5 V"), ("N", "GND")], kind="power"))
    oy, iy = s.comps["snd"].pin("OUT")[1], s.comps["amp"].pin("IN")[1]
    s.wire("snd.OUT", "amp.IN", "audio", via=[(1090, oy), (1090, 408), (370, 408), (370, iy)])
    s.wire("p5.P", "amp.5V", "v5")
    s.wire("p5.N", "amp.GND", "gnd")
    s.wire("amp.L", "hp.L", "audio")
    s.wire("amp.R", "hp.R", "audio")
    # I2C de la Mega vers les PCA9685
    y = 560
    s.text(30, y, "Mega i01.left → 3 cartes PCA9685 (bus I2C : câbler de carte en carte, câbles courts)")
    s.add(Comp("mega", 30, y + 20, 250, "Arduino Mega i01.left", "alimentée par l'USB",
               right=[("5V", "5 V"), ("SDA", "SDA (broche 20)"), ("SCL", "SCL (broche 21)"), ("GND", "GND"),
                      ("D23", "broche 23 (PIR)")]))
    bus = (("m5", 340, "v5", "5 V", "5V", "VCC"), ("msda", 375, "sda", "SDA", "SDA", "SDA"),
           ("mscl", 410, "scl", "SCL", "SCL", "SCL"), ("mgnd", 445, "gnd", "GND", "GND", "GND"))
    yy = y + 20
    for b in wiring.BOARDS:
        letter = BOARD_RAIL[b["name"]][0]
        c = s.add(Comp("p" + letter, 520, yy, 300, "PCA9685 %s · carte %s" % (b["address"], letter), b["jumpers"],
                       left=[("VCC", "VCC (logique)"), ("SDA", "SDA"), ("SCL", "SCL"), ("GND", "GND")]))
        yy += c.h + 20
    for rid, x, net, label, _, _ in bus:
        s.rail(rid, x, y + 50, yy - 40, net, label)
    for rid, x, net, label, mega_pin, _ in bus:
        s.wire("mega." + mega_pin, "rail:" + rid, net)
    for b in wiring.BOARDS:
        letter = BOARD_RAIL[b["name"]][0]
        for rid, x, net, label, _, pin in bus:
            s.wire("rail:" + rid, "p%s.%s" % (letter, pin), net)
    s.add(Comp("pir", 520, yy + 10, 300, "Capteur PIR (HC-SR501)", "présence, réglé dans MyRobotLab",
               left=[("OUT", "OUT"), ("VCC", "VCC 5 V"), ("GND", "GND")]))
    s.wire("mega.D23", "pir.OUT", "sig", lane=300,
           note="broche au choix : l'indiquer dans le service Pir de MyRobotLab")
    s.wire("rail:m5", "pir.VCC", "v5")
    s.wire("rail:mgnd", "pir.GND", "gnd")
    yy += 140
    # départs 6 V
    y = yy + 30
    s.text(30, y, "Bornier 6 V → un départ protégé et mesuré par carte")
    s.add(Comp("b6", 30, y + 20, 220, "Bornier 6 V", "depuis le convertisseur 6 V",
               right=[("A", "+6 V départ A"), ("B", "+6 V départ B"), ("C", "+6 V départ C")], kind="power"))
    for i, (board, (letter, fuse, ina)) in enumerate(BOARD_RAIL.items()):
        yy = y + 20 + i * 110
        s.add(Comp("fu" + letter, 330, yy, 150, "Fusible %s" % fuse, "départ %s" % letter, left=["1"], right=["2"],
                   kind="safety"))
        s.add(Comp("in" + letter, 560, yy, 250, "INA226 %s (shunt 2 mΩ)" % ina, "mesure le courant de la carte %s" % letter,
                   left=[("IN+", "IN+")], right=[("IN-", "IN−"), ("VBS", "VBUS")]))
        s.add(Comp("ra" + letter, 880, yy, 190, "Rails carte %s" % letter, "feuilles Tête, Cou, Bras…",
                   left=[("P", "+6 V %s" % letter)], kind="ref"))
        s.wire("b6.%s" % letter, "fu%s.1" % letter, "v6", section="2,5 mm²")
        s.wire("fu%s.2" % letter, "in%s.IN+" % letter, "v6", section="2,5 mm²")
        s.wire("in%s.IN-" % letter, "ra%s.P" % letter, "v6", section="2,5 mm²")
        s.wire("in%s.IN-" % letter, "in%s.VBS" % letter, "v6", lane=830, section="0,25 mm²",
               note="VBUS mesure la tension de la carte")
    # bus I2C du Pi : capteurs
    y = s.bottom + 70
    s.text(30, y, "Bus I2C n°1 du Raspberry Pi : capteurs (3,3 V)")
    s.add(Comp("gpio", 30, y + 20, 250, "Raspberry Pi 5 · GPIO", "connecteur 40 broches",
               right=[("1", "broche 1 · 3,3 V"), ("3", "broche 3 · SDA"), ("5", "broche 5 · SCL"),
                      ("6", "broche 6 · GND")], kind="ref"))
    rails = (("r33", 340, "v33", "3,3 V"), ("rsda", 375, "sda", "SDA"), ("rscl", 410, "scl", "SCL"),
             ("rgnd", 445, "gnd", "GND"))
    devs = [("ina40", "INA226 0x40 · batterie", "A0 et A1 à GND"), ("ina41", "INA226 0x41 · carte A", "A0 à VS"),
            ("ina44", "INA226 0x44 · carte B", "A1 à VS"), ("ina45", "INA226 0x45 · carte C", "A0 et A1 à VS"),
            ("ads48", "ADS1115 0x48 · main gauche", "ADDR à GND"), ("ads49", "ADS1115 0x49 · main droite", "ADDR à VDD"),
            ("ads4a", "ADS1115 0x4A · auriculaires", "ADDR à SDA"), ("vl53", "VL53L1X 0x29 · présence", "XSHUT non relié")]
    yy = y + 20
    for did, title, sub in devs:
        s.add(Comp(did, 520, yy, 300, title, sub, left=[("VCC", "VCC / VS"), ("SDA", "SDA"), ("SCL", "SCL"),
                                                          ("GND", "GND")]))
        yy += 46 + 4 * PIN_DY + 10
    for rid, x, net, label in rails:
        s.rail(rid, x, y + 30, yy - 30, net, label)
    for pin, rid, net in (("1", "r33", "v33"), ("3", "rsda", "sda"), ("5", "rscl", "scl"), ("6", "rgnd", "gnd")):
        s.wire("gpio." + pin, "rail:" + rid, net)
    for did, _, _ in devs:
        for pin, rid, net in (("VCC", "r33", "v33"), ("SDA", "rsda", "sda"), ("SCL", "rscl", "scl"),
                              ("GND", "rgnd", "gnd")):
            s.wire("rail:" + rid, "%s.%s" % (did, pin), net)
    s.notes = [
        "Ne jamais alimenter les servos par le 5 V de l'Arduino ou du Raspberry Pi : le VCC des PCA9685 n'alimente "
        "que leur logique ; la puissance des servos arrive par les rails de chaque carte.",
        "Le − de chaque rail 6 V, la masse de l'Arduino, celle du Pi et celle des convertisseurs sont reliés "
        "à la barre de masse (feuille Alimentation).",
        "Shunts INA226 : le module est livré avec un shunt R100 (0,1 Ω, 0,8 A maximum) ; le remplacer par 2 mΩ "
        "pour les cartes et 1 mΩ pour la batterie (valeurs à reporter dans config.json → sensors).",
        "Adresses I2C : les PCA9685 (bus de la Mega) et les INA226 (bus du Pi) sont sur deux bus différents ; "
        "0x40 et 0x41 peuvent donc servir sur les deux sans conflit.",
        "L'INA226 batterie mesure le shunt de la feuille Alimentation : ses IN+ / IN− / VBUS vont sur ce shunt.",
        "Le bus I2C du Pi est en 3,3 V : ne jamais y relier le 5 V.",
    ]
    return s


def sheet_arms():
    return sheet_servos("bras", "Bras", "Omoplate, épaule, rotation et biceps des deux bras.",
                        [("pca_gauche", ["i01.leftArm."]), ("pca_droite", ["i01.rightArm."])],
                        ["Omoplate, épaule et biceps utilisent des HS-805BB modifiés : le potentiomètre est déporté "
                         "sur l'articulation et relié au servo par 3 fils (rallonger avec du fil souple, sans "
                         "inverser les deux extrémités sinon le servo part en butée).",
                         "Les servos des bras sont les plus gourmands : leur + et leur − vont directement sur les "
                         "rails B et C, jamais sur le connecteur V+ de la PCA9685."])


def sheet_hands():
    s = sheet_servos("mains", "Mains et avant-bras", "Cinq doigts et le poignet de chaque main, capteurs de toucher.",
                     [("pca_gauche", ["i01.leftHand."]), ("pca_droite", ["i01.rightHand."])],
                     ["Les capteurs FSR forment chacun un pont diviseur : FSR entre 3,3 V et la sortie, résistance "
                      "de 10 kΩ entre la sortie et GND ; la sortie va sur une voie de l'ADS1115.",
                      "Les fils des FSR remontent le long du bras jusqu'aux ADS1115 du torse : fil fin et souple, "
                      "torsadé avec un fil de masse, et attaché pour ne pas gêner les tendons."])
    y = s.bottom + 60
    s.text(30, y - 20, "Toucher : 10 capteurs FSR → 3 ADS1115 (bus I2C du Pi, feuille Torse)")
    tips = [("0x48", "gauche", ["pouce", "index", "majeur", "annulaire"]),
            ("0x49", "droite", ["pouce", "index", "majeur", "annulaire"]),
            ("0x4A", "", ["auriculaire gauche", "auriculaire droit"])]
    fy = y
    for addr, side, fingers in tips:
        aid = "ads" + addr[2:]
        ads = s.add(Comp(aid, 30, y, 280, "ADS1115 %s" % addr, "main %s" % side if side else "auriculaires",
                         right=[("A%d" % i, "A%d" % i) for i in range(len(fingers))]))
        for i, f in enumerate(fingers):
            fid = "fsr_%s_%d" % (addr[2:], i)
            name = f if not side else "%s %s" % (f, side)
            s.add(Comp(fid, 520, fy, 330, "FSR %s + 10 kΩ" % name, "pont diviseur",
                       left=[("OUT", "sortie")], right=[("V", "FSR → 3,3 V"), ("G", "10 kΩ → GND")]))
            s.wire("%s.A%d" % (aid, i), fid + ".OUT", "ana", lane=470 - i * 14)
            s.wire(fid + ".V", "rail:t33", "v33")
            s.wire(fid + ".G", "rail:tgnd", "gnd")
            fy += 46 + 2 * PIN_DY + 10
        y = max(y + ads.h + 20, fy)
    s.rail("t33", 960, s.comps["fsr_48_0"].y - 10, fy - 10, "v33", "3,3 V")
    s.rail("tgnd", 1010, s.comps["fsr_48_0"].y - 10, fy - 10, "gnd", "GND")
    return s


def sheet_pelvis():
    s = sheet_servos("bassin", "Bassin et ventre", "Ventre (carte A), Arduino des jambes, centrale d'équilibre, "
                     "arrêt d'urgence.",
                     [("pca_tete", ["i01.torso."])],
                     ["topStom : deux HS-805BB sur le même canal (câble en Y). midStom : les deux moteurs partagent "
                      "une seule carte de servo et un seul potentiomètre, ils tournent donc ensemble.",
                      "lowStom est facultatif (absent de la plupart des InMoov).",
                      "Mettre la batterie et l'électronique des jambes dans le bassin abaisse le centre de gravité."])
    y = s.bottom + 60
    s.text(30, y - 20, "Arduino Mega n°2 (jambes) : centrale BNO085 et arrêt d'urgence")
    s.add(Comp("m2", 30, y, 280, "Arduino Mega n°2", "firmware inmoov_legs, USB vers le hub",
               right=[("5V", "5 V"), ("SDA", "SDA (broche 20)"), ("SCL", "SCL (broche 21)"), ("GND", "GND"),
                      ("D2", "broche 2"), ("GND2", "GND")]))
    s.add(Comp("bno", 600, y, 300, "BNO085 (Adafruit)", "au centre du bassin, bien fixé · I2C 0x4A",
               left=[("VIN", "VIN (3 à 5 V)"), ("SDA", "SDA"), ("SCL", "SCL"), ("GND", "GND")]))
    s.add(Comp("au2", 600, y + 160, 300, "Arrêt d'urgence · contact NF n°2", "même bouton que la feuille Alimentation",
               left=[("1", "borne 1"), ("2", "borne 2")], kind="safety"))
    for a, b, net in (("5V", "VIN", "v5"), ("SDA", "SDA", "sda"), ("SCL", "SCL", "scl"), ("GND", "GND", "gnd")):
        s.wire("m2." + a, "bno." + b, net)
    s.wire("m2.D2", "au2.1", "sig", note="INPUT_PULLUP : bouton enfoncé = contact ouvert = défaut")
    s.wire("m2.GND2", "au2.2", "gnd")
    return s


def sheet_legs():
    s = Sheet("jambes", "Jambes", "12 servos bus Feetech, adaptateur de bus et capteurs de pieds (8 cellules de charge).",
              width=1130)
    s.text(30, 30, "Bus des servos (protocole Feetech SMS/STS, 1 Mbit/s)")
    s.add(Comp("m2", 30, 50, 230, "Arduino Mega n°2", "Serial1",
               right=[("TX1", "TX1 (broche 18)"), ("RX1", "RX1 (broche 19)"), ("GND", "GND")]))
    s.add(Comp("ad", 340, 50, 270, "Bus Servo Adapter (A)", "Waveshare · cavalier en position A",
               left=[("TX", "TX"), ("RX", "RX"), ("GND", "GND")],
               right=[("DL", "DATA → jambe gauche"), ("DR", "DATA → jambe droite"), ("VIN", "jack 12 V")]))
    s.wire("m2.TX1", "ad.TX", "uart", note="RX-RX et TX-TX (documentation Waveshare)")
    s.wire("m2.RX1", "ad.RX", "uart", note="RX-RX et TX-TX (documentation Waveshare)")
    s.wire("m2.GND", "ad.GND", "gnd")
    s.add(Comp("b12", 30, 260, 230, "Bornier 12 V des jambes", "depuis le régulateur 12 V",
               right=[("PL", "+12 V jambe gauche"), ("PR", "+12 V jambe droite"), ("PA", "+12 V adaptateur"),
                      ("N", "−")], kind="power"))
    s.add(Comp("fl", 400, 280, 130, "Fusible", "10 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("fr", 400, 390, 130, "Fusible", "10 A", left=["1"], right=["2"], kind="safety"))
    s.add(Comp("fa", 400, 500, 130, "Fusible", "2 A", left=["1"], right=["2"], kind="safety"))
    s.wire("b12.PL", "fl.1", "v12", lane=330)
    s.wire("b12.PR", "fr.1", "v12", lane=340)
    s.wire("b12.PA", "fa.1", "v12", lane=350, section="0,75 mm²")
    s.wire("fa.2", "ad.VIN", "v12", lane=640, section="0,75 mm²")
    s.rail("g12", 680, 230, 560, "gnd", "− 12 V")
    s.wire("b12.N", "rail:g12", "gnd", section="4 mm²", via=None)
    s.add(Comp("inj_gauche", 720, 250, 180, "Injection gauche", "câble 3 fils",
               left=[("D", "DATA"), ("P", "+12 V"), ("N", "−")], right=[("O", "vers ID 1")]))
    s.add(Comp("inj_droite", 930, 420, 170, "Injection droite", "câble 3 fils",
               left=[("D", "DATA"), ("P", "+12 V"), ("N", "−")], right=[("O", "vers ID 11")]))
    s.wire("ad.DL", "inj_gauche.D", "uart", lane=650)
    s.wire("ad.DR", "inj_droite.D", "uart", lane=660)
    s.wire("fl.2", "inj_gauche.P", "v12", lane=600, section="2,5 mm²")
    s.wire("fr.2", "inj_droite.P", "v12", lane=610, section="2,5 mm²")
    s.wire("inj_gauche.N", "rail:g12", "gnd", section="2,5 mm²")
    s.wire("inj_droite.N", "rail:g12", "gnd", section="2,5 mm²")
    y = 640
    s.text(30, y, "Chaîne des servos (chaque servo a 2 connecteurs : entrée et sortie)")
    names = ["hanche lacet", "hanche roulis", "hanche tangage", "genou", "cheville tangage", "cheville roulis"]
    for col, (side, base) in enumerate((("gauche", 1), ("droite", 11))):
        x = 60 + col * 540
        for i, n in enumerate(names):
            cid = "sv%d" % (base + i)
            c = s.add(Comp(cid, x, y + 20 + i * 100, 300, "ID %d · %s %s" % (base + i, n, side),
                           "servo bus Feetech 12 V", left=[("IN", "entrée bus")], right=[("OUT", "sortie bus")]))
            _, iy, _, _ = c.pin("IN")
            if i == 0:
                ox, oy, _, _ = s.comps["inj_" + side].pin("O")
                turn = y - 20 - col * 12
                s.wire("inj_%s.O" % side, cid + ".IN", "uart",
                       via=[(ox + 15 + col * 10, oy), (ox + 15 + col * 10, turn), (x - 20, turn), (x - 20, iy)])
            else:
                px, py, _, _ = s.comps["sv%d" % (base + i - 1)].pin("OUT")
                mid = py + 40
                s.wire("sv%d.OUT" % (base + i - 1), cid + ".IN", "uart",
                       via=[(px + 15, py), (px + 15, mid), (x - 20, mid), (x - 20, iy)])
    # pieds
    y = y + 20 + 6 * 100 + 60
    s.text(30, y - 20, "Pieds : 8 cellules de charge, chacune avec son HX711")
    s.add(Comp("mp", 30, y + 20, 220, "Arduino Mega n°2", "même carte, broches 22 à 37",
               right=[("5V", "5 V"), ("GND", "GND")] + [("D%d" % (22 + k), "broche %d" % (22 + k)) for k in range(16)]))
    places = ["G avant-ext.", "G avant-int.", "G arrière-ext.", "G arrière-int.",
              "D avant-ext.", "D avant-int.", "D arrière-ext.", "D arrière-int."]
    hy = y
    s.rail("h5", 420, hy + 30, hy + 7 * 150 + 80, "v5", "5 V")
    s.rail("hg", 440, hy + 30, hy + 7 * 150 + 80, "gnd", "GND")
    s.wire("mp.5V", "rail:h5", "v5")
    s.wire("mp.GND", "rail:hg", "gnd")
    for n, place in enumerate(places):
        yy = hy + n * 150
        hid, cid = "hx%d" % n, "lc%d" % n
        s.add(Comp(hid, 480, yy, 250, "HX711 n°%d" % n, "RATE au VCC (80 mesures/s)",
                   left=[("VCC", "VCC"), ("GND", "GND"), ("DT", "DT (DOUT)"), ("SCK", "SCK")],
                   right=[("E+", "E+"), ("E-", "E−"), ("A+", "A+"), ("A-", "A−")]))
        s.add(Comp(cid, 830, yy, 240, "Cellule %d · %s" % (n, place), "pont complet 4 fils",
                   left=[("EP", "excitation +"), ("EM", "excitation −"), ("SP", "signal +"), ("SM", "signal −")]))
        s.wire("rail:h5", hid + ".VCC", "v5")
        s.wire("rail:hg", hid + ".GND", "gnd")
        # couloirs : la cellule du haut prend le couloir le plus à droite (pas de croisement)
        s.wire("mp.D%d" % (22 + 2 * n), hid + ".DT", "sig", lane=400 - (2 * n) * 8)
        s.wire("mp.D%d" % (23 + 2 * n), hid + ".SCK", "sig", lane=400 - (2 * n + 1) * 8)
        for a, b, net in (("E+", "EP", "v5"), ("E-", "EM", "gnd"), ("A+", "SP", "ana"), ("A-", "SM", "ana")):
            s.wire("%s.%s" % (hid, a), "%s.%s" % (cid, b), net, lane=780, section="fil de la cellule")
    s.notes = [
        "Câblage du bus : liaison RX-RX et TX-TX entre la Mega et l'adaptateur Waveshare (sa documentation), cavalier "
        "en position A. Les deux jambes forment deux chaînes séparées : un défaut sur une jambe n'arrête pas l'autre.",
        "Le jack de l'adaptateur ne supporte pas le courant de 6 gros servos : la puissance est injectée au début de "
        "chaque chaîne par un câble 3 fils (DATA depuis l'adaptateur, + et − depuis le bornier 12 V avec un fusible "
        "de 10 A). Côté adaptateur, ne raccorder que DATA et GND.",
        "Programmer l'identifiant de chaque servo un par un (logiciel FD de Feetech) AVANT de les chaîner.",
        "HX711 vert : la broche RATE est reliée à la masse par une piste. Couper la piste et relier RATE au VCC "
        "pour passer de 10 à 80 mesures/s (sinon l'équilibre réagit 8 fois moins vite).",
        "Cellule 3 fils (demi-pont, type pèse-personne) : la compléter avec 2 résistances de 1 kΩ (E+ → A− et "
        "A− → E−) et brancher le fil central sur A+. Une cellule 4 fils (pont complet) se branche directement.",
        "Couleurs des fils des cellules : souvent rouge E+, noir E−, vert A+, blanc A−, mais vérifier la fiche du vendeur.",
    ]
    return s


SHEETS = [
    ("alimentation", sheet_power),
    ("tete", sheet_head),
    ("cou", sheet_neck),
    ("torse", sheet_torso),
    ("bras", sheet_arms),
    ("mains", sheet_hands),
    ("bassin", sheet_pelvis),
    ("jambes", sheet_legs),
]


def sheet_list():
    out = []
    for sid, fn in SHEETS:
        s = fn()
        out.append({"id": sid, "title": s.title, "subtitle": s.subtitle})
    return out


def get_sheet(sid):
    for key, fn in SHEETS:
        if key == sid:
            return fn().to_dict()
    return None


def all_sheets():
    return [fn().to_dict() for _, fn in SHEETS]
