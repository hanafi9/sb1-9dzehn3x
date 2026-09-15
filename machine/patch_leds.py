#!/usr/bin/env python3
"""Bascule le COB sur PB0 en [neopixel] WS2811, sans toucher au reste.

Ne reecrit PAS printer.cfg en entier : le bloc SAVE_CONFIG (PID, modele
Cartographer, Z offset, bed mesh) est preserve tel quel.

Relancable pour ajuster le reglage une fois le ruban teste :
    patch_leds.py --chain 47 --order GRB
Si [neopixel cob_led] existe deja, pin / chain_count / color_order sont
mis a jour sur place.
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

def bloc(txt, entete):
    """Etendue d'une section, de son entete jusqu'a la section suivante."""
    m = re.search(r"^\[%s\]\s*$" % re.escape(entete), txt, re.M)
    if not m:
        return None
    suite = re.search(r"^\[", txt[m.end():], re.M)
    return m.start(), m.end() + (suite.start() if suite else len(txt) - m.end())

txt = CFG.read_text(encoding="utf-8")
avant = txt

# Garde-fou : ne jamais avaler le bloc SAVE_CONFIG
coupe = txt.find("#*# <---------------------- SAVE_CONFIG")
tete, queue = (txt[:coupe], txt[coupe:]) if coupe != -1 else (txt, "")

fait = []

# 1. L'ancienne sortie PWM disparait, remplacee par la section neopixel
b = bloc(tete, "output_pin cob_led")
if b:
    tete = tete[:b[0]] + NOUVEAU + "\n" + tete[b[1]:]
    fait.append("[output_pin cob_led] (PWM, PB10) -> [neopixel cob_led] (PB0)")
elif "[neopixel cob_led]" in tete:
    # Deja bascule : on ajuste les trois valeurs reglables sur place, pour que
    # le script reste utile apres COB_TEST (chain_count, color_order).
    d = bloc(tete, "neopixel cob_led")
    corps, avant_corps = tete[d[0]:d[1]], tete[d[0]:d[1]]
    for cle, val in (("pin", PIN), ("chain_count", CHAIN), ("color_order", ORDER)):
        corps = re.sub(r"^(%s:\s*)\S+" % cle, r"\g<1>%s" % val, corps, count=1, flags=re.M)
    tete = tete[:d[0]] + corps + tete[d[1]:]
    fait.append("[neopixel cob_led] ajuste : pin=%s chain_count=%s color_order=%s"
                % (PIN, CHAIN, ORDER) if corps != avant_corps
                else "[neopixel cob_led] deja conforme")

# 2. chamber_leds passe en commentaire : il ne peut pas partager PB0
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

# 3. leds.cfg doit etre inclus, sinon tout son contenu est ignore : les macros
#    STATUS_*, COB_TEST et LUMIERE n'existent tout simplement pas, et Klipper
#    repond « Unknown command ». Le fichier peut etre present sans etre lu.
if "[include leds.cfg]" not in tete:
    lignes = tete.split("\n")
    pos = max((i for i, l in enumerate(lignes) if l.startswith("[include ")),
              default=-1)
    lignes.insert(pos + 1, "[include leds.cfg]")
    tete = "\n".join(lignes)
    fait.append("[include leds.cfg] ajoute (il manquait : macros non chargees)")

# 4. Allumage automatique. La camera a besoin de lumiere, et le workflow n8n
#    de detection d'anomalie analyse ses images : dans le noir, il ne voit
#    rien non plus. On allume donc des le debut de START_PRINT — soit pendant
#    la chauffe, la trempe et le palpage, bien avant la premiere couche.
def inserer_apres(txt, section, ancre, ligne):
    """Insere `ligne` juste apres la premiere occurrence de `ancre` dans
    `section`, en reprenant son indentation. Ne fait rien si deja presente."""
    b = bloc(txt, section)
    if not b:
        return txt, "%s introuvable — ignore" % section
    corps = txt[b[0]:b[1]]
    if re.search(r"^[ \t]*%s[ \t]*$" % re.escape(ligne), corps, re.M):
        return txt, None
    m = re.search(r"^([ \t]*)%s[ \t]*$" % re.escape(ancre), corps, re.M)
    if not m:
        return txt, "ancre '%s' absente de %s — ignore" % (ancre, section)
    corps = corps[:m.end()] + "\n" + m.group(1) + ligne + corps[m.end():]
    return txt[:b[0]] + corps + txt[b[1]:], "%s : %s ajoute" % (section, ligne)

for section, ancre, ligne in (
        ("gcode_macro START_PRINT", "CLEAR_PAUSE", "STATUS_PRINTING"),
        ("gcode_macro END_PRINT",   "M84",         "STATUS_DONE")):
    tete, note = inserer_apres(tete, section, ancre, ligne)
    if note:
        fait.append(note)

# 5. Les macros LED_ON / LED_OFF / LED_DIM nommaient chamber_leds en dur.
#    _USER_START_PRINT_BEFORE_HOMING appelle LED_ON : une fois chamber_leds
#    commente, Klipper interrompait START_PRINT sur « not valid for LED », la
#    chauffe n'avait jamais lieu, et la suite echouait sur « extruder not hot
#    enough ». On les fait passer par les primitives de leds.cfg, qui lisent le
#    nom du ruban dans _LED_VARS : une seule source de verite.
for nom, remplacement in (("LED_ON", "LUMIERE"),
                          ("LED_OFF", "LUMIERE_OFF"),
                          ("LED_DIM", "LUMIERE V=0.2")):
    b = bloc(tete, "gcode_macro %s" % nom)
    if not b:
        continue
    corps = tete[b[0]:b[1]]
    if "SET_LED" not in corps:
        continue
    corps = re.sub(r"(?m)^([ \t]*)SET_LED[ \t]+LED=\S+.*$",
                   lambda m: m.group(1) + remplacement, corps, count=1)
    tete = tete[:b[0]] + corps + tete[b[1]:]
    fait.append("%s : SET_LED en dur -> %s" % (nom, remplacement))

txt = tete + queue

if txt == avant:
    print("Rien a changer — le fichier est deja a jour.")
    sys.exit(0)

# Verifications avant d'ecrire
assert txt.count("[neopixel cob_led]") == 1, "section cob_led en double"
assert not re.search(r"^\[neopixel chamber_leds\]", txt, re.M), "chamber_leds encore actif"
# Un SET_LED nommant un ruban commente interrompt la macro qui l'appelle.
# C'est ce qui cassait START_PRINT : Klipper s'arretait avant la chauffe.
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
