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

txt = tete + queue

if txt == avant:
    print("Rien a changer — le fichier est deja a jour.")
    sys.exit(0)

# Verifications avant d'ecrire
assert txt.count("[neopixel cob_led]") == 1, "section cob_led en double"
assert not re.search(r"^\[neopixel chamber_leds\]", txt, re.M), "chamber_leds encore actif"
if coupe != -1:
    assert queue in txt, "bloc SAVE_CONFIG perdu"

sauv = CFG.with_suffix(".cfg.bak-%s" % time.strftime("%Y%m%d-%H%M%S"))
shutil.copy2(CFG, sauv)
CFG.write_text(txt, encoding="utf-8")

print("Sauvegarde : %s" % sauv)
for f in fait:
    print("  - %s" % f)
print("  - bloc SAVE_CONFIG preserve" if coupe != -1 else "  - pas de bloc SAVE_CONFIG")
