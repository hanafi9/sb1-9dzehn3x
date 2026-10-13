"""Gestes appris par démonstration : enregistrement et lecture.

Un geste = suite de consignes datées {"t": secondes, "service": ..., "pos": 0..180},
enregistrée en imitant la personne (vision/mirror.py --record nom), puis rejouée
depuis l'Atelier ou par l'IA (« InMoov, fais le geste salut »).
"""

import json
import os
import re
import threading
import time

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# seuls les servos du haut du corps peuvent être rejoués (jamais les jambes)
SERVICE_RE = re.compile(r"^i01\.(head|torso|leftArm|rightArm|leftHand|rightHand)\.[A-Za-z]+$")


def allowed_service(service):
    return bool(SERVICE_RE.match(service))


def check_name(name):
    if not NAME_RE.match(name or ""):
        raise ValueError("nom de geste : lettres, chiffres, _ ou -, 40 caractères maximum")
    return name


def list_gestures(directory):
    if not os.path.isdir(directory):
        return []
    return sorted(f[:-5] for f in os.listdir(directory) if f.endswith(".json") and NAME_RE.match(f[:-5]))


def load(directory, name):
    with open(os.path.join(directory, check_name(name) + ".json"), "r", encoding="utf-8") as f:
        data = json.load(f)
    steps = data["steps"]
    for s in steps:
        if not (isinstance(s["t"], (int, float)) and isinstance(s["service"], str) and 0 <= float(s["pos"]) <= 180):
            raise ValueError("geste invalide")
    return data


def save(directory, name, steps, note=""):
    os.makedirs(directory, exist_ok=True)
    data = {"name": check_name(name), "note": note, "created": int(time.time()), "steps": steps}
    path = os.path.join(directory, name + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return path


def delete(directory, name):
    os.remove(os.path.join(directory, check_name(name) + ".json"))


def play(send, data, speed=1.0, allowed=None, sleep=time.sleep, stop_event=None):
    """Rejoue un geste. send(service, pos) envoie une consigne.
    allowed : services autorisés (les autres sont ignorés, par sécurité)."""
    t_prev = 0.0
    count = 0
    for step in sorted(data["steps"], key=lambda s: s["t"]):
        if stop_event is not None and stop_event.is_set():
            break
        if not allowed_service(step["service"]) or (allowed is not None and step["service"] not in allowed):
            continue
        wait = (step["t"] - t_prev) / max(speed, 0.1)
        if wait > 0:
            sleep(wait)
        t_prev = step["t"]
        send(step["service"], float(step["pos"]))
        count += 1
    return count


def play_async(send, data, **kw):
    t = threading.Thread(target=play, args=(send, data), kwargs=kw, daemon=True)
    t.start()
    return t
