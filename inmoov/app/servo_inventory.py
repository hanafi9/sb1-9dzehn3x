"""Inventaire des servos InMoov2 (MyRobotLab Nixie).

Valeurs par défaut recopiées des classes de configuration de MyRobotLab
(InMoov2HeadConfig, InMoov2ArmConfig, InMoov2HandConfig, InMoov2TorsoConfig) :
broche, carte (i01.left / i01.right), limites de sortie, repos, vitesse.

Dans InMoov2, une commande moveTo() reçoit une valeur d'ENTRÉE de 0 à 180 qui est
convertie en angle de SORTIE entre min_out et max_out (les vraies butées du servo).
Calibrer un servo = régler min_out / max_out pour qu'il ne force jamais.
"""

import copy


def _s(key, label, pin, board, min_out, max_out, rest, speed=None):
    return {
        "key": key, "label": label, "pin": pin, "board": board,
        "min_out": float(min_out), "max_out": float(max_out),
        "rest": float(rest), "speed": speed, "inverted": False,
    }


def _hand(side):
    board = "i01.%s" % side
    return [
        _s("thumb", "Pouce", 2, board, 0, 180, 0, 45),
        _s("index", "Index", 3, board, 0, 180, 0, 45),
        _s("majeure", "Majeur", 4, board, 0, 180, 0, 45),
        _s("ringFinger", "Annulaire", 5, board, 0, 180, 0, 45),
        _s("pinky", "Auriculaire", 6, board, 0, 180, 0, 45),
        _s("wrist", "Poignet", 7, board, 0, 180, 0, 45),
    ]


def _arm(side):
    board = "i01.%s" % side
    return [
        _s("bicep", "Biceps", 8, board, 0, 90, 0),
        _s("rotate", "Rotation du bras", 9, board, 40, 180, 90),
        _s("shoulder", "Épaule", 10, board, 0, 180, 30),
        _s("omoplate", "Omoplate", 11, board, 10, 80, 10),
    ]


GROUPS = [
    {
        "key": "head", "label": "Tête et cou", "service": "i01.head",
        "servos": [
            _s("rothead", "Rotation de la tête (gauche/droite)", 13, "i01.left", 30, 150, 90, 45),
            _s("neck", "Cou (haut/bas)", 12, "i01.left", 20, 160, 90, 45),
            _s("rollNeck", "Inclinaison du cou", 12, "i01.right", 20, 160, 90, 45),
            _s("jaw", "Mâchoire", 26, "i01.left", 10, 25, 10, 500),
            _s("eyeX", "Yeux gauche/droite", 22, "i01.left", 60, 120, 90),
            _s("eyeY", "Yeux haut/bas", 24, "i01.left", 60, 120, 90),
            _s("eyelidLeft", "Paupière gauche", 24, "i01.right", 0, 180, 0, 50),
            _s("eyelidRight", "Paupière droite", 22, "i01.right", 0, 180, 0, 50),
        ],
    },
    {
        "key": "torso", "label": "Torse", "service": "i01.torso",
        "servos": [
            _s("topStom", "Ventre haut", 27, "i01.left", 60, 120, 90, 20),
            _s("midStom", "Ventre milieu", 28, "i01.left", 60, 120, 90, 20),
            _s("lowStom", "Ventre bas", 29, "i01.left", 0, 180, 90, 20),
        ],
    },
    {"key": "leftArm", "label": "Bras gauche", "service": "i01.leftArm", "servos": _arm("left")},
    {"key": "rightArm", "label": "Bras droit", "service": "i01.rightArm", "servos": _arm("right")},
    {"key": "leftHand", "label": "Main gauche", "service": "i01.leftHand", "servos": _hand("left")},
    {"key": "rightHand", "label": "Main droite", "service": "i01.rightHand", "servos": _hand("right")},
]

CALIBRATION_FIELDS = ("min_out", "max_out", "rest", "speed", "inverted")


def default_calibration():
    """{ nom complet du service : réglages } pour tous les servos."""
    cal = {}
    for g in GROUPS:
        for s in g["servos"]:
            cal["%s.%s" % (g["service"], s["key"])] = {k: s[k] for k in CALIBRATION_FIELDS}
    return cal


def all_services():
    return set(default_calibration())


def groups_with(calibration):
    """Groupes enrichis du nom de service et de la calibration enregistrée."""
    out = copy.deepcopy(GROUPS)
    for g in out:
        for s in g["servos"]:
            s["service"] = "%s.%s" % (g["service"], s["key"])
            s.update(calibration.get(s["service"], {}))
    return out


def validate_calibration(values):
    """Vérifie et normalise une calibration envoyée par l'interface."""
    try:
        min_out = float(values["min_out"])
        max_out = float(values["max_out"])
        rest = float(values["rest"])
        speed = values.get("speed")
        speed = None if speed in (None, "", 0) else float(speed)
        inverted = bool(values.get("inverted", False))
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError("valeur manquante ou invalide : %s" % e)
    if not 0 <= min_out < max_out <= 180:
        raise ValueError("il faut 0 ≤ min < max ≤ 180")
    if not 0 <= rest <= 180:
        raise ValueError("le repos doit être entre 0 et 180")
    if speed is not None and not 1 <= speed <= 1000:
        raise ValueError("la vitesse doit être entre 1 et 1000 °/s")
    return {"min_out": min_out, "max_out": max_out, "rest": rest, "speed": speed, "inverted": inverted}
