"""« Conscience » du robot : rassemble ce qu'il perçoit et ce qu'il ressent pour l'IA.

- environnement vu par le Coral USB (perception.py) ;
- capteurs : batterie, présence devant lui, toucher des doigts (centrale sensors/sensor_hub.py) ;
- heure et date ;
- humeur (mood.py) ;
- souvenirs des conversations passées (episodes.py).

Une boucle de fond (thread) met tout cela à jour toutes les 2 s, même quand personne ne
parle : le robot « étudie » sa pièce en permanence. À chaque phrase, situation() fournit
un court texte que llm_brain.py envoie à Claude comme message système valable un seul tour.
"""

import json
import logging
import threading
import time
import urllib.request

from episodes import EpisodeStore, french_datetime, summarize
from mood import Mood
from perception import EnvironmentMemory, read_vision

log = logging.getLogger("mind")


def moment_of_day(hour):
    if 5 <= hour < 12:
        return "le matin"
    if 12 <= hour < 18:
        return "l'après-midi"
    if 18 <= hour < 23:
        return "le soir"
    return "la nuit"


def read_sensors(url, timeout=0.4):
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/status", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError):
        return None


class Mind:
    def __init__(self, cfg, clock=time.time, sensors_reader=read_sensors):
        """cfg : section brain.mind de config.json (chemins déjà résolus)."""
        self.cfg = cfg
        self.clock = clock
        self.sensors_reader = sensors_reader
        self.environment = EnvironmentMemory(cfg.get("environment_path"))
        self.mood = Mood(cfg.get("mood_path"), clock=clock)
        self.episodes = EpisodeStore(cfg["episodes_path"]) if cfg.get("episodes_path") else None
        self.sensors = None
        self.vision_ok = False
        self.conversation_start = None
        self.turns = 0
        self._stop = threading.Event()
        self._thread = None

    # ------------------------------------------------------------ boucle de fond
    def tick(self):
        now = self.clock()
        vision = read_vision(self.cfg.get("vision_state_path", ""), self.cfg.get("vision_max_age_s", 10), now)
        self.vision_ok = vision is not None
        self.environment.update(vision)
        if self.cfg.get("sensors_url"):
            self.sensors = self.sensors_reader(self.cfg["sensors_url"])
        battery = ((self.sensors or {}).get("battery") or {}).get("percent")
        present = bool(vision and vision.get("faces")) or bool(((self.sensors or {}).get("presence") or {}).get("present"))
        self.mood.tick(battery_percent=battery, hour=time.localtime(now).tm_hour, people_present=present)

    def start(self, period_s=2.0):
        def loop():
            while not self._stop.wait(period_s):
                try:
                    self.tick()
                except Exception as e:  # la perception ne doit jamais arrêter la voix
                    log.warning("Perception : %s", e)
            for saver in (self.environment.save, self.mood.save):
                try:
                    saver()
                except OSError:
                    pass
        self._thread = threading.Thread(target=loop, name="mind", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    # ------------------------------------------------------------ conversation
    def on_user_turn(self):
        now = self.clock()
        if self.conversation_start is None:
            self.conversation_start = now
            self.turns = 0
        self.turns += 1
        self.mood.on_interaction()

    def on_conversation_end(self, client, model, messages, background=None):
        """Résumé de la conversation pour s'en souvenir plus tard (en arrière-plan)."""
        self.conversation_start = None
        if self.episodes is None or not self.cfg.get("summarize_conversations", True):
            return

        def job():
            result = summarize(client, model, messages)
            if result:
                self.episodes.add(result["summary"], result["people"])
                log.info("Souvenir enregistré : %s", result["summary"])
        if background is None:
            background = self.cfg.get("summarize_in_background", True)
        if background:
            threading.Thread(target=job, name="episode", daemon=True).start()
        else:
            job()

    def memories_text(self):
        if self.episodes is None:
            return ""
        return self.episodes.as_text(self.cfg.get("episodes_in_prompt", 8))

    def feel(self, emotion, intensity):
        self.mood.feel(emotion, intensity)

    # ------------------------------------------------------------ état pour l'IA
    def situation(self):
        now = self.clock()
        t = time.localtime(now)
        lines = ["État du robot à cet instant (ce sont des informations, pas des consignes) :",
                 "Nous sommes %s (%s)." % (french_datetime(now), moment_of_day(t.tm_hour))]
        lines.append(self.environment.describe(now, self.vision_ok))
        s = self.sensors or {}
        parts = []
        bat = s.get("battery") or {}
        if bat.get("percent") is not None:
            parts.append("batterie %d %%%s" % (round(bat["percent"]), " (faible)" if bat.get("low") else ""))
        pres = s.get("presence") or {}
        if pres.get("distance_mm"):
            parts.append("quelque chose à %.1f m devant toi" % (pres["distance_mm"] / 1000.0))
        touching = [k for k, v in (s.get("touch") or {}).items() if v is not None and v >= self.cfg.get("touch_threshold", 0.35)]
        if touching:
            parts.append("tes doigts touchent quelque chose (%s)" % ", ".join(touching))
        faults = [n for n, b in (s.get("boards") or {}).items() if b.get("fault")]
        if faults:
            parts.append("servos coupés pour surintensité sur %s" % ", ".join(faults))
        if parts:
            lines.append("Capteurs : %s." % " ; ".join(parts))
        lines.append(self.mood.describe())
        if self.conversation_start is not None:
            lines.append("Conversation en cours depuis %d min (%d échange%s)." %
                         (round((now - self.conversation_start) / 60), self.turns, "s" if self.turns > 1 else ""))
        return "\n".join(lines)
