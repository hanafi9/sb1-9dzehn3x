"""Agir sur la maison avec Home Assistant, par son assistant vocal intégré (Assist).

Kamil envoie une phrase simple (« allume la lumière du salon », « quelle est la température
de la chambre ? ») à l'API conversation de Home Assistant :
    POST <url>/api/conversation/process   {"text": …, "language": "fr"}
avec un jeton d'accès longue durée (Profil → Sécurité → Jetons d'accès longue durée).

Seuls les appareils « exposés à Assist » dans Home Assistant sont accessibles
(Paramètres → Assistants vocaux → Exposer) : c'est là qu'on choisit ce que le robot a le droit
de commander. Le jeton n'est jamais écrit dans config.json : il vient de la variable
d'environnement HOME_ASSISTANT_TOKEN (fichier anthropic.env, jamais envoyé sur GitHub).

Commande directe (find / control) : quand Assist ne connaît pas l'appareil ou en trouve plusieurs
du même nom, Kamil cherche lui-même l'entité (GET /api/states) puis appelle le service
(POST /api/services/<domaine>/<service>). Seuls les domaines de DIRECT_DOMAINS sont commandables
(lumières, prises, télés, volets…) : jamais de serrure ni d'alarme par ce chemin.
"""

import difflib
import json
import logging
import os
import ssl
import time
import unicodedata
import urllib.error
import urllib.request

log = logging.getLogger("home")

DIRECT_DOMAINS = ("light", "switch", "media_player", "remote", "cover", "climate", "fan", "scene", "script",
                  "input_boolean", "button", "vacuum", "humidifier", "select", "number")
DIRECT_SERVICES = {"turn_on", "turn_off", "toggle", "open_cover", "close_cover", "stop_cover",
                   "set_cover_position", "media_play", "media_pause", "media_play_pause", "media_stop",
                   "media_next_track", "media_previous_track", "volume_up", "volume_down", "volume_set",
                   "volume_mute", "select_source", "set_temperature", "set_hvac_mode", "set_percentage",
                   "press", "start", "stop", "return_to_base", "send_command", "select_option", "set_value",
                   "send_key", "type_text", "search_in_app"}

# télécommande de la Fire TV / Android TV (ADB « input keyevent ») : mot dit -> touche
KEYS = {"haut": "DPAD_UP", "bas": "DPAD_DOWN", "gauche": "DPAD_LEFT", "droite": "DPAD_RIGHT",
        "ok": "DPAD_CENTER", "valider": "DPAD_CENTER", "entrer": "DPAD_CENTER", "selectionner": "DPAD_CENTER",
        "retour": "BACK", "accueil": "HOME", "menu": "MENU", "lecture": "MEDIA_PLAY_PAUSE",
        "pause": "MEDIA_PLAY_PAUSE", "play": "MEDIA_PLAY_PAUSE", "suivant": "MEDIA_NEXT",
        "precedent": "MEDIA_PREVIOUS", "avance": "MEDIA_FAST_FORWARD", "recul": "MEDIA_REWIND",
        "rembobiner": "MEDIA_REWIND", "recherche": "SEARCH", "effacer": "DEL", "entree": "ENTER",
        "volume_plus": "VOLUME_UP", "volume_moins": "VOLUME_DOWN", "muet": "VOLUME_MUTE"}
for _k in list(KEYS.values()):
    KEYS[_k.lower()] = _k              # les noms anglais (« dpad_up », « back »…) marchent aussi
KEYS.update({"up": "DPAD_UP", "down": "DPAD_DOWN", "left": "DPAD_LEFT", "right": "DPAD_RIGHT",
             "center": "DPAD_CENTER", "enter": "DPAD_CENTER", "back": "BACK", "home": "HOME"})


# mots qui veulent dire la même chose (« télé TCL » doit trouver « Téléviseur du salon »)
SYNONYMS = {"tele": "tv", "televiseur": "tv", "television": "tv", "tv": "tv", "ecran": "tv",
            "lumiere": "lumiere", "lampe": "lumiere", "light": "lumiere", "lustre": "lustre",
            "volet": "volet", "store": "volet", "cover": "volet", "prise": "prise", "switch": "prise"}
# mots qui ne servent pas à trouver l'appareil
STOP_WORDS = {"le", "la", "les", "l", "de", "du", "des", "d", "un", "une", "mon", "ma", "mes"}


def _norm(text):
    text = unicodedata.normalize("NFKD", str(text).lower())
    words = "".join(c if c.isalnum() else " " for c in text if not unicodedata.combining(c)).split()
    return [SYNONYMS.get(w, w) for w in words if w not in STOP_WORDS]


KEYS_NORM = {"".join(_norm(name)): code for name, code in KEYS.items()}   # « Retour », « dpad_up »…


class HomeAssistant:
    def __init__(self, url, token=None, language="fr", agent_id=None, timeout=8.0, verify_ssl=True, ca_file=None,
                 app_aliases=None, app_search=None):
        """verify_ssl=False : Home Assistant en https avec un certificat auto-signé (réseau local) ;
        ca_file : ou bien le certificat lui-même, pour le vérifier quand même (plus sûr)."""
        self.url = url.rstrip("/")
        self.context = None
        if self.url.startswith("https://"):
            if ca_file:
                self.context = ssl.create_default_context(cafile=ca_file)
            elif not verify_ssl:
                self.context = ssl.create_default_context()
                self.context.check_hostname = False
                self.context.verify_mode = ssl.CERT_NONE
        self.token = token or os.environ.get("HOME_ASSISTANT_TOKEN", "")
        self.language = language
        self.agent_id = agent_id
        self.timeout = timeout
        self.conversation_id = None   # Assist garde le fil (« et dans la chambre ? »)
        # nom dit à voix haute -> nom technique de l'application (ex. "IPRO2" -> "com.iproboxx…")
        self.app_aliases = {"".join(_norm(k)): v for k, v in (app_aliases or {}).items()}   # « IPRO 2 » = « ipro2 »
        # comment ouvrir la recherche de chaque application (voir search_in_app)
        self.app_search = {"".join(_norm(k)): v for k, v in (app_search or {}).items() if isinstance(v, dict)}

    def ask(self, text):
        """Envoie la phrase à Assist ; renvoie (succès, réponse à dire)."""
        if not self.token:
            return False, "jeton Home Assistant absent (HOME_ASSISTANT_TOKEN dans anthropic.env)"
        body = {"text": text, "language": self.language}
        if self.agent_id:
            body["agent_id"] = self.agent_id
        if self.conversation_id:
            body["conversation_id"] = self.conversation_id
        req = urllib.request.Request(
            self.url + "/api/conversation/process", data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.context) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return False, "Home Assistant refuse le jeton (401) : jeton faux ou expiré"
            return False, "Home Assistant a répondu %d" % e.code
        except (urllib.error.URLError, OSError, ValueError) as e:
            return False, "Home Assistant injoignable (%s)" % getattr(e, "reason", e)
        self.conversation_id = data.get("conversation_id") or self.conversation_id
        response = data.get("response") or {}
        speech = ((response.get("speech") or {}).get("plain") or {}).get("speech", "")
        kind = response.get("response_type")
        log.info("Home Assistant (%s) : %s -> %s", kind, text, speech)
        if kind == "error":
            return False, speech or "Home Assistant n'a pas compris"
        return True, speech or "c'est fait"

    # ------------------------------------------------------------ commande directe
    def _get(self, path):
        req = urllib.request.Request(self.url + path, headers={"Authorization": "Bearer " + self.token})
        with urllib.request.urlopen(req, timeout=self.timeout, context=self.context) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def find(self, query, limit=8, domains=DIRECT_DOMAINS + ("sensor", "binary_sensor")):
        """Entités dont le nom ressemble à la recherche ; renvoie (succès, lignes « entity_id | nom | état »)."""
        if not self.token:
            return False, "jeton Home Assistant absent (HOME_ASSISTANT_TOKEN dans anthropic.env)"
        try:
            states = self._get("/api/states")
        except urllib.error.HTTPError as e:
            return False, "Home Assistant a répondu %d" % e.code
        except (urllib.error.URLError, OSError, ValueError) as e:
            return False, "Home Assistant injoignable (%s)" % getattr(e, "reason", e)
        words = _norm(query)
        if not words:
            return False, "recherche vide"
        scored = []
        for st in states:
            entity = st.get("entity_id", "")
            if entity.split(".", 1)[0] not in domains:
                continue
            name = (st.get("attributes") or {}).get("friendly_name") or entity
            hay = _norm(name) + _norm(entity.replace("_", " "))
            if entity.startswith("media_player."):
                hay.append("tv")          # une télé est presque toujours un media_player
            # chaque mot cherché : présent tel quel, ou très ressemblant
            score = sum(1.0 if w in hay else max((difflib.SequenceMatcher(None, w, h).ratio() for h in hay),
                                                 default=0) for w in words) / len(words)
            if score >= 0.6:
                scored.append((score, entity, name, st.get("state")))
        scored.sort(key=lambda x: (-x[0], x[1]))
        lines = ["%s | %s | %s" % (e, n, s) for sc, e, n, s in scored[:limit] if sc >= 0.99]
        close = ["%s | %s | %s" % (e, n, s) for sc, e, n, s in scored[:limit] if sc < 0.99]
        if lines:
            return True, "\n".join(lines + (["(approchants :)"] + close[:3] if close else []))
        # aucun nom ne contient tous les mots : on montre ce qui ressemble, sans rien choisir
        others = close or ["%s | %s | %s" % (st["entity_id"], (st.get("attributes") or {}).get("friendly_name"),
                                            st.get("state")) for st in states
                           if st.get("entity_id", "").startswith("media_player.")][:limit]
        return True, ("aucun appareil ne correspond exactement à « %s ». Ne commande pas un autre appareil "
                      "au hasard : demande lequel à la personne. Appareils proches :\n%s"
                      % (query, "\n".join(others) or "aucun"))

    def app_alias(self, spoken):
        """Nom technique de l'application pour un nom dit à voix haute, même mal entendu
        (« E-Pro Box » pour « iProBox ») ; None si rien ne ressemble assez."""
        key = "".join(_norm(spoken))
        if not key:
            return None
        if key in self.app_aliases:
            return self.app_aliases[key]
        best = max(self.app_aliases, key=lambda k: difflib.SequenceMatcher(None, key, k).ratio(), default=None)
        if best and difflib.SequenceMatcher(None, key, best).ratio() >= 0.75:
            return self.app_aliases[best]
        return None

    def _remote(self, entity_id, service, data):
        """Télécommande par ADB : touches (« bas » ×3, « ok », « retour »…) ou texte tapé dans une recherche."""
        if not entity_id.startswith("media_player."):
            return False, "la télécommande ne marche qu'avec le media_player de la Fire TV / Android TV"
        if service == "send_key":
            keys = [k for k in str(data.get("key", "")).replace(",", " ").split() if k]
            codes = []
            for k in keys:
                code = KEYS_NORM.get("".join(_norm(k)))
                if not code:
                    return False, "touche inconnue « %s » (haut, bas, gauche, droite, ok, retour, accueil, " \
                                  "menu, lecture, pause, avance, recul, recherche…)" % k
                codes.append("KEYCODE_" + code)
            repeat = max(1, min(int(data.get("repeat") or 1), 20))
            if not codes:
                return False, "aucune touche donnée"
            command = "input keyevent " + " ".join(codes * repeat)
            done = "touche%s %s%s" % ("s" if len(codes) * repeat > 1 else "", " ".join(keys),
                                      " ×%d" % repeat if repeat > 1 else "")
        else:
            text = str(data.get("text", ""))[:80]
            if not text.strip():
                return False, "aucun texte à taper"
            # adb « input text » : espaces = %s, guillemets simples protégés pour le shell de la télé
            command = "input text '%s'" % text.replace("'", "").replace(" ", "%s")
            done = "texte « %s » tapé" % text
        ok, said = self.call_service("androidtv", "adb_command", {"entity_id": entity_id, "command": command})
        log.info("Home Assistant direct : télécommande %s « %s » -> %s", entity_id, command, said)
        return (True, "%s sur %s" % (done, entity_id)) if ok else (False, said)

    def search_in_app(self, entity_id, app, text, sleep=time.sleep):
        """Ouvre l'application, va dans sa recherche, tape le texte et valide (chaîne, film…).
        Réglage par application (home_assistant.app_search) :
          "activity" : écran de recherche qui accepte une recherche Android (une seule commande) ;
          sinon "keys" (touches pour atteindre le champ de recherche, défaut « recherche »),
          "wait_s" (temps d'ouverture de l'application, défaut 6), "after" (touches après le texte,
          défaut « entree »)."""
        if not text.strip():
            return False, "aucun nom à chercher"
        key = "".join(_norm(app))
        target = self.app_alias(app)
        if not target:
            return False, "application « %s » inconnue (ajoute-la dans app_aliases)" % app
        recipe = self.app_search.get(key)
        if recipe is None:     # nom mal entendu : même tolérance que pour les applications
            best = max(self.app_search, key=lambda k: difflib.SequenceMatcher(None, key, k).ratio(), default=None)
            if best and difflib.SequenceMatcher(None, key, best).ratio() >= 0.75:
                recipe = self.app_search[best]
        recipe = recipe or {}
        package = target.split("/", 1)[0]
        if recipe.get("activity"):
            safe = text.replace("'", "").replace('"', "")[:80]
            activity = recipe["activity"] if "/" in recipe["activity"] else "%s/%s" % (package, recipe["activity"])
            command = "am start -a android.intent.action.SEARCH -n %s -e query '%s'" % (activity, safe)
            ok, said = self.call_service("androidtv", "adb_command", {"entity_id": entity_id, "command": command})
            log.info("Home Assistant direct : recherche %s « %s » -> %s", entity_id, command, said)
            return (True, "recherche « %s » lancée dans %s" % (text, app)) if ok else (False, said)
        steps = []
        if not self._launch_app(entity_id, target):
            return False, "impossible d'ouvrir %s sur %s" % (app, entity_id)
        steps.append("ouvert")
        sleep(float(recipe.get("wait_s", 6)))
        for service, data, pause, label in (
                ("send_key", {"key": recipe.get("keys", "recherche")}, 1.5, "recherche ouverte"),
                ("type_text", {"text": text}, 1.0, "« %s » tapé" % text),
                ("send_key", {"key": recipe.get("after", "entree")}, 0, "validé")):
            if not data.get("key", True):
                continue                      # « after » vide : on ne valide pas
            ok, said = self._remote(entity_id, service, data)
            if not ok:
                return False, "%s, puis échec : %s" % (", ".join(steps), said)
            steps.append(label)
            sleep(pause)
        return True, "dans %s : %s" % (app, ", ".join(steps))

    def _launch_app(self, entity_id, app):
        """Fire TV / Android TV (intégration androidtv, ADB) : ouvre l'application directement, comme le
        menu de la télé (« select_source » échoue avec certaines applications). app = nom technique, ou
        « paquet/activité » pour viser l'écran d'accueil exact. None si l'ADB n'est pas disponible."""
        if not entity_id.startswith("media_player."):
            return None
        if "/" in app:
            command = "am start -n %s" % app
        else:
            command = "monkey -p %s -c android.intent.category.LEANBACK_LAUNCHER 1" % app
        ok, said = self.call_service("androidtv", "adb_command", {"entity_id": entity_id, "command": command})
        log.info("Home Assistant direct : androidtv.adb_command %s « %s » -> %s", entity_id, command, said)
        if not ok:
            return None                  # pas une Fire TV / Android TV en ADB : on essaie select_source
        return True, "application %s ouverte sur %s" % (app.split("/", 1)[0], entity_id)

    def screenshot(self, entity_id):
        """Image de l'écran d'une télé / Fire TV (image de l'entité media_player : capture d'écran ADB
        de l'intégration Android TV) ; renvoie (succès, (octets, type) ou message)."""
        st = self._entity(entity_id)
        if not isinstance(st, dict):
            return False, "appareil %s introuvable" % entity_id
        picture = (st.get("attributes") or {}).get("entity_picture")
        if not picture:
            return False, ("pas d'image de l'écran pour %s : dans Home Assistant, Android TV → Configurer → "
                           "cocher « Utiliser la capture d'écran » (screencap)" % entity_id)
        req = urllib.request.Request(self.url + picture, headers={"Authorization": "Bearer " + self.token})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.context) as resp:
                data, kind = resp.read(), resp.headers.get_content_type()
        except urllib.error.HTTPError as e:
            return False, "image de l'écran refusée (%d)" % e.code
        except (urllib.error.URLError, OSError) as e:
            return False, "image de l'écran injoignable (%s)" % getattr(e, "reason", e)
        if not kind.startswith("image/") or not data:
            return False, "l'écran n'a pas renvoyé d'image"
        return True, (data, kind)

    def _entity(self, entity_id):
        try:
            return self._get("/api/states/" + entity_id)
        except (urllib.error.URLError, OSError, ValueError):
            return None

    def state(self, entity_id):
        """État actuel d'une entité (ex. "on", "idle"), ou None si illisible."""
        st = self._entity(entity_id)
        return st.get("state") if isinstance(st, dict) else None

    def control(self, entity_id, service, options=None, wait_s=3.0, sleep=time.sleep):
        """Appelle un service sur une entité précise (ex. media_player.tv_salon, turn_on), puis vérifie
        que l'appareil a vraiment réagi : Home Assistant accepte la demande même si l'appareil est
        injoignable (télé en veille profonde, Fire TV sans débogage ADB…)."""
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        if domain not in DIRECT_DOMAINS:
            return False, "domaine « %s » non autorisé en commande directe" % domain
        if service not in DIRECT_SERVICES:
            return False, "service « %s » non autorisé (ex. turn_on, turn_off, toggle, media_play…)" % service
        data = dict(options or {})
        if service in ("send_key", "type_text"):
            return self._remote(entity_id, service, data)
        if service == "search_in_app":
            return self.search_in_app(entity_id, str(data.get("app", "")), str(data.get("text", "")), sleep=sleep)
        if service == "select_source" and isinstance(data.get("source"), str):
            alias = self.app_alias(data["source"])
            if alias:
                launched = self._launch_app(entity_id, alias)
                if launched is not None:
                    return launched
                data["source"] = alias.split("/", 1)[0]   # sinon : « source » = nom technique
        data["entity_id"] = entity_id
        before = self.state(entity_id)
        ok, said = self.call_service(domain, service, data)
        log.info("Home Assistant direct : %s.%s %s -> %s", domain, service, data, said)
        if not ok:
            return ok, said
        expected = {"turn_on": lambda s: s not in ("off", "unavailable", "unknown", "standby"),
                    "turn_off": lambda s: s in ("off", "standby"),
                    "open_cover": lambda s: s in ("open", "opening"), "close_cover": lambda s: s in ("closed", "closing"),
                    "media_play": lambda s: s == "playing", "media_pause": lambda s: s in ("paused", "idle")}.get(service)
        if domain in ("script", "scene", "button", "remote"):
            expected = None      # s'exécutent puis reviennent à « off » : pas d'état durable à vérifier
        after = before
        if expected is not None and wait_s > 0:
            end = time.monotonic() + wait_s
            while time.monotonic() < end:
                sleep(0.5)
                after = self.state(entity_id)
                if after is not None and expected(after):
                    break
        if service == "select_source" and wait_s > 0:
            # l'application est-elle vraiment au premier plan ? (attributs app_id / source d'Android TV)
            wanted, end, shown = str(data.get("source", "")), time.monotonic() + wait_s, None
            while time.monotonic() < end:
                sleep(0.5)
                attrs = (self._entity(entity_id) or {}).get("attributes") or {}
                shown = [v for v in (attrs.get("app_id"), attrs.get("source")) if v]
                if not shown or wanted in shown:    # rien à vérifier (autre intégration), ou c'est bon
                    break
            if shown and wanted not in shown:
                log.warning("Home Assistant direct : %s n'a pas ouvert %s (à l'écran : %s)", entity_id, wanted, shown[0])
                return False, ("la demande est partie, mais %s n'a pas ouvert « %s » (application à l'écran : %s). "
                               "Nom d'application inconnu de l'appareil ?" % (entity_id, wanted, shown[0]))
        if after == "unavailable":
            log.warning("Home Assistant direct : %s indisponible", entity_id)
            return False, "Home Assistant a accepté, mais %s est indisponible (appareil injoignable)" % entity_id
        if expected is not None and after is not None and not expected(after):
            log.warning("Home Assistant direct : %s n'a pas réagi (état %s -> %s)", entity_id, before, after)
            return False, ("Home Assistant a transmis l'ordre, mais %s n'a pas réagi (état : %s). L'appareil "
                           "est peut-être en veille profonde ou mal relié à Home Assistant." % (entity_id, after))
        return True, "fait : %s sur %s (état : %s)" % (service, entity_id, after or "inconnu")

    def call_service(self, domain, service, data):
        """Appelle un service Home Assistant (ex. notify / mobile_app_telephone) ; renvoie (succès, message)."""
        req = urllib.request.Request(
            "%s/api/services/%s/%s" % (self.url, domain, service), data=json.dumps(data).encode("utf-8"),
            method="POST", headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.context):
                return True, "ok"
        except urllib.error.HTTPError as e:
            return False, "Home Assistant a répondu %d" % e.code
        except (urllib.error.URLError, OSError) as e:
            return False, "Home Assistant injoignable (%s)" % getattr(e, "reason", e)
