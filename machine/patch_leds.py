#!/usr/bin/env python3
"""Cable le ruban FCOB WS2811 et l'eclairage d'etat dans printer.cfg.

Ne reecrit PAS printer.cfg en entier : le bloc SAVE_CONFIG (PID, modele
Cartographer, Z offset, bed mesh) est preserve tel quel.

Relancable sans risque — il n'applique que ce qui manque, et affiche ce qu'il
a fait. Pour ajuster le ruban apres COB_TEST :

    patch_leds.py --chain 47 --order GRB
"""
import re, shutil, sys, time
from pathlib import Path

CHAIN, ORDER, PIN = "47", "RGB", "PB0"
args, fichier = sys.argv[1:], None
while args:
    a = args.pop(0)
    if a == "--chain":   CHAIN = args.pop(0)
    elif a == "--order": ORDER = args.pop(0)
    elif a == "--pin":   PIN = args.pop(0)
    else:                fichier = a

CFG = Path(fichier) if fichier else Path.home() / "printer_data/config/printer.cfg"

NOUVEAU = """[neopixel cob_led]
pin: %s                         # connecteur Neopixel — sortie logique sure
chain_count: %s                  # segments du ruban (1 IC WS2811 = 1 segment)
color_order: %s                 # WS2811 = RGB (le WS2812 serait GRB)
initial_RED: 0
initial_GREEN: 0
initial_BLUE: 0
""" % (PIN, CHAIN, ORDER)

# Couleur de chaque etape de START_PRINT. L'ancre est la ligne AVANT laquelle
# la macro est inseree : on annonce l'etape juste avant de la lancer.
ETAPES = [
    ("M190 S{BED}",                   "STATUS_HEATING_BED"),
    ("G28",                           "STATUS_HOMING"),
    ("Z_TILT_ADJUST",                 "STATUS_LEVELING"),
    ("BED_MESH_CALIBRATE ADAPTIVE=1", "STATUS_MESHING"),
    ("M109 S{HOTEND}",                "STATUS_HEATING_NOZZLE"),
    ("M117 Impression...",            "STATUS_PRINTING"),
]


def bloc(txt, entete):
    """Etendue d'une section, de son entete jusqu'a la section suivante."""
    m = re.search(r"^\[%s\]\s*$" % re.escape(entete), txt, re.M)
    if not m:
        return None
    suite = re.search(r"^\[", txt[m.end():], re.M)
    return m.start(), m.end() + (suite.start() if suite else len(txt) - m.end())


def inserer(txt, section, ancre, ligne, avant=True):
    """Insere `ligne` avant (ou apres) `ancre` dans `section`, a la meme
    indentation. Sans effet si `ligne` y figure deja."""
    b = bloc(txt, section)
    if not b:
        return txt, None
    corps = txt[b[0]:b[1]]
    if re.search(r"^[ \t]*%s[ \t]*$" % re.escape(ligne), corps, re.M):
        return txt, None
    m = re.search(r"^([ \t]*)%s[ \t]*$" % re.escape(ancre), corps, re.M)
    if not m:
        return txt, "ancre '%s' absente de %s — ignore" % (ancre, section)
    pos, ins = (m.start(), m.group(1) + ligne + "\n") if avant \
               else (m.end(), "\n" + m.group(1) + ligne)
    corps = corps[:pos] + ins + corps[pos:]
    return txt[:b[0]] + corps + txt[b[1]:], "%s : %s" % (section, ligne)


txt = CFG.read_text(encoding="utf-8")
avant_tout = txt

# Garde-fou : ne jamais avaler le bloc SAVE_CONFIG
coupe = txt.find("#*# <---------------------- SAVE_CONFIG")
tete, queue = (txt[:coupe], txt[coupe:]) if coupe != -1 else (txt, "")

fait = []

# 1. Le COB est adressable : [neopixel], pas une sortie PWM
b = bloc(tete, "output_pin cob_led")
if b:
    tete = tete[:b[0]] + NOUVEAU + "\n" + tete[b[1]:]
    fait.append("[output_pin cob_led] (PWM, PB10) -> [neopixel cob_led] (PB0)")
elif "[neopixel cob_led]" in tete:
    d = bloc(tete, "neopixel cob_led")
    corps = origine = tete[d[0]:d[1]]
    for cle, val in (("pin", PIN), ("chain_count", CHAIN), ("color_order", ORDER)):
        corps = re.sub(r"^(%s:\s*)\S+" % cle, r"\g<1>%s" % val, corps, count=1, flags=re.M)
    tete = tete[:d[0]] + corps + tete[d[1]:]
    if corps != origine:
        fait.append("[neopixel cob_led] ajuste : chain_count=%s color_order=%s"
                    % (CHAIN, ORDER))

# 2. chamber_leds ne peut pas partager PB0 avec le COB
b = bloc(tete, "neopixel chamber_leds")
if b:
    corps = tete[b[0]:b[1]].rstrip("\n")
    mis = "\n".join("# " + l if l.strip() else "#" for l in corps.split("\n"))
    tete = tete[:b[0]] + (
        "# ⚠️ EN PAUSE — le COB occupe PB0. Deux [neopixel] ne peuvent pas\n"
        "#    partager une broche : Klipper refuserait de demarrer.\n"
        "#    Pour le remettre : une autre broche LOGIQUE libre (pas une\n"
        "#    sortie FAN), decommenter, et rendre a _LED_VARS son\n"
        "#    variable_neopixel: 'chamber_leds'.\n"
        "#    A savoir : 24 WS2812 en blanc plein tirent ~1,4 A sur le rail\n"
        "#    5 V qui alimente aussi le MCU. Remettre initial_* a 0.\n"
        + mis + "\n") + tete[b[1]:]
    fait.append("[neopixel chamber_leds] commente (conflit de broche PB0)")

# 3. Sans [include], leds.cfg est present mais jamais lu : aucune de ses
#    macros n'existe et Klipper repond « Unknown command ».
if "[include leds.cfg]" not in tete:
    lignes = tete.split("\n")
    pos = max((i for i, l in enumerate(lignes) if l.startswith("[include ")), default=-1)
    lignes.insert(pos + 1, "[include leds.cfg]")
    tete = "\n".join(lignes)
    fait.append("[include leds.cfg] ajoute (il manquait : macros non chargees)")

# 4. LED_ON / LED_OFF / LED_DIM nommaient le ruban en dur. Comme
#    _USER_START_PRINT_BEFORE_HOMING appelle LED_ON, un nom perime
#    interrompait START_PRINT avant la chauffe (« not valid for LED »), et le
#    G-code suivant echouait sur « extruder not hot enough ». On passe par les
#    primitives de leds.cfg : le nom du ruban n'existe plus qu'a un endroit.
for nom, remplacement in (("LED_ON", "LUMIERE"),
                          ("LED_OFF", "LUMIERE_OFF"),
                          ("LED_DIM", "LUMIERE V=0.2")):
    b = bloc(tete, "gcode_macro %s" % nom)
    if not b or "SET_LED" not in tete[b[0]:b[1]]:
        continue
    corps = re.sub(r"(?m)^([ \t]*)SET_LED[ \t]+LED=\S+.*$",
                   lambda m: m.group(1) + remplacement, tete[b[0]:b[1]], count=1)
    tete = tete[:b[0]] + corps + tete[b[1]:]
    fait.append("%s : SET_LED en dur -> %s" % (nom, remplacement))

# 5. Un STATUS_PRINTING place en tete de START_PRINT fige le blanc pour toute
#    la sequence : plus aucune couleur d'etape n'est visible. Il repart a sa
#    vraie place, juste avant la premiere couche.
b = bloc(tete, "gcode_macro START_PRINT")
if b:
    corps = re.sub(r"(?m)^([ \t]*)STATUS_PRINTING[ \t]*\n(?=[ \t]*G90)", "",
                   tete[b[0]:b[1]], count=1)
    if corps != tete[b[0]:b[1]]:
        tete = tete[:b[0]] + corps + tete[b[1]:]
        fait.append("START_PRINT : STATUS_PRINTING prematuré retire")

# 6. Une couleur par etape, annoncee juste avant de lancer l'etape
for ancre, macro in ETAPES:
    tete, note = inserer(tete, "gcode_macro START_PRINT", ancre, macro)
    if note:
        fait.append(note)

tete, note = inserer(tete, "gcode_macro END_PRINT", "M84", "STATUS_DONE", avant=False)
if note:
    fait.append(note)

txt = tete + queue

if txt == avant_tout:
    print("Rien a changer — le fichier est deja a jour.")
    sys.exit(0)

# Verifications avant d'ecrire
assert txt.count("[neopixel cob_led]") == 1, "section cob_led en double"
assert not re.search(r"^\[neopixel chamber_leds\]", txt, re.M), "chamber_leds encore actif"
reste = [l for l in txt.split("\n")
         if "SET_LED" in l and "chamber_leds" in l and not l.lstrip().startswith("#")]
assert not reste, "SET_LED pointe encore sur chamber_leds : %s" % reste[:2]
if coupe != -1:
    assert queue in txt, "bloc SAVE_CONFIG perdu"

sauv = CFG.with_suffix(".cfg.bak-%s" % time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(CFG, sauv)
CFG.write_text(txt, encoding="utf-8")

print("Sauvegarde : %s" % sauv)
for f in fait:
    print("  - %s" % f)
print("  - bloc SAVE_CONFIG preserve" if coupe != -1 else "  - pas de bloc SAVE_CONFIG")
