"""Logique de suivi (sans matériel) : facile à tester sur n'importe quel PC."""


class AxisController:
    """Asservissement proportionnel d'un servo (rothead = pan, neck = tilt).

    error : position du visage dans l'image, de -1 (bord gauche/haut)
            à +1 (bord droit/bas), 0 = centre.
    """

    def __init__(self, cfg):
        self.min = float(cfg["min"])
        self.max = float(cfg["max"])
        self.rest = float(cfg["rest"])
        self.gain = float(cfg["gain"])
        self.deadband = float(cfg["deadband"])
        self.max_step = float(cfg["max_step"])
        self.sign = -1.0 if cfg.get("invert") else 1.0
        self.position = self.rest

    def update(self, error):
        if abs(error) < self.deadband:
            return self.position
        step = self.sign * self.gain * error
        step = max(-self.max_step, min(self.max_step, step))
        self.position = max(self.min, min(self.max, self.position + step))
        return self.position

    def toward_rest(self):
        """Revient doucement vers la position de repos."""
        delta = self.rest - self.position
        delta = max(-self.max_step / 2, min(self.max_step / 2, delta))
        self.position += delta
        return self.position


def pick_target(faces):
    """Choisit le visage le plus grand (donc le plus proche).

    faces : liste de (xmin, ymin, xmax, ymax, score) en pixels.
    """
    if not faces:
        return None
    return max(faces, key=lambda f: (f[2] - f[0]) * (f[3] - f[1]))


def normalized_error(face, width, height):
    """Écart du centre du visage par rapport au centre de l'image, dans [-1, 1]."""
    cx = (face[0] + face[2]) / 2.0
    cy = (face[1] + face[3]) / 2.0
    return (cx - width / 2.0) / (width / 2.0), (cy - height / 2.0) / (height / 2.0)


def person_head_target(objects, person_ids, min_score=0.5):
    """Quand aucun visage n'est vu (personne de profil, de dos, tête baissée) :
    vise la tête de la personne la plus grande détectée par le modèle d'objets.

    objects : [(id, score, xmin, ymin, xmax, ymax)] ; renvoie un « visage » (x0, y0, x1, y1, score)
    placé sur le haut de la silhouette, ou None.
    """
    people = [o for o in objects if o[0] in person_ids and o[1] >= min_score]
    if not people:
        return None
    _, score, x0, y0, x1, y1 = max(people, key=lambda o: (o[4] - o[2]) * (o[5] - o[3]))
    w, h = x1 - x0, y1 - y0
    return (x0 + 0.3 * w, y0, x1 - 0.3 * w, y0 + 0.2 * h, score)
