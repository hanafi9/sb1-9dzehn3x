"""Détection de mouvement (différence entre deux images), pour les 2 caméras.

Léger : travaille sur une petite image en niveaux de gris (160 × 120).
"""

import cv2


class MotionDetector:
    def __init__(self, threshold=25, min_area=0.004, size=(160, 120)):
        self.threshold = threshold      # écart de luminosité pour compter un pixel comme « bougé »
        self.min_area = min_area        # zone minimum (fraction de l'image) pour un cadre
        self.size = size
        self.previous = None

    def update(self, frame_bgr):
        """Renvoie {"level": fraction de l'image qui bouge, "boxes": [[x0, y0, x1, y1] en fraction]}."""
        small = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(frame_bgr, self.size), cv2.COLOR_BGR2GRAY), (5, 5), 0)
        previous, self.previous = self.previous, small
        if previous is None:
            return {"level": 0.0, "boxes": []}
        diff = cv2.threshold(cv2.absdiff(previous, small), self.threshold, 255, cv2.THRESH_BINARY)[1]
        diff = cv2.dilate(diff, None, iterations=2)
        w, h = self.size
        level = float(cv2.countNonZero(diff)) / (w * h)
        contours = cv2.findContours(diff, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
        boxes = []
        for c in contours:
            x, y, bw, bh = cv2.boundingRect(c)
            if bw * bh >= self.min_area * w * h:
                boxes.append([round(x / w, 3), round(y / h, 3), round((x + bw) / w, 3), round((y + bh) / h, 3)])
        boxes.sort(key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))
        return {"level": round(level, 3), "boxes": boxes[:6]}
