"""Conversion des points du corps (MediaPipe) en consignes de servos InMoov2.

Toutes les consignes sont des valeurs d'ENTRÉE InMoov2 (0 à 180) : MyRobotLab les
convertit ensuite entre les butées min/max calibrées de chaque servo, donc le
robot ne peut pas dépasser sa calibration.

Main (MediaPipe Hands, 21 points) : 0 poignet ; pouce 1-4 ; index 5-8 ; majeur 9-12 ;
annulaire 13-16 ; auriculaire 17-20. Chez InMoov2, 0 = doigt ouvert, 180 = fermé
(pouce 130), comme InMoov2Hand.close().

Bras (MediaPipe Pose, points « monde » en mètres) : épaules 11/12, coudes 13/14,
poignets 15/16, hanches 23/24 (gauche/droite de la personne).
"""

import math

FINGER_POINTS = {
    # doigt : (base, articulation, bout) ; l'angle mesuré est la flexion au milieu
    "thumb": (1, 2, 4),
    "index": (5, 6, 8),
    "majeure": (9, 10, 12),
    "ringFinger": (13, 14, 16),
    "pinky": (17, 18, 20),
}
FINGER_MAX_BEND = {"thumb": 70.0, "index": 150.0, "majeure": 150.0, "ringFinger": 150.0, "pinky": 150.0}
FINGER_CLOSED_INPUT = {"thumb": 130.0, "index": 180.0, "majeure": 180.0, "ringFinger": 180.0, "pinky": 180.0}

POSE = {"left": {"shoulder": 11, "elbow": 13, "wrist": 15, "hip": 23, "other_shoulder": 12},
        "right": {"shoulder": 12, "elbow": 14, "wrist": 16, "hip": 24, "other_shoulder": 11}}


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    n = math.sqrt(_dot(a, a))
    if n < 1e-9:
        raise ValueError("vecteur nul")
    return (a[0] / n, a[1] / n, a[2] / n)


def _angle(u, v):
    """Angle en degrés entre deux vecteurs."""
    c = _dot(_norm(u), _norm(v))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _clamp(x, lo=0.0, hi=180.0):
    return max(lo, min(hi, x))


def finger_curls(points):
    """points : 21 tuples (x, y, z). Renvoie {doigt: entrée InMoov2 0..180}."""
    out = {}
    for finger, (a, b, c) in FINGER_POINTS.items():
        bend = _angle(_sub(points[b], points[a]), _sub(points[c], points[b]))  # 0 = tendu
        curl = _clamp(bend / FINGER_MAX_BEND[finger], 0.0, 1.0)
        out[finger] = round(curl * FINGER_CLOSED_INPUT[finger], 1)
    return out


def arm_angles(world, side):
    """world : points « monde » de la pose. Renvoie les angles (degrés) du bras `side`
    de la personne : flexion du coude, élévation vers l'avant, élévation sur le côté."""
    p = POSE[side]
    sh, el, wr = world[p["shoulder"]], world[p["elbow"]], world[p["wrist"]]
    down = _norm(_sub(world[p["hip"]], sh))                  # du haut vers le bas du torse
    lateral = _norm(_sub(sh, world[p["other_shoulder"]]))    # vers l'extérieur de ce côté
    # axe avant = perpendiculaire au torse, orienté vers la caméra (z négatif chez MediaPipe)
    forward = _norm(_cross(lateral, down))
    if forward[2] > 0:
        forward = (-forward[0], -forward[1], -forward[2])
    arm = _sub(el, sh)
    elbow = 180.0 - _angle(_sub(sh, el), _sub(wr, el))      # 0 = bras tendu
    # élévation totale du bras (0 = le long du corps, 180 = vers le haut), puis
    # direction de cette élévation : 0° = sur le côté, 90° = vers l'avant
    elevation = _angle(arm, down)
    direction = math.atan2(_dot(arm, forward), abs(_dot(arm, lateral)))
    flexion = elevation * max(0.0, math.sin(direction))
    abduction = elevation * math.cos(direction)
    return {"elbow": elbow, "flexion": flexion, "abduction": abduction}


def arm_targets(angles, cfg=None):
    """Angles de la personne -> entrées InMoov2 du bras (bicep, shoulder, omoplate)."""
    cfg = cfg or {}
    return {
        "bicep": round(_clamp(angles["elbow"] / cfg.get("elbow_max", 130.0) * 180.0), 1),
        "shoulder": round(_clamp(angles["flexion"]), 1),
        "omoplate": round(_clamp(angles["abduction"] / cfg.get("abduction_max", 90.0) * 180.0), 1),
    }


def robot_side(person_side, mirror=True):
    """En mode miroir, le bras droit de la personne pilote le bras gauche du robot."""
    if not mirror:
        return person_side
    return "left" if person_side == "right" else "right"


class Smoother:
    """Lissage + zone morte + vitesse maximale, pour chaque servo."""

    def __init__(self, alpha=0.35, deadband=2.0, max_speed=90.0):
        self.alpha = alpha
        self.deadband = deadband
        self.max_speed = max_speed  # unités d'entrée InMoov2 par seconde
        self.value = {}
        self.sent = {}

    def update(self, key, target, dt):
        """Renvoie la nouvelle consigne à envoyer, ou None si inutile."""
        prev = self.value.get(key, target)
        smoothed = prev + self.alpha * (target - prev)
        step = self.max_speed * max(dt, 1e-3)
        smoothed = max(prev - step, min(prev + step, smoothed))
        self.value[key] = smoothed
        last = self.sent.get(key)
        if last is not None and abs(smoothed - last) < self.deadband:
            return None
        self.sent[key] = round(smoothed, 1)
        return self.sent[key]
