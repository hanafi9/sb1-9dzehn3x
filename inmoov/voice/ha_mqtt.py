"""Kamil dans Home Assistant, par MQTT (découverte automatique).

Kamil reste sur le Pi (micro, caméras, moteurs) ; Home Assistant le voit comme un appareil
« Kamil » avec ses entités, créées toutes seules grâce à la découverte MQTT :
- état (en veille / réveillé / réfléchit / parle), dernière phrase entendue, dernière réponse, voix reconnue ;
- personnes vues, mouvement, dernier événement du journal de surveillance, interrupteur « mode garde » ;
- les images des deux caméras ;
- « Kamil dit » (notify et champ texte) : Kamil prononce la phrase, ex. depuis une automatisation ;
- « Question à Kamil » (champ texte) : Kamil répond à voix haute, comme si on lui avait parlé.

Il faut un broker MQTT : dans Home Assistant, Paramètres → Modules complémentaires → Mosquitto broker,
puis l'intégration MQTT. Identifiants dans anthropic.env : MQTT_USERNAME=… et MQTT_PASSWORD=…
(un utilisateur Home Assistant, ou un login déclaré dans le module Mosquitto).
pip install paho-mqtt
"""

import json
import logging
import os
import queue
import threading
import time

from perception import read_vision

log = logging.getLogger("mqtt")

DEFAULTS = {
    "enabled": False,
    "host": "homeassistant.local",
    "port": 1883,
    "username_env": "MQTT_USERNAME",
    "password_env": "MQTT_PASSWORD",
    "base_topic": "kamil",
    "discovery_prefix": "homeassistant",
    "camera_every_s": 2.0,       # une image par caméra toutes les 2 s au plus
    "vision_every_s": 1.0,
    "motion_threshold": 0.03,
    "frame_paths": ["/dev/shm/inmoov_frame.jpg", "/dev/shm/inmoov_frame2.jpg"],
}

STATES = {"idle": "en veille", "awake": "réveillé", "thinking": "réfléchit", "speaking": "parle"}
DEVICE = {"identifiers": ["kamil_inmoov"], "name": "Kamil", "manufacturer": "InMoov",
          "model": "Robot humanoïde InMoov (Raspberry Pi 5)"}


def make_client(client_id):
    import paho.mqtt.client as mqtt   # importé seulement si MQTT est activé

    try:   # paho-mqtt 2.x
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    except AttributeError:   # paho-mqtt 1.x
        return mqtt.Client(client_id=client_id)


class KamilMQTT:
    def __init__(self, cfg, vision_path=None, client=None, clock=time.time):
        self.cfg = dict(DEFAULTS)
        self.cfg.update(cfg or {})
        self.base = self.cfg["base_topic"].strip("/")
        self.vision_path = vision_path
        self.clock = clock
        self.commands = queue.Queue()      # (« dire » | « question » | « garde », texte) pour la boucle d'écoute
        self.guard_state = None            # fonction () -> bool, état du mode garde
        self.client = client or make_client("kamil-%d" % os.getpid())
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.last = {}                     # dernières valeurs, republiées après une reconnexion
        self.frames_mtime = {}
        self.stop = threading.Event()

    # ------------------------------------------------------------ connexion
    def t(self, name):
        return "%s/%s" % (self.base, name)

    def start(self):
        user = os.environ.get(self.cfg["username_env"], "")
        if user:
            self.client.username_pw_set(user, os.environ.get(self.cfg["password_env"], ""))
        self.client.will_set(self.t("disponible"), "offline", retain=True)
        self.client.reconnect_delay_set(1, 60)
        self.client.connect_async(self.cfg["host"], int(self.cfg["port"]), keepalive=30)
        self.client.loop_start()
        threading.Thread(target=self._sensors_loop, name="mqtt-capteurs", daemon=True).start()
        log.info("Home Assistant (MQTT) : connexion à %s:%s", self.cfg["host"], self.cfg["port"])

    def _on_connect(self, client, userdata, flags, reason_code, *properties):
        code = getattr(reason_code, "value", reason_code)
        if code not in (0, None):
            log.warning("MQTT refusé (%s) : identifiants MQTT_USERNAME / MQTT_PASSWORD ?", reason_code)
            return
        log.info("Home Assistant (MQTT) : connecté, appareil « Kamil » annoncé")
        for topic in ("dire", "question", "garde/set"):
            client.subscribe(self.t(topic))
        client.subscribe(self.cfg["discovery_prefix"] + "/status")   # Home Assistant redémarre
        self.announce()

    def _on_message(self, client, userdata, msg):
        payload = msg.payload.decode("utf-8", "replace").strip()
        if msg.topic == self.cfg["discovery_prefix"] + "/status":
            if payload == "online":
                self.announce()
            return
        if not payload:
            return
        if msg.topic == self.t("dire"):
            self.commands.put(("dire", payload))
            client.publish(self.t("dire/valeur"), "")      # champ vidé : message reçu
        elif msg.topic == self.t("question"):
            self.commands.put(("question", payload))
            client.publish(self.t("question/valeur"), "")
        elif msg.topic == self.t("garde/set"):
            self.commands.put(("garde", payload.upper() == "ON"))

    # ------------------------------------------------------------ découverte
    def entities(self):
        """(composant, identifiant, configuration) de chaque entité, pour la découverte de Home Assistant."""
        avail = {"availability_topic": self.t("disponible"), "device": DEVICE}

        def ent(component, key, name, **extra):
            conf = {"name": name, "unique_id": "kamil_" + key}   # entités : sensor.kamil_etat, switch.kamil_mode_garde…
            conf.update(avail)
            conf.update(extra)
            return component, key, conf

        return [
            ent("sensor", "etat", "État", state_topic=self.t("etat"), icon="mdi:robot"),
            ent("sensor", "entendu", "Dernière phrase entendue", state_topic=self.t("entendu"),
                icon="mdi:ear-hearing"),
            ent("sensor", "reponse", "Dernière réponse", state_topic=self.t("reponse"), icon="mdi:message-reply-text"),
            ent("sensor", "voix", "Voix reconnue", state_topic=self.t("voix"), icon="mdi:account-voice"),
            ent("sensor", "personnes", "Personnes vues", state_topic=self.t("personnes"),
                state_class="measurement", icon="mdi:account-group"),
            ent("binary_sensor", "mouvement", "Mouvement", state_topic=self.t("mouvement"), device_class="motion"),
            ent("sensor", "journal", "Dernier événement", state_topic=self.t("journal"), icon="mdi:notebook"),
            # change à chaque alerte du mode garde : déclencheur pour une automatisation (notification…)
            ent("sensor", "alerte", "Dernière alerte", state_topic=self.t("alerte"), icon="mdi:alarm-light"),
            ent("switch", "garde", "Mode garde", state_topic=self.t("garde"), command_topic=self.t("garde/set"),
                icon="mdi:shield-home"),
            ent("notify", "dire", "Dire", command_topic=self.t("dire")),
            ent("text", "dire_texte", "Faire dire", command_topic=self.t("dire"),
                state_topic=self.t("dire/valeur"), max=255,
                icon="mdi:account-voice"),
            ent("text", "question", "Question", command_topic=self.t("question"),
                state_topic=self.t("question/valeur"), max=255,
                icon="mdi:chat-question"),
            ent("camera", "camera1", "Caméra 1", topic=self.t("camera1")),
            ent("camera", "camera2", "Caméra 2", topic=self.t("camera2")),
        ]

    def announce(self):
        for component, key, conf in self.entities():
            self.client.publish("%s/%s/kamil/%s/config" % (self.cfg["discovery_prefix"], component, key),
                                json.dumps(conf, ensure_ascii=False), retain=True)
        self.client.publish(self.t("disponible"), "online", retain=True)
        for field in ("dire/valeur", "question/valeur"):
            self.client.publish(self.t(field), "")             # champs vides au lieu de « unknown »
        if self.guard_state is not None:
            self.last["garde"] = "ON" if self.guard_state() else "OFF"
        for key, value in list(self.last.items()):
            self.client.publish(self.t(key), value, retain=True)

    # ------------------------------------------------------------ états
    def publish(self, key, value):
        value = str(value)[:250]
        if self.last.get(key) == value:
            return
        self.last[key] = value
        self.client.publish(self.t(key), value, retain=True)

    def state(self, state):
        self.publish("etat", STATES.get(state, state))

    def guard(self, on):
        self.publish("garde", "ON" if on else "OFF")

    def _sensors_loop(self):
        """Personnes, mouvement (fichier de la vision) et images des caméras, à leur rythme."""
        next_cam = 0.0
        while not self.stop.wait(float(self.cfg["vision_every_s"])):
            try:
                self.poll_vision()
                if self.clock() >= next_cam:
                    next_cam = self.clock() + float(self.cfg["camera_every_s"])
                    self.poll_cameras()
            except Exception:   # un capteur raté ne doit jamais arrêter Kamil
                log.exception("MQTT : capteurs")

    def poll_vision(self):
        if not self.vision_path:
            return
        vision = read_vision(self.vision_path, max_age_s=5, now=self.clock())
        if vision is None:
            return
        self.publish("personnes", max(int(vision.get("faces") or 0), int(vision.get("people") or 0)))
        levels = [(vision.get("motion") or {}).get("level") or 0,
                  ((vision.get("camera2") or {}).get("motion") or {}).get("level") or 0]
        self.publish("mouvement", "ON" if max(levels) >= self.cfg["motion_threshold"] else "OFF")

    def poll_cameras(self):
        for i, path in enumerate(self.cfg["frame_paths"][:2]):
            try:
                mtime = os.path.getmtime(path)
                if self.frames_mtime.get(i) == mtime:
                    continue
                with open(path, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if data[:2] != b"\xff\xd8":   # image en cours d'écriture : on attend la suivante
                continue
            self.frames_mtime[i] = mtime
            self.client.publish(self.t("camera%d" % (i + 1)), data)
