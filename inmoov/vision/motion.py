"""Détection de mouvement (différence entre deux images), pour les 2 caméras.

Léger : travaille sur une petite image en niveaux de gris (160 × 120). Pour éviter les fausses alertes :
  - luminosité recalée entre les deux images (réglage automatique de la caméra, nuage, lampe tamisée) ;
  - changement de lumière d'un coup sur presque toute l'image (lampe allumée) : signalé « light », pas
    compté comme mouvement ;
  - petits points isolés (bruit de la caméra, la nuit) effacés avant de compter ;
  - zones ignorées (écran de télé, fenêtre, rideau) : ignore_zones = [[x0, y0, x1, y1], …] en fraction ;
  - les morceaux d'une même personne (tête, bras, jambes) sont regroupés en un seul cadre.
"""

import cv2
import numpy as np


def merge_boxes(boxes, gap=0.04):
    """Regroupe les cadres qui se touchent ou presque (gap en fraction de l'image)."""
    boxes = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if a[0] - gap <= b[2] and b[0] - gap <= a[2] and a[1] - gap <= b[3] and b[1] - gap <= a[3]:
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    return boxes


class MotionDetector:
    def __init__(self, threshold=25, min_area=0.004, size=(160, 120), ignore_zones=None, light_change=0.5):
        self.threshold = threshold      # écart de luminosité pour compter un pixel comme « bougé »
        self.min_area = min_area        # zone minimum (fraction de l'image) pour un cadre
        self.light_change = light_change   # au-delà de cette part de l'image : changement de lumière
        self.size = size
        self.previous = None
        w, h = size
        self.mask = np.full((h, w), 255, dtype=np.uint8)
        for z in ignore_zones or []:
            x0, y0, x1, y1 = (int(round(v * s)) for v, s in zip(z, (w, h, w, h)))
            self.mask[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = 0
        self.watched = max(1, cv2.countNonZero(self.mask))

    def update(self, frame_bgr):
        """Renvoie {"level": fraction de l'image qui bouge, "boxes": [[x0, y0, x1, y1] en fraction],
        "light": True si la lumière a changé d'un coup (rien n'est alors compté comme mouvement)}."""
        small = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(frame_bgr, self.size), cv2.COLOR_BGR2GRAY), (5, 5), 0)
        previous, self.previous = self.previous, small
        if previous is None:
            return {"level": 0.0, "boxes": [], "light": False}
        w, h = self.size
        watched = self.mask > 0
        delta = small.astype(np.int16) - previous.astype(np.int16)
        # lampe allumée / éteinte : presque toute l'image change d'un coup (pas un mouvement)
        if np.count_nonzero(np.abs(delta)[watched] > self.threshold) >= self.light_change * self.watched:
            return {"level": 0.0, "boxes": [], "light": True}
        # même luminosité pour les deux images (la caméra règle seule son exposition) ; la médiane
        # n'est pas faussée par une personne qui entre dans l'image
        shift = int(np.median(delta[watched]))
        diff = (np.abs(delta - shift) > self.threshold).astype(np.uint8) * 255
        diff = cv2.bitwise_and(diff, self.mask)
        diff = cv2.morphologyEx(diff, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))   # efface le bruit
        diff = cv2.bitwise_and(cv2.dilate(diff, None, iterations=2), self.mask)
        level = float(cv2.countNonZero(diff)) / self.watched
        contours = cv2.findContours(diff, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
        boxes = []
        for c in contours:
            x, y, bw, bh = cv2.boundingRect(c)
            if bw * bh >= self.min_area * w * h:
                boxes.append([x / w, y / h, (x + bw) / w, (y + bh) / h])
        boxes = [[round(v, 3) for v in b] for b in merge_boxes(boxes)]
        boxes.sort(key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
        return {"level": round(level, 3), "boxes": boxes[:6], "light": False}
