#!/usr/bin/env python3
"""Estimation du couple nécessaire à chaque articulation des jambes.

Modèle statique simplifié (sans les à-coups de la marche, d'où le coefficient
de sécurité). 1 kg·cm = couple d'une masse de 1 kg au bout d'un bras de 1 cm.

    python torque_calc.py --masse 18
    python torque_calc.py --masse 18 --cuisse 38 --tibia 38 --flexion 40

« masse » = masse de TOUT ce qui est porté par les jambes (haut du corps,
bassin, batteries...). PESEZ VOTRE ROBOT : c'est la donnée qui compte le plus.
"""

import argparse
import math

NM_TO_KGCM = 10.197  # 1 N·m = 10,197 kg·cm

# Couple « continu » utilisable : on prend 1/3 du couple de blocage quand le
# fabricant ne donne pas de couple nominal (le STS3250 : 16/50 ≈ 1/3).
ACTUATORS = [
    # nom, couple de blocage kg·cm, couple continu kg·cm, remarque
    ("Feetech STS3215 (12 V)", 30, 30 / 3, "bus TTL, compatible firmware"),
    ("Feetech STS3250 (12 V)", 50, 16, "bus TTL, compatible firmware"),
    ("Waveshare/Feetech RSBL85-12", 85, 85 / 3, "à vérifier : bus/protocole avant achat"),
    ("Feetech SM-1500 (12 V)", 180, 180 / 3, "bus RS485 115200 bauds : adaptateur RS485"),
    ("MyActuator RMD-X8 Pro", None, 8 * NM_TO_KGCM, "brushless 48 V, bus CAN : firmware à adapter"),
]


def joint_torques(masse, cuisse_cm, tibia_cm, flexion_deg, bras_lateral_cm, decalage_avant_cm):
    """Couples statiques (kg·cm) par articulation, pour UNE jambe."""
    half = masse / 2.0
    # Accroupi, hanche à l'aplomb de la cheville : le genou s'écarte de la ligne
    # de charge de L·sin(flexion/2) (cuisse et tibia de même longueur).
    lever_genou = min(cuisse_cm, tibia_cm) * math.sin(math.radians(flexion_deg) / 2.0)
    return {
        "genou (accroupi, 2 pieds)": half * lever_genou,
        "hanche tangage (buste penché)": half * decalage_avant_cm,
        "cheville tangage (sur 1 pied)": masse * decalage_avant_cm,
        "hanche roulis (sur 1 pied)": masse * bras_lateral_cm,
        "cheville roulis (sur 1 pied)": masse * bras_lateral_cm,
        "hanche lacet": 0.1 * masse * bras_lateral_cm,
    }


def suitable(required):
    return [a for a in ACTUATORS if a[2] >= required]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--masse", type=float, required=True, help="kg portés par les jambes")
    p.add_argument("--cuisse", type=float, default=38.0, help="cm, hanche -> genou")
    p.add_argument("--tibia", type=float, default=38.0, help="cm, genou -> cheville")
    p.add_argument("--flexion", type=float, default=40.0, help="flexion max du genou, degrés")
    p.add_argument("--bras-lateral", type=float, default=9.0,
                   help="cm, écart latéral entre la hanche et le centre du corps")
    p.add_argument("--decalage-avant", type=float, default=5.0,
                   help="cm, décalage avant/arrière du centre de gravité")
    p.add_argument("--securite", type=float, default=1.5, help="coefficient de sécurité")
    p.add_argument("--reduction", type=float, default=1.0,
                   help="rapport de réduction ajouté (poulies, engrenages) entre servo et articulation")
    a = p.parse_args()

    torques = joint_torques(a.masse, a.cuisse, a.tibia, a.flexion, a.bras_lateral, a.decalage_avant)
    print("Masse portée : %.1f kg, coefficient de sécurité : %.1f, réduction : %.1f\n"
          % (a.masse, a.securite, a.reduction))
    print("%-32s %s" % ("articulation", "couple au servo  ->  plus petit actionneur suffisant"))
    for joint, t in torques.items():
        req = t * a.securite / a.reduction
        fits = suitable(req)
        best = fits[0][0] if fits else "AUCUN de la liste : réduire la masse ou ajouter une réduction"
        print("%-32s %7.1f kg·cm  ->  %s" % (joint, req, best))
    print("\nCouple continu retenu par actionneur :")
    for name, stall, cont, note in ACTUATORS:
        stall_txt = "%d kg·cm blocage" % stall if stall else "nominal constructeur"
        print("  %-30s %6.1f kg·cm continu (%s) - %s" % (name, cont, stall_txt, note))
    print("\nUne réduction de rapport R divise le couple demandé au servo par R, mais aussi sa vitesse.")


if __name__ == "__main__":
    main()
