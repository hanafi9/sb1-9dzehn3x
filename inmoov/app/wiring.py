"""Schémas par partie du robot : câblage simplifié, servos, pièces et matériel.

Électronique simplifiée
-----------------------
Au lieu de câbler chaque servo directement sur deux Arduino Mega, on utilise :

- UNE Arduino Mega (i01.left, programme MrlComm) reliée au Raspberry Pi en USB ;
- TROIS cartes PCA9685 16 voies (service MyRobotLab « Adafruit16CServoDriver »)
  branchées sur le bus I2C de cette Mega (broches SDA 20 / SCL 21) :
    0x40 « pca_tete »   : tête + ventre        (11 servos)
    0x41 « pca_gauche » : bras + main gauche   (10 servos)
    0x42 « pca_droite » : bras + main droite   (10 servos)
- les jambes gardent leurs servos « bus » Feetech, tous chaînés sur un seul câble.

Sources vérifiées : classes InMoov2*Config de MyRobotLab (noms des servos),
Adafruit16CServoDriver.java et son script d'exemple (attach("arduino", "0", "0x40")),
AbstractServo.java (detach / setPin / attach), liste de matériel communautaire
(github.com/echofab-communautique/robot_inmoov) et pages inmoov.fr pour les pièces.
"""

ARDUINO = "i01.left"  # l'Arduino Mega d'InMoov2 qui sert de passerelle I2C
I2C_BUS = "0"         # numéro de bus I2C pour une Arduino (exemple officiel MRL)

BOARDS = [
    {"name": "pca_tete", "address": "0x40", "jumpers": "rien à souder",
     "label": "Carte A : tête et ventre", "place": "dans le torse, sous le cou"},
    {"name": "pca_gauche", "address": "0x41", "jumpers": "souder A0",
     "label": "Carte B : bras et main gauche", "place": "dans le torse, côté gauche"},
    {"name": "pca_droite", "address": "0x42", "jumpers": "souder A1",
     "label": "Carte C : bras et main droite", "place": "dans le torse, côté droit"},
]

# servo MyRobotLab -> (carte, canal, modèle de servo d'origine)
SERVO_PLAN = {
    "i01.head.rothead": ("pca_tete", 0, "Hitec HS-805BB"),
    "i01.head.neck": ("pca_tete", 1, "Hitec HS-805BB"),
    "i01.head.rollNeck": ("pca_tete", 2, "HK15298B ×2 (maître / esclave, câble en Y)"),
    "i01.head.jaw": ("pca_tete", 3, "HK15298B"),
    "i01.head.eyeX": ("pca_tete", 4, "DS929HV (Corona)"),
    "i01.head.eyeY": ("pca_tete", 5, "DS929HV (Corona)"),
    "i01.head.eyelidLeft": ("pca_tete", 6, "petit servo (ex. DS929HV)"),
    "i01.head.eyelidRight": ("pca_tete", 7, "petit servo (ex. DS929HV)"),
    "i01.torso.topStom": ("pca_tete", 8, "Hitec HS-805BB (2 dans la liste communautaire, câble en Y)"),
    "i01.torso.midStom": ("pca_tete", 9, "2 moteurs Vigor VSD-11AYMB ou CYS-S8218, un seul potentiomètre"),
    "i01.torso.lowStom": ("pca_tete", 10, "optionnel (non présent sur la plupart des InMoov)"),
}
for _side, _board in (("left", "pca_gauche"), ("right", "pca_droite")):
    for _ch, (_key, _model) in enumerate([
        ("Arm.omoplate", "Hitec HS-805BB"),
        ("Arm.shoulder", "Hitec HS-805BB"),
        ("Arm.rotate", "Hitec HS-805BB"),
        ("Arm.bicep", "Hitec HS-805BB"),
        ("Hand.thumb", "HK15298B (ou MG996R)"),
        ("Hand.index", "HK15298B (ou MG996R)"),
        ("Hand.majeure", "HK15298B (ou MG996R)"),
        ("Hand.ringFinger", "HK15298B (ou MG996R)"),
        ("Hand.pinky", "HK15298B (ou MG996R)"),
        ("Hand.wrist", "MG996R"),
    ]):
        SERVO_PLAN["i01.%s%s" % (_side, _key)] = (_board, _ch, _model)

LEG_SERVO_MODEL = "servo bus Feetech (voir calcul de couple)"

STL_VIEWER = "https://inmoov.fr/inmoov-stl-parts-viewer/"

# Pièces imprimées : noms relevés dans la documentation InMoov (liste principale).
# La liste complète et à jour est dans la galerie STL officielle (lien affiché).
PARTS = [
    {
        "key": "tete", "label": "Tête",
        "servo_prefixes": ["i01.head."],
        "summary": "Rotation et inclinaison de la tête, mâchoire, yeux et paupières. Tous sur la carte A (0x40).",
        "printed": [
            ("Cou et mâchoire", ["Neck", "NeckHinge", "NeckBolts", "MainGear", "ServoGear", "GearHolder",
                                 "Ring", "LowBack", "Jaw", "JawSupport", "FaceHolder", "SkullServoFix"]),
            ("Crâne", ["TopBackSkull", "TeethTopHolder"]),
            ("Mécanisme des yeux", ["EyeBallFull ×2", "EyeHinge ×2", "EyeHingeCurve", "EyeHolder",
                                    "EyePlateLeft", "EyePlateRight", "EyeSupport (avec supports)", "EyeToNose"]),
        ],
        "hardware": [
            ("Hitec HS-805BB (rotation + cou)", "2"),
            ("HK15298B (mâchoire, inclinaison du cou)", "3"),
            ("DS929HV ou équivalent (yeux)", "2 à 3"),
            ("Caméra(s) USB dans les yeux", "1 ou 2"),
            ("Rallonges de servo (vers le torse)", "selon besoin"),
        ],
        "pages": [("Cou et mâchoire", "https://inmoov.fr/neck-and-jaw/"),
                  ("Mécanisme des yeux", "https://inmoov.fr/eye-mechanism/")],
    },
    {
        "key": "torse", "label": "Torse",
        "servo_prefixes": [],
        "summary": "Pas de servo : le torse accueille l'électronique centrale (Arduino Mega, 3 cartes PCA9685, "
                   "répartiteur d'alimentation, haut-parleurs, capteur PIR).",
        "printed": [
            ("Plaques du torse", ["Homplatefront+", "Homplatefront-", "Homplateback+", "Homplateback-",
                                  "Homplatebacklow+", "Homplatebacklow-", "Sternum", "ThroatLower", "ServoHolster"]),
        ],
        "hardware": [
            ("Arduino Mega 2560 (i01.left, programme MrlComm)", "1"),
            ("Carte PCA9685 16 voies I2C", "3 (+1 de rechange)"),
            ("Alimentation 6 V forte puissance (ex. 6-15 V / 20 A réglée sur 6 V)", "1"),
            ("Bornier de répartition + fusibles (un par carte)", "1"),
            ("Haut-parleurs 4 Ω 6 W", "2"),
            ("Capteur PIR", "1"),
            ("Câble I2C court (4 fils : 5V, GND, SDA, SCL)", "chaîne entre les 3 cartes"),
        ],
        "pages": [("Épaules et torse", "https://inmoov.fr/shoulder-and-torso/")],
    },
    {
        "key": "bras", "label": "Bras",
        "servo_prefixes": ["i01.leftArm.", "i01.rightArm."],
        "summary": "Omoplate, épaule, rotation et biceps de chaque bras. Bras gauche sur la carte B (0x41), "
                   "bras droit sur la carte C (0x42), canaux 0 à 3.",
        "printed": [
            ("Épaule (par épaule)", ["ClaviBack", "ClaviFront", "PistonClavi", "PistonBase", "PivConnector ×2",
                                     "PivGear", "PivMit", "PivPotentio ×2 (Round ou Square)", "PivPotHolder",
                                     "PivTit", "PivWorm", "PivCenter", "ServoHolster", "ServoHolder",
                                     "ShoulderConnect"]),
            ("Biceps (par bras)", ["GearHolder", "HighArmSide ×2", "LowArmSide ×2", "RotGear", "RotWorm",
                                   "ElbowShaftGear (collé au RobCap)"]),
        ],
        "hardware": [
            ("Hitec HS-805BB (4 par bras)", "8"),
            ("Potentiomètres pour les servos modifiés (épaule, omoplate, biceps)", "selon tutoriel"),
            ("Vis M8 ×100 mm (axes)", "selon tutoriel"),
        ],
        "pages": [("Biceps", "https://inmoov.fr/bicep/"),
                  ("Épaules et torse", "https://inmoov.fr/shoulder-and-torso/")],
    },
    {
        "key": "mains", "label": "Mains",
        "servo_prefixes": ["i01.leftHand.", "i01.rightHand."],
        "summary": "Cinq doigts et le poignet de chaque main. Main gauche sur la carte B (0x41), "
                   "main droite sur la carte C (0x42), canaux 4 à 9.",
        "printed": [
            ("Main et avant-bras (par main)", ["Thumb", "Index", "Majeure", "Ringfinger", "Auriculaire",
                                               "Bolt_entretoise", "WristLarge", "WristSmall", "TopSurface",
                                               "CoverFinger", "RobCap3", "RobPart2", "RobPart3", "RobPart4",
                                               "RobPart5", "RotaWrist1", "RotaWrist2", "RotaWrist3",
                                               "WristGears", "CableHolderWrist"]),
        ],
        "hardware": [
            ("HK15298B ou MG996R (doigts, 5 par main)", "10"),
            ("MG996R (poignets)", "2"),
            ("Fil tressé 0,8 mm 200 lb (tendons)", "environ 10 m"),
            ("Ressorts d'extension 5 mm × 1 cm", "10"),
            ("Nouveau : capteurs de force FSR au bout des doigts (voir Capteurs)", "10"),
        ],
        "pages": [("Main et avant-bras", "https://inmoov.fr/hand-and-forarm/")],
    },
    {
        "key": "bassin", "label": "Bassin",
        "servo_prefixes": ["i01.torso."],
        "summary": "Articulations du ventre (topStom, midStom, lowStom) sur la carte A (0x40), canaux 8 à 10, "
                   "et emplacement conseillé de l'électronique des jambes (Arduino Mega n°2, capteur BNO085, "
                   "arrêt d'urgence).",
        "printed": [
            ("Ventre haut (Top Stomach)", ["DiskIntern", "DiskUnder", "DiskExtern ×4", "TStomSpacer",
                                           "TStomRotFront", "TStomRotBack", "TStomPotHolder", "TStomCovRight",
                                           "TStomCovLeft", "TStoServoHolster", "TStoPistonRight",
                                           "TStoPistonLeft", "TStoMiddle ×2", "TStoFrontStand", "TStoFrontRight",
                                           "TStoFrontLeft", "TStoBackStandRight", "TStoBackStandLeft",
                                           "TStoBackRight", "TStoBackLeft", "StomGear", "StoGearAttach",
                                           "ServoBack", "RollFrontRight", "RollFrontLeft", "RollBackRight",
                                           "RollBackLeft"]),
            ("Ventre milieu (Mid Stomach)", ["BotBackLeft", "BotBackRight", "BotCapLeft", "BotCapRight",
                                             "BotFrontLeft", "BotFrontRight", "HipCoverFront", "HipCoverLeft",
                                             "HipCoverRight", "MidPotHolder", "MidWormRight ×2"]),
        ],
        "hardware": [
            ("Hitec HS-805BB (ventre haut, selon la liste communautaire)", "2"),
            ("Vigor VSD-11AYMB ou CYS-S8218 (ventre milieu, synchronisés)", "2"),
            ("Arduino Mega 2560 n°2 (firmware des jambes)", "1"),
            ("Centrale inertielle BNO085", "1"),
            ("Bouton d'arrêt d'urgence (contact NF) + relais de coupure 12 V", "1"),
        ],
        "pages": [("Ventre haut", "https://inmoov.fr/top-stomach/"),
                  ("Ventre milieu", "https://inmoov.fr/mid-stomach/")],
    },
    {
        "key": "jambes", "label": "Jambes",
        "servo_prefixes": [],
        "legs": True,
        "summary": "12 servos bus Feetech (6 par jambe) chaînés sur un seul câble, pilotés par l'Arduino Mega "
                   "n°2 (firmware inmoov_legs). Il n'existe pas de jambes motorisées officielles : la mécanique "
                   "est à concevoir (voir le calcul de couple).",
        "printed": [],
        "note": "Pas de modèle officiel motorisé : les jambes InMoov publiées sont statiques. "
                "Les supports de servos sont à adapter aux moteurs choisis.",
        "hardware": [
            ("Servos bus Feetech (voir torque_calc.py)", "12"),
            ("Adaptateur bus Feetech (half-duplex) ou RS485 selon le modèle", "1"),
            ("Alimentation 12 V forte puissance, via l'arrêt d'urgence", "1"),
            ("Portique de sécurité + sangle au bassin", "1"),
            ("Cellule de charge 50 kg demi-pont (type pèse-personne) ou cellule à poutre", "8"),
            ("Module HX711 (une par cellule, broche RATE à 5 V pour 80 mesures/s)", "8"),
            ("Semelle rigide en 2 plaques (haut / bas) par pied, cellules aux 4 coins", "2"),
        ],
        "foot_sensors": {
            "note": "Une cellule de charge à chaque coin du pied, prise entre la plaque du dessus (fixée à la cheville) "
                    "et la semelle qui touche le sol. Chaque cellule a son HX711 ; les HX711 sont sur l'Arduino "
                    "Mega n°2 (5 V, GND). Les capteurs FSR ne conviennent pas ici : ils saturent vers 10 N.",
            "cells": [
                ("0", "Pied gauche, avant extérieur", "22", "23"),
                ("1", "Pied gauche, avant intérieur", "24", "25"),
                ("2", "Pied gauche, arrière extérieur", "26", "27"),
                ("3", "Pied gauche, arrière intérieur", "28", "29"),
                ("4", "Pied droit, avant extérieur", "30", "31"),
                ("5", "Pied droit, avant intérieur", "32", "33"),
                ("6", "Pied droit, arrière extérieur", "34", "35"),
                ("7", "Pied droit, arrière intérieur", "36", "37"),
            ],
        },
        "pages": [("Capteurs de pieds à 4 cellules (Hamburg Bit-Bots)", "https://bit-bots.de/?p=7555"),
                  ("Chaussures à capteurs de force open source (article)", "https://arxiv.org/abs/2104.06618")],
    },
]


SENSOR_PART = {
    "key": "capteurs", "label": "Capteurs (nouveau)",
    "servo_prefixes": [],
    "summary": "Bus I2C n°1 du Raspberry Pi 5 (broche 3 = SDA, broche 5 = SCL, 3,3 V, GND), lu par "
               "sensors/sensor_hub.py : courant de chaque carte PCA9685 avec coupure de sécurité, batterie, "
               "toucher au bout des doigts et détection de présence.",
    "i2c_devices": [
        ("INA226 batterie", "0x40", "A0 et A1 à GND", "tension et courant de la batterie, shunt 1 mΩ"),
        ("INA226 carte A (tête)", "0x41", "A0 à VS", "alimentation de pca_tete, shunt 2 mΩ"),
        ("INA226 carte B (gauche)", "0x44", "A1 à VS", "alimentation de pca_gauche, shunt 2 mΩ"),
        ("INA226 carte C (droite)", "0x45", "A0 et A1 à VS", "alimentation de pca_droite, shunt 2 mΩ"),
        ("ADS1115 main gauche", "0x48", "ADDR à GND", "FSR pouce, index, majeur, annulaire"),
        ("ADS1115 main droite", "0x49", "ADDR à VDD", "FSR pouce, index, majeur, annulaire"),
        ("ADS1115 auriculaires", "0x4A", "ADDR à SDA", "voie 0 = auriculaire gauche, voie 1 = droit"),
        ("VL53L1X distance", "0x29", "par défaut", "présence d'une personne devant le robot"),
    ],
    "printed": [],
    "note": "Les capteurs FSR se placent sous le bout des doigts (silicone ou TPU par-dessus). Chaque FSR "
            "forme un pont diviseur avec une résistance de 10 kΩ entre 3,3 V et GND ; le point milieu va sur "
            "une voie de l'ADS1115.",
    "hardware": [
        ("Module INA226 (remplacer le shunt R100 par 1 ou 2 mΩ selon le courant)", "4"),
        ("Module ADS1115 16 bits 4 voies", "3"),
        ("Capteur de force FSR (ex. FSR 402) + résistance 10 kΩ", "10"),
        ("Capteur de distance VL53L1X", "1"),
        ("Anneau ou bande NeoPixel (LED d'état, service i01.neoPixel sur l'Arduino)", "1"),
        ("Batterie LiFePO4 4S (12,8 V) avec BMS", "1"),
        ("Convertisseur abaisseur 12 V → 6 V, 20 A ou plus (servos du haut du corps)", "1 à 3"),
        ("Convertisseur 12 V → 5 V 5 A pour le Raspberry Pi 5", "1"),
        ("Câblage I2C : câbles courts ou connecteurs Qwiic / STEMMA QT", "selon besoin"),
    ],
    "pages": [],
}
PARTS.append(SENSOR_PART)


def board_by_name(name):
    for b in BOARDS:
        if b["name"] == name:
            return b
    raise KeyError(name)


def part_view(part, groups, legs_cfg=None):
    """Assemble les données d'une partie : servos avec leur carte et leur canal."""
    labels = {}
    for g in groups:
        for s in g["servos"]:
            labels[s["service"]] = s["label"] + (" (gauche)" if "left" in g["key"]
                                                 else " (droite)" if "right" in g["key"] else "")
    servos = []
    for service, (board, channel, model) in SERVO_PLAN.items():
        if any(service.startswith(p) for p in part["servo_prefixes"]):
            b = board_by_name(board)
            servos.append({"service": service, "label": labels.get(service, service), "model": model,
                           "board": board, "address": b["address"], "channel": channel})
    servos.sort(key=lambda s: (s["address"], s["channel"]))
    view = {k: part[k] for k in ("key", "label", "summary", "pages")}
    view["note"] = part.get("note")
    if part.get("i2c_devices"):
        view["i2c_devices"] = [{"name": n, "address": a, "pins": p, "role": r} for n, a, p, r in part["i2c_devices"]]
    if part.get("foot_sensors"):
        fs = part["foot_sensors"]
        view["foot_sensors"] = {"note": fs["note"], "cells": [{"cell": c, "place": p, "dout": d, "sck": k}
                                                             for c, p, d, k in fs["cells"]]}
    view["printed"] = [{"group": g, "items": items} for g, items in part["printed"]]
    view["hardware"] = [{"item": i, "qty": q} for i, q in part["hardware"]]
    view["servos"] = servos
    view["boards"] = [b for b in BOARDS if any(s["board"] == b["name"] for s in servos)]
    if part.get("legs") and legs_cfg:
        view["leg_servos"] = sorted(({"name": n, "id": j["id"], "model": LEG_SERVO_MODEL}
                                     for n, j in legs_cfg["joints"].items()), key=lambda x: x["id"])
    return view


def mrl_script():
    """Script Python à coller dans le service Python de MyRobotLab."""
    lines = [
        "# InMoov : servos du haut du corps sur 3 cartes PCA9685 (généré par l'Atelier InMoov)",
        "# À exécuter dans l'onglet Python de MyRobotLab, InMoov2 démarré, %s connectée." % ARDUINO,
        "",
        "cartes = [",
    ]
    for b in BOARDS:
        lines.append('    ("%s", "%s"),  # %s' % (b["name"], b["address"], b["label"]))
    lines += [
        "]",
        "for nom, adresse in cartes:",
        '    carte = runtime.start(nom, "Adafruit16CServoDriver")',
        '    carte.attach("%s", "%s", adresse)' % (ARDUINO, I2C_BUS),
        "",
        "servos = [",
    ]
    for service, (board, channel, _model) in sorted(SERVO_PLAN.items(), key=lambda kv: (kv[1][0], kv[1][1])):
        lines.append('    ("%s", "%s", %d),' % (service, board, channel))
    lines += [
        "]",
        "for nom, carte, canal in servos:",
        "    servo = runtime.getService(nom)",
        "    if servo is None:",
        '        print("servo absent : " + nom)',
        "        continue",
        "    servo.detach()",
        "    servo.setPin(canal)",
        "    servo.attach(carte)",
        "",
        "# Pour conserver ce câblage au prochain démarrage :",
        '# runtime.saveConfig("inmoov2")',
    ]
    return "\n".join(lines) + "\n"


def mrl_calls():
    """Les mêmes opérations sous forme d'appels REST (service, méthode, paramètres)."""
    calls = []
    for b in BOARDS:
        calls.append(("runtime", "start", [b["name"], "Adafruit16CServoDriver"]))
        calls.append((b["name"], "attach", [ARDUINO, I2C_BUS, b["address"]]))
    for service, (board, channel, _m) in sorted(SERVO_PLAN.items(), key=lambda kv: (kv[1][0], kv[1][1])):
        calls.append((service, "detach", []))
        calls.append((service, "setPin", [channel]))
        calls.append((service, "attach", [board]))
    return calls
