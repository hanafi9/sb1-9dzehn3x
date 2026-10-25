"""IA de secours, quand Claude ne répond pas (pas d'Internet, plus de crédit…).

Deux familles de serveurs :
- "api": "ollama" (par défaut) : Ollama sur le Raspberry Pi 5 ou hailo-ollama sur l'AI HAT+ 2,
  sans Internet.  POST <url>/api/chat {"model", "messages", "stream": false}
- "api": "openai" : tout service compatible OpenAI, en ligne :
    OpenAI   : base_url https://api.openai.com/v1      , clé OPENAI_API_KEY
    Grok/xAI : base_url https://api.x.ai/v1            , clé XAI_API_KEY
    Groq     : base_url https://api.groq.com/openai/v1 , clé GROQ_API_KEY (gratuit, avec limites)
  POST <base_url>/chat/completions ; la maison reste pilotable (outil home_assistant).

Pas de vision ni de gestes ici : seulement parler, et agir sur la maison avec un service en ligne.
"""

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger("local-llm")

SYSTEM = ("Tu es {name}, un robot humanoïde InMoov chaleureux et un peu farceur. Réponds en français, "
          "en une ou deux phrases courtes faites pour être lues à voix haute, sans listes ni emojis.")
HOME_HINT = (" Pour agir sur la maison ou lire un capteur, utilise l'outil home_assistant avec une "
             "commande courte en français (« allume le lustre », « quelle est la température du salon ? »).")

HOME_FUNCTION = {
    "type": "function",
    "function": {
        "name": "home_assistant",
        "description": "Agir sur la maison ou lire un capteur avec Home Assistant ; une commande courte en "
                       "français, comme à un assistant vocal.",
        "parameters": {"type": "object", "properties": {"command": {"type": "string"}},
                       "required": ["command"], "additionalProperties": False},
    },
}


class LocalBrain:
    def __init__(self, cfg, robot_name="InMoov"):
        self.api = cfg.get("api", "ollama")
        self.url = (cfg.get("base_url") or cfg.get("url") or "").rstrip("/")
        self.model = cfg["model"]
        self.key_env = cfg.get("api_key_env") or "OPENAI_API_KEY"
        self.timeout = cfg.get("timeout_s", 60)
        self.system = SYSTEM.format(name=robot_name)
        self.history = []
        self.max_turns = cfg.get("max_turns", 6)
        self.home = None        # HomeAssistant de Claude, si la maison est branchée
        # modèles qui réfléchissent (ex. openai/gpt-oss-120b chez Groq) : "low" = réponse plus rapide
        self.reasoning_effort = cfg.get("reasoning_effort")

    def name(self):
        return "%s (%s)" % (self.model, self.url)

    def ask(self, text):
        """Renvoie la réponse, ou None si le serveur ne répond pas."""
        self.history.append({"role": "user", "content": text})
        self.history = self.history[-2 * self.max_turns:]
        try:
            reply = self._ask_openai() if self.api == "openai" else self._ask_ollama()
        except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
            detail = e.read().decode("utf-8", "replace")[:200] if isinstance(e, urllib.error.HTTPError) else ""
            log.warning("IA de secours injoignable : %s %s", e, detail)
            reply = None
        if not reply:
            self.history.pop()
            return None
        self.history.append({"role": "assistant", "content": reply})
        return reply

    def _post(self, path, body, headers=None):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers=dict({"Content-Type": "application/json",
                                                   "User-Agent": "InMoov-Kamil/1.0"}, **(headers or {})))
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _ask_ollama(self):
        data = self._post("/api/chat", {"model": self.model, "stream": False,
                                        "messages": [{"role": "system", "content": self.system}] + self.history})
        return (data.get("message") or {}).get("content", "").strip()

    def _ask_openai(self):
        key = os.environ.get(self.key_env, "")
        if not key:
            raise ValueError("clé %s absente (anthropic.env)" % self.key_env)
        system = self.system + (HOME_HINT if self.home is not None else "")
        messages = [{"role": "system", "content": system}] + list(self.history)
        for _ in range(4):   # au plus 3 commandes de maison enchaînées
            body = {"model": self.model, "messages": messages}
            if self.reasoning_effort:
                body["reasoning_effort"] = self.reasoning_effort
            if self.home is not None:
                body["tools"] = [HOME_FUNCTION]
            msg = self._post("/chat/completions", body, {"Authorization": "Bearer " + key})["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            if not calls:
                return (msg.get("content") or "").strip()
            messages.append({"role": "assistant", "content": msg.get("content"), "tool_calls": calls})
            for call in calls:
                try:
                    command = str(json.loads(call["function"]["arguments"]).get("command", ""))[:200]
                    ok, said = self.home.ask(command)
                except (ValueError, KeyError) as e:
                    said = "commande illisible (%s)" % e
                log.info("IA de secours → Home Assistant : %s -> %s", call["function"].get("arguments"), said)
                messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": said})
        return None
