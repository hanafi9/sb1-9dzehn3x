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
                   "press", "start", "stop", "return_to_base", "send_command", "select_option", "set_value"}


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


class HomeAssistant:
    def __init__(self, url, token=None, language="fr", agent_id=None, timeout=8.0, verify_ssl=True, ca_file=None):
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

    def state(self, entity_id):
        """État actuel d'une entité (ex. "on", "idle"), ou None si illisible."""
        try:
            return self._get("/api/states/" + entity_id).get("state")
        except (urllib.error.URLError, OSError, ValueError, AttributeError):
            return None

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
        after = before
        if expected is not None and wait_s > 0:
            end = time.monotonic() + wait_s
            while time.monotonic() < end:
                sleep(0.5)
                after = self.state(entity_id)
                if after is not None and expected(after):
                    break
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
