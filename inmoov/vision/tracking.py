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
