"""Mémoire de l'environnement : ce que le Coral voit, au fil du temps.

face_tracker.py écrit toutes les secondes un fichier JSON (vision/scene.py) avec les
visages et les objets détectés par le Coral USB. Ce module le lit, retient quand chaque
objet est apparu ou a disparu, et apprend quels objets font « habituellement » partie de
la pièce. Tout reste sur le Pi : aucune image n'est envoyée sur Internet pour cela.
"""

import json
import os
import threading
import time

MAX_EVENTS = 40


def read_vision(path, max_age_s=10.0, now=None):
    """État de la vision écrit par face_tracker.py, ou None s'il manque ou date trop."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        return None
    now = time.time() if now is None else now
    if not isinstance(state, dict) or now - float(state.get("time", 0)) > max_age_s:
        return None
    return state


def ago(seconds):
    s = int(max(0, seconds))
    if s < 90:
        return "à l'instant" if s < 20 else "il y a %d s" % s
    if s < 3600:
        return "il y a %d min" % round(s / 60)
    if s < 86400:
        return "il y a %d h" % round(s / 3600)
    return "il y a %d jours" % round(s / 86400)


def face_distance(face_height):
    """Hauteur du plus grand visage (fraction de l'image) -> distance approximative."""
    if face_height >= 0.35:
        return "tout près"
    if face_height >= 0.15:
        return "à distance de conversation"
    return "assez loin"


class EnvironmentMemory:
    def __init__(self, path=None, gone_after_s=30.0, habitual_min=30, save_every_s=60.0):
        self.path = path
        self.gone_after_s = gone_after_s
        self.habitual_min = habitual_min
        self.save_every_s = save_every_s
        self.lock = threading.Lock()
        self.objects = {}        # label -> {first, last, sightings, visible, count, side}
        self.events = []         # [(time, texte)]
        self.current = None      # dernier état de la vision
        self.last_face_time = None
        self._last_save = 0.0
        self._load()

    # ------------------------------------------------------------ persistance
    def _load(self):
        if not self.path:
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.objects = {k: dict(v, visible=False) for k, v in data.get("objects", {}).items()}
            self.events = [tuple(e) for e in data.get("events", [])][-MAX_EVENTS:]
        except (OSError, ValueError, AttributeError, TypeError):
            pass

    def save(self):
        if not self.path:
            return
        with self.lock:
            data = {"objects": self.objects, "events": self.events}
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    # ------------------------------------------------------------ mise à jour
    def update(self, vision):
        """À appeler régulièrement (toutes les 1 à 2 s) avec read_vision()."""
        if vision is None:
            return
        now = float(vision.get("time", time.time()))
        counts, sides = {}, {}
        for o in vision.get("objects") or []:
            label = o.get("label")
            if not label:
                continue
            counts[label] = counts.get(label, 0) + 1
            sides.setdefault(label, o.get("side", ""))
        with self.lock:
            self.current = vision
            if vision.get("faces"):
                self.last_face_time = now
            for label, n in counts.items():
                o = self.objects.setdefault(label, {"first": now, "last": now, "sightings": 0,
                                                    "visible": False, "count": n, "side": ""})
                if not o["visible"]:
                    self._event(now, "apparition : %s%s (%s)" % (label, " ×%d" % n if n > 1 else "", sides[label]))
                o.update(last=now, visible=True, count=n, side=sides[label])
                o["sightings"] += 1
            for label, o in self.objects.items():
                if o["visible"] and label not in counts and now - o["last"] > self.gone_after_s:
                    o["visible"] = False
                    self._event(now, "disparition : %s" % label)
        if now - self._last_save > self.save_every_s:
            self._last_save = now
            try:
                self.save()
            except OSError:
                pass

    def _event(self, t, text):
        self.events.append((t, text))
        del self.events[:-MAX_EVENTS]

    # ------------------------------------------------------------ description
    def describe(self, now=None, vision_ok=True):
        now = time.time() if now is None else now
        with self.lock:
            cur = self.current
            lines = []
            if not vision_ok or cur is None:
                lines.append("Vision (Coral) : indisponible pour le moment (suivi de visage arrêté ?).")
            else:
                visible = [(label, o) for label, o in self.objects.items() if o["visible"]]
                visible.sort(key=lambda kv: -kv[1]["count"])
                seen = ", ".join("%s%s %s" % (label, " ×%d" % o["count"] if o["count"] > 1 else "", o["side"])
                                 for label, o in visible) or "rien de reconnaissable"
                lines.append("Ce que tu vois en ce moment (Coral) : %s." % seen)
                faces = int(cur.get("faces") or 0)
                if faces:
                    lines.append("Visage(s) détecté(s) : %d, le plus proche %s." %
                                 (faces, face_distance(float(cur.get("face_height") or 0))))
                elif self.last_face_time:
                    lines.append("Aucun visage en face de toi (dernier visage vu %s)." % ago(now - self.last_face_time))
                else:
                    lines.append("Aucun visage en face de toi.")
            recent = [(t, e) for t, e in self.events if now - t < 1800][-5:]
            if recent:
                lines.append("Changements récents : " + " ; ".join("%s, %s" % (ago(now - t), e) for t, e in recent) + ".")
            habitual = sorted((label for label, o in self.objects.items()
                               if o["sightings"] >= self.habitual_min and label != "personne"),
                              key=lambda label: -self.objects[label]["sightings"])[:8]
            if habitual:
                lines.append("Objets habituels de la pièce : %s." % ", ".join(habitual))
        return "\n".join(lines)
