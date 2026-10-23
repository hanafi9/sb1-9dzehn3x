"""Réactions spontanées : le robot remarque ce que voient ses caméras et en parle de lui-même.

face_tracker.py écrit toutes les ~0,5 s ce que voit le Coral (visages, objets). Ce module
surveille ces images et détecte quelques « événements » :

- arrivee   : quelqu'un apparaît devant le robot après une absence ;
- proche    : quelqu'un s'approche tout près de son visage ;
- attente   : quelqu'un reste devant lui sans rien dire ;
- objet     : un objet inhabituel apparaît pendant que quelqu'un est là ;
- depart    : la personne avec qui il vient de parler s'en va.

Chaque événement est décrit en une phrase et envoyé à Claude, qui choisit quoi dire
(salut, prénom s'il le connaît par ses souvenirs, remarque sur l'objet…).
Des délais minimum évitent qu'il parle trop : il ne doit pas devenir envahissant.
"""

import logging
import time

from perception import face_distance, read_vision

log = logging.getLogger("reactions")

DEFAULTS = {
    "enabled": True,
    "events": ["arrivee", "proche", "attente", "objet", "depart"],
    "poll_s": 1.0,
    "presence_confirm_s": 1.5,      # visage vu au moins ce temps avant de parler d'« arrivée »
    "absence_before_greet_s": 60,   # absence minimum pour saluer à nouveau
    "gone_after_s": 15,             # plus de visage depuis ce temps = la personne est partie
    "close_face_height": 0.40,      # visage plus grand que 40 % de l'image = tout près
    "linger_s": 45,                 # présence silencieuse avant de lancer la conversation
    "object_min_score": 0.6,
    "ignored_objects": ["personne", "chaise", "table", "lit", "canapé", "plante en pot"],
    "quiet_after_talk_s": 20,       # pas de réaction juste après une conversation
    "cooldown_s": {"arrivee": 120, "proche": 300, "attente": 600, "objet": 600, "depart": 300},
    "max_per_hour": 15,
    "quiet_hours": [22, 7],         # [début, fin] : pas de réaction la nuit ; [] = jamais silencieux
}


class Reactions:
    def __init__(self, cfg, vision_state_path, environment=None, clock=time.time):
        """cfg : section brain.reactions ; environment : EnvironmentMemory (objets habituels)."""
        self.cfg = dict(DEFAULTS)
        self.cfg.update(cfg or {})
        self.cfg["cooldown_s"] = dict(DEFAULTS["cooldown_s"], **(cfg or {}).get("cooldown_s", {}))
        self.path = vision_state_path
        self.environment = environment
        self.clock = clock
        self.last_poll = 0.0
        self.face_since = None          # début de la présence actuelle
        self.last_face = None           # dernière fois qu'un visage a été vu
        self.present = False            # présence confirmée
        self.greeted = False            # arrivée déjà signalée pour cette présence
        self.lingered = False
        self.close_since = None
        self.seen_objects = set()       # objets visibles à l'image précédente
        self.last_event = {}            # type -> heure
        self.history = []               # heures des réactions (limite par heure)
        self.last_talk = None           # dernière conversation (fournie par l'appelant)
        self.absence = None             # durée sans personne avant la présence actuelle
        self.talked_with_present = False

    # ------------------------------------------------------------ appelé par la voix
    def on_conversation(self):
        """À appeler à chaque phrase échangée avec quelqu'un."""
        self.last_talk = self.clock()
        if self.present:
            self.talked_with_present = True
            self.greeted = True          # on parle déjà : inutile de saluer
            self.lingered = True

    def poll(self):
        """Renvoie (type, description) d'un événement à signaler, ou None."""
        now = self.clock()
        if now - self.last_poll < self.cfg["poll_s"]:
            return None
        self.last_poll = now
        vision = read_vision(self.path, max_age_s=5, now=now)
        if vision is None:
            return None
        event = self._detect(vision, now)
        if event is None or not self._allowed(event[0], now, vision):
            return None
        self.last_event[event[0]] = now
        self.history = [t for t in self.history if now - t < 3600] + [now]
        log.info("Événement vu par les caméras : %s", event[1])
        return event

    # ------------------------------------------------------------ détection
    def _detect(self, vision, now):
        faces = int(vision.get("faces") or 0)
        height = float(vision.get("face_height") or 0)
        objects = {o["label"]: o for o in vision.get("objects") or []
                   if o.get("score", 0) >= self.cfg["object_min_score"]}
        new_objects = [o for label, o in objects.items() if label not in self.seen_objects]
        self.seen_objects = set(objects)

        if faces:
            absent_for = None if self.last_face is None else now - self.last_face
            if self.face_since is None or (absent_for is not None and absent_for > self.cfg["gone_after_s"]):
                # nouvelle présence : on note depuis quand la pièce était vide
                self.absence = absent_for
                self.face_since, self.present, self.greeted, self.lingered = now, False, False, False
                self.talked_with_present = False
            self.last_face = now
            if not self.present and now - self.face_since >= self.cfg["presence_confirm_s"]:
                self.present = True
            if not self.present:
                return None
            who = "une personne" if faces == 1 else "%d personnes" % faces
            where = face_distance(height)
            if not self.greeted:
                self.greeted = True
                long_absence = self.absence is None or self.absence >= self.cfg["absence_before_greet_s"]
                if long_absence:
                    since = "" if self.absence is None else " (personne depuis %d min)" % round(self.absence / 60)
                    return ("arrivee", "%s vient d'apparaître devant toi, %s%s." % (who.capitalize(), where, since))
            self.close_since = (self.close_since or now) if height >= self.cfg["close_face_height"] else None
            if self.close_since is not None and now - self.close_since >= 2:
                self.close_since = None
                return ("proche", "Quelqu'un approche son visage tout près de tes yeux.")
            quiet = self.last_talk is None or now - self.last_talk > self.cfg["linger_s"]
            if not self.lingered and now - self.face_since >= self.cfg["linger_s"] and quiet:
                self.lingered = True
                return ("attente", "%s est devant toi depuis %d s sans rien dire, %s." %
                        (who.capitalize(), now - self.face_since, where))
            for o in new_objects:
                if o["label"] in self.cfg["ignored_objects"] or self._habitual(o["label"]):
                    continue
                return ("objet", "Un objet que tu ne vois pas d'habitude vient d'apparaître : %s (%s)."
                        % (o["label"], o.get("side", "")))
            return None

        # aucun visage
        if self.present and self.last_face is not None and now - self.last_face > self.cfg["gone_after_s"]:
            talked = self.talked_with_present
            self.present, self.face_since = False, None
            if talked:
                return ("depart", "La personne avec qui tu parlais vient de partir (plus de visage devant toi).")
        return None

    def _habitual(self, label):
        env = self.environment
        if env is None:
            return False
        o = env.objects.get(label)
        return bool(o) and o.get("sightings", 0) >= env.habitual_min

    # ------------------------------------------------------------ garde-fous
    def _allowed(self, kind, now, vision):
        if kind not in self.cfg["events"]:
            return False
        if vision.get("tracking_paused"):          # il est en train de « regarder autour »
            return False
        if kind != "depart" and self.last_talk is not None and now - self.last_talk < self.cfg["quiet_after_talk_s"]:
            return False
        if now - self.last_event.get(kind, -1e9) < self.cfg["cooldown_s"].get(kind, 300):
            return False
        if len([t for t in self.history if now - t < 3600]) >= self.cfg["max_per_hour"]:
            return False
        quiet = self.cfg.get("quiet_hours") or []
        if len(quiet) == 2:
            h = time.localtime(now).tm_hour
            start, end = quiet
            if (start <= h or h < end) if start > end else (start <= h < end):
                return False
        return True
