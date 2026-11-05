"""Humeur du robot : un petit état intérieur qui évolue et colore ses réponses.

Trois grandeurs, qui reviennent lentement vers leur valeur de base :
- énergie (0 à 1) : baisse la nuit et quand la batterie est faible ;
- joie (-1 à 1) : monte avec les échanges agréables, baisse s'il reste seul longtemps ;
- curiosité (0 à 1) : monte avec les nouveautés et l'ennui.
L'IA peut aussi exprimer une émotion avec l'outil « feel », qui modifie cet état.
Ce n'est pas une vraie émotion : c'est un modèle simple et prévisible, réglable dans config.json.
"""

import json
import math
import os
import threading
import time

BASE = {"energie": 0.75, "joie": 0.5, "curiosite": 0.6}   # d'un naturel joyeux et curieux
LIMITS = {"energie": (0.0, 1.0), "joie": (-1.0, 1.0), "curiosite": (0.0, 1.0)}
EMOTIONS = {
    # émotion -> effet par point d'intensité
    "joie": {"joie": 0.4},
    "tristesse": {"joie": -0.4},
    "surprise": {"curiosite": 0.3, "energie": 0.1},
    "curiosite": {"curiosite": 0.4},
    "fatigue": {"energie": -0.3},
    "fierte": {"joie": 0.3, "energie": 0.1},
    "gene": {"joie": -0.2},
    "amusement": {"joie": 0.3, "curiosite": 0.1},
}
EMOTION_FR = {"joie": "joie", "tristesse": "tristesse", "surprise": "surprise", "curiosite": "curiosité",
              "fatigue": "fatigue", "fierte": "fierté", "gene": "gêne", "amusement": "amusement"}


class Mood:
    def __init__(self, path=None, half_life_s=1800.0, clock=time.time):
        self.path = path
        self.half_life_s = half_life_s
        self.clock = clock
        self.lock = threading.Lock()
        self.state = dict(BASE)
        self.last_update = clock()
        self.last_interaction = None
        self.last_emotion = None   # (nom, intensité, heure)
        self._load()

    def _load(self):
        if not self.path:
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for k in BASE:
                if k in data.get("state", {}):
                    self.state[k] = _clip(k, float(data["state"][k]))
            self.last_interaction = data.get("last_interaction")
        except (OSError, ValueError, AttributeError, TypeError):
            pass

    def save(self):
        if not self.path:
            return
        with self.lock:
            data = {"state": self.state, "last_interaction": self.last_interaction}
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
        os.replace(tmp, self.path)

    def tick(self, battery_percent=None, hour=None, people_present=False):
        """Évolution lente vers une cible qui dépend de la situation."""
        now = self.clock()
        with self.lock:
            dt = max(0.0, now - self.last_update)
            self.last_update = now
            target = dict(BASE)
            if hour is not None and (hour >= 23 or hour < 7):
                target["energie"] = 0.35
            if battery_percent is not None and battery_percent < 20:
                target["energie"] = min(target["energie"], 0.2)
            alone = (self.last_interaction is None or now - self.last_interaction > 3600) and not people_present
            if alone:
                target["joie"] = 0.0
                target["curiosite"] = 0.7
            k = 1.0 - math.exp(-dt * math.log(2) / self.half_life_s)
            for key in self.state:
                self.state[key] = _clip(key, self.state[key] + (target[key] - self.state[key]) * k)

    def on_interaction(self):
        with self.lock:
            self.last_interaction = self.clock()
            self.state["joie"] = _clip("joie", self.state["joie"] + 0.03)
            self.state["curiosite"] = _clip("curiosite", self.state["curiosite"] + 0.03)

    def feel(self, emotion, intensity):
        if emotion not in EMOTIONS:
            raise ValueError("émotion inconnue : %s" % emotion)
        intensity = max(0.0, min(1.0, float(intensity)))
        with self.lock:
            for key, delta in EMOTIONS[emotion].items():
                self.state[key] = _clip(key, self.state[key] + delta * intensity)
            self.last_emotion = (emotion, intensity, self.clock())
        try:
            self.save()
        except OSError:
            pass

    def describe(self):
        with self.lock:
            e, j, c = self.state["energie"], self.state["joie"], self.state["curiosite"]
            last = self.last_emotion
            now = self.clock()
        words = [
            "plein d'énergie" if e > 0.75 else "en forme" if e > 0.5 else "un peu fatigué" if e > 0.3 else "fatigué",
            "très joyeux" if j > 0.6 else "de bonne humeur" if j > 0.2 else "neutre" if j > -0.2 else "un peu triste",
            "très curieux" if c > 0.75 else "curieux" if c > 0.45 else "calme",
        ]
        text = "Ton humeur actuelle : %s." % ", ".join(words)
        if last and now - last[2] < 600:
            text += " Émotion ressentie récemment : %s." % EMOTION_FR[last[0]]
        return text


def _clip(key, value):
    lo, hi = LIMITS[key]
    return max(lo, min(hi, value))
