"""Pont entre la voix de Kamil et l'onglet « Kamil » de l'Atelier (et Home Assistant).

Kamil écrit son état et la conversation dans un petit fichier en mémoire
(/dev/shm/inmoov_kamil.json), que l'Atelier lit chaque seconde ; l'Atelier dépose ses demandes
(« dis… », question écrite, mode garde) dans /dev/shm/inmoov_kamil_cmd/, que Kamil lit entre deux
phrases. Même interface que ha_mqtt.KamilMQTT : Bridges les regroupe, la boucle d'écoute ne voit
qu'un seul objet.
"""

import json
import logging
import os
import queue
import time

log = logging.getLogger("bridge")

DEFAULTS = {
    "state_path": "/dev/shm/inmoov_kamil.json",
    "commands_dir": "/dev/shm/inmoov_kamil_cmd",
    "history": 40,
}
COMMANDS = ("dire", "question", "garde")


class LocalBridge:
    def __init__(self, cfg=None, clock=time.time):
        self.cfg = dict(DEFAULTS)
        self.cfg.update(cfg or {})
        self.clock = clock
        self.commands = queue.Queue()
        self.guard_state = None
        self.data = {"etat": "idle", "history": [], "started": clock()}
        self.last_poll = 0.0
        self.last_write = 0.0

    # ------------------------------------------------------------ état
    def _write(self):
        self.data["updated"] = self.last_write = self.clock()
        if self.guard_state is not None:
            self.data["garde"] = bool(self.guard_state())
        path = self.cfg["state_path"]
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False)
            os.replace(tmp, path)       # l'Atelier ne lit jamais un fichier à moitié écrit
        except OSError as e:
            log.debug("état non écrit : %s", e)

    def state(self, state):
        if self.data.get("etat") != state:
            self.data["etat"] = state
            self._write()

    def publish(self, key, value):
        value = str(value)
        self.data[key] = value
        if key in ("entendu", "reponse") and value.strip():
            # la conversation, en bulles : toi / Kamil
            self.data["history"].append({"t": round(self.clock(), 1), "qui": "toi" if key == "entendu" else "kamil",
                                         "texte": value[:600]})
            self.data["history"] = self.data["history"][-self.cfg["history"]:]
        self._write()

    def guard(self, on):
        self.data["garde"] = bool(on)
        self._write()

    # ------------------------------------------------------------ demandes de l'Atelier
    def poll(self):
        now = self.clock()
        if now - self.last_poll < 0.4:
            return
        self.last_poll = now
        if now - self.last_write > 5:
            self._write()               # « je suis en vie » pour l'Atelier
        folder = self.cfg["commands_dir"]
        try:
            names = sorted(n for n in os.listdir(folder) if n.endswith(".json"))
        except OSError:
            return
        for name in names:
            path = os.path.join(folder, name)
            try:
                with open(path, encoding="utf-8") as f:
                    cmd = json.load(f)
                os.remove(path)
            except (OSError, ValueError):
                continue
            if cmd.get("kind") in COMMANDS and now - float(cmd.get("t", 0)) < 120:   # pas de vieux ordres
                self.commands.put((cmd["kind"], cmd.get("value")))


def send_command(kind, value, commands_dir=DEFAULTS["commands_dir"], clock=time.time):
    """Côté Atelier : dépose une demande pour Kamil."""
    if kind not in COMMANDS:
        raise ValueError("demande inconnue")
    os.makedirs(commands_dir, exist_ok=True)
    t = clock()
    name = "%.6f-%s.json" % (t, kind)
    tmp = os.path.join(commands_dir, "." + name)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"kind": kind, "value": value, "t": t}, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(commands_dir, name))


class Bridges:
    """Plusieurs ponts (Atelier, Home Assistant) vus comme un seul ; une seule file de demandes."""

    def __init__(self):
        self.items = []
        self.commands = queue.Queue()

    def add(self, bridge):
        bridge.commands = self.commands
        self.items.append(bridge)
        return bridge

    def set_guard_state(self, fn):
        for b in self.items:
            b.guard_state = fn

    def state(self, state):
        for b in self.items:
            b.state(state)

    def publish(self, key, value):
        for b in self.items:
            b.publish(key, value)

    def guard(self, on):
        for b in self.items:
            b.guard(on)

    def poll(self):
        for b in self.items:
            if hasattr(b, "poll"):
                b.poll()
