"""Visages plus fiables : filtre entre le Coral et le suivi de tête (sans matériel, testable sur PC).

Le Coral donne, image par image, des cadres parfois faux (un poster, un reflet, un motif) ou
qui « clignotent » (visage perdu une image sur trois, cadre qui tremble). Le filtre :
  - écarte les cadres trop petits ou de forme impossible pour un visage ;
  - ne confirme un nouveau visage qu'après confirm_frames images de suite (fini les fausses alertes) ;
  - garde un visage déjà confirmé même si son score baisse un peu (keep_threshold) ou s'il
    disparaît quelques images (keep_frames) : la tête ne part plus au repos pour un clignement ;
  - lisse la position du cadre (smooth) : la tête tremble moins.
"""


def iou(a, b):
    ix0, iy0, ix1, iy1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class FaceFilter:
    def __init__(self, cfg=None, score_threshold=0.6):
        cfg = cfg or {}
        self.score = float(score_threshold)                         # pour un nouveau visage
        self.keep_score = float(cfg.get("keep_threshold", max(0.3, self.score - 0.15)))   # visage déjà suivi
        self.min_size = float(cfg.get("min_size", 0.04))           # hauteur mini, en fraction de l'image
        self.confirm = int(cfg.get("confirm_frames", 2))
        self.keep = int(cfg.get("keep_frames", 3))
        self.smooth = min(max(float(cfg.get("smooth", 0.5)), 0.0), 0.95)
        self.tracks = []    # {"box": [x0, y0, x1, y1], "score", "hits", "misses"}

    @property
    def detect_threshold(self):
        """Seuil à donner au Coral : assez bas pour garder un visage déjà suivi."""
        return min(self.score, self.keep_score)

    def _plausible(self, f, width, height):
        w, h = f[2] - f[0], f[3] - f[1]
        if w <= 0 or h <= 0 or h < self.min_size * height:
            return False
        return 0.45 <= w / float(h) <= 1.8          # un visage est à peu près aussi large que haut

    def update(self, faces, width, height):
        """faces : [(x0, y0, x1, y1, score)] du Coral ; renvoie les visages confirmés, même format."""
        candidates = sorted((f for f in faces if self._plausible(f, width, height)), key=lambda f: -f[4])
        used = set()
        for t in self.tracks:
            best, best_iou = None, 0.25
            for i, f in enumerate(candidates):
                if i in used or f[4] < self.keep_score:
                    continue
                o = iou(t["box"], f)
                if o > best_iou:
                    best, best_iou = i, o
            if best is None:
                t["misses"] += 1
                continue
            used.add(best)
            f = candidates[best]
            a = self.smooth if t["hits"] >= self.confirm else 0.0   # pas de retard pendant la confirmation
            t["box"] = [a * old + (1 - a) * new for old, new in zip(t["box"], f[:4])]
            t["score"], t["hits"], t["misses"] = f[4], t["hits"] + 1, 0
        for i, f in enumerate(candidates):
            if i not in used and f[4] >= self.score:
                self.tracks.append({"box": list(f[:4]), "score": f[4], "hits": 1, "misses": 0})
        # un visage pas encore confirmé disparaît dès qu'il manque ; un visage confirmé tient keep_frames
        self.tracks = [t for t in self.tracks
                       if t["misses"] == 0 or (t["hits"] >= self.confirm and t["misses"] <= self.keep)]
        return [tuple(t["box"]) + (t["score"],) for t in self.tracks if t["hits"] >= self.confirm]
