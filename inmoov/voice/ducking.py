"""Baisser le son de la télé pendant qu'on parle à Kamil, puis le remettre comme avant.

Réglage home_assistant.duck : une liste d'appareils, chacun sous l'une de ces formes :
  {"media_player": "media_player.tv", "level": 0.15}
      volume réglable directement : il passe à 15 % (s'il était plus fort), puis revient à sa valeur ;
  {"down": "script.denon_vol_down", "up": "script.denon_vol_up", "steps": 6}
      ampli en infrarouge : « volume − » 6 fois au début, « volume + » 6 fois à la fin.
Tout se fait en arrière-plan : la réponse de Kamil n'attend pas l'ampli.
"""

import logging
import threading
import time

log = logging.getLogger("duck")


class Ducker:
    def __init__(self, home, devices, sleep=time.sleep, step_pause=0.35):
        self.home = home
        self.devices = [d for d in (devices or []) if isinstance(d, dict)]
        self.sleep = sleep
        self.step_pause = step_pause      # temps entre deux appuis infrarouges
        self.lock = threading.Lock()
        self.ducked = False
        self.saved = {}                   # media_player -> volume d'avant

    def _run(self, fn, wait):
        if wait:
            fn()
        else:
            threading.Thread(target=fn, name="duck", daemon=True).start()

    def duck(self, wait=False):
        """Baisse le son (une seule fois, même si on redit « Kamil »)."""
        with self.lock:
            if self.ducked or not self.devices:
                return
            self.ducked = True
        self._run(self._duck, wait)

    def restore(self, wait=False):
        with self.lock:
            if not self.ducked:
                return
            self.ducked = False
        self._run(self._restore, wait)

    def _press(self, script, times):
        domain, name = script.split(".", 1)
        for i in range(int(times)):
            ok, said = self.home.call_service(domain, "turn_on" if domain == "script" else "press",
                                              {"entity_id": script})
            if not ok:
                log.warning("Son de la télé : %s en échec (%s)", script, said)
                return
            if i + 1 < times:
                self.sleep(self.step_pause)

    def _duck(self):
        for d in self.devices:
            try:
                if d.get("media_player"):
                    entity = d["media_player"]
                    st = self.home._entity(entity) or {}
                    volume = (st.get("attributes") or {}).get("volume_level")
                    level = float(d.get("level", 0.15))
                    if st.get("state") in (None, "off", "unavailable", "standby") or volume is None:
                        continue                  # télé éteinte ou volume inconnu : on n'y touche pas
                    if volume > level:
                        self.saved[entity] = volume
                        self.home.call_service("media_player", "volume_set",
                                               {"entity_id": entity, "volume_level": level})
                        log.info("Son de la télé baissé : %s %.2f -> %.2f", entity, volume, level)
                elif d.get("down"):
                    self.saved[d["down"]] = int(d.get("steps", 5))
                    self._press(d["down"], self.saved[d["down"]])
                    log.info("Son de la télé baissé : %s ×%d", d["down"], self.saved[d["down"]])
            except Exception as e:   # l'ampli ne doit jamais empêcher Kamil de répondre
                log.warning("Son de la télé non baissé : %s", e)

    def _restore(self):
        for d in self.devices:
            try:
                if d.get("media_player") and d["media_player"] in self.saved:
                    volume = self.saved.pop(d["media_player"])
                    self.home.call_service("media_player", "volume_set",
                                           {"entity_id": d["media_player"], "volume_level": volume})
                    log.info("Son de la télé remis : %s %.2f", d["media_player"], volume)
                elif d.get("down") and d.get("up") and d["down"] in self.saved:
                    steps = self.saved.pop(d["down"])
                    self._press(d["up"], steps)
                    log.info("Son de la télé remis : %s ×%d", d["up"], steps)
            except Exception as e:
                log.warning("Son de la télé non remis : %s", e)
