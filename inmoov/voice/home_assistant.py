"""Agir sur la maison avec Home Assistant, par son assistant vocal intégré (Assist).

Kamil envoie une phrase simple (« allume la lumière du salon », « quelle est la température
de la chambre ? ») à l'API conversation de Home Assistant :
    POST <url>/api/conversation/process   {"text": …, "language": "fr"}
avec un jeton d'accès longue durée (Profil → Sécurité → Jetons d'accès longue durée).

Seuls les appareils « exposés à Assist » dans Home Assistant sont accessibles
(Paramètres → Assistants vocaux → Exposer) : c'est là qu'on choisit ce que le robot a le droit
de commander. Le jeton n'est jamais écrit dans config.json : il vient de la variable
d'environnement HOME_ASSISTANT_TOKEN (fichier anthropic.env, jamais envoyé sur GitHub).
"""

import json
import logging
import os
import ssl
import urllib.error
import urllib.request

log = logging.getLogger("home")


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
