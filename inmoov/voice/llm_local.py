"""IA locale de secours (sans Internet) via un serveur compatible Ollama.

Fonctionne avec :
- Ollama sur le Raspberry Pi 5 (processeur seul, petits modèles, lent) ;
- hailo-ollama sur le Raspberry Pi AI HAT+ 2 (Hailo-10H, 8 Go), qui expose la
  même API pour des modèles comme Qwen 2.5 1,5B ou Llama 3.2 1B.

API utilisée : POST <url>/api/chat {"model", "messages", "stream": false}
-> {"message": {"role": "assistant", "content": "..."}}

Pas d'outils ni de vision ici : l'IA locale sert seulement à répondre quand
Claude est injoignable.
"""

import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger("local-llm")

SYSTEM = ("Tu es {name}, un robot humanoïde InMoov. Réponds en français, en une ou deux phrases "
          "courtes faites pour être lues à voix haute, sans listes ni emojis.")


class LocalBrain:
    def __init__(self, cfg, robot_name="InMoov"):
        self.url = cfg["url"].rstrip("/")
        self.model = cfg["model"]
        self.timeout = cfg.get("timeout_s", 60)
        self.system = SYSTEM.format(name=robot_name)
        self.history = []
        self.max_turns = cfg.get("max_turns", 6)

    def ask(self, text):
        """Renvoie la réponse, ou None si le serveur local ne répond pas."""
        self.history.append({"role": "user", "content": text})
        self.history = self.history[-2 * self.max_turns:]
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": self.system}] + self.history,
            "stream": False,
        }).encode("utf-8")
        req = urllib.request.Request(self.url + "/api/chat", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as e:
            log.warning("IA locale injoignable : %s", e)
            self.history.pop()
            return None
        reply = (data.get("message") or {}).get("content", "").strip()
        if not reply:
            self.history.pop()
            return None
        self.history.append({"role": "assistant", "content": reply})
        return reply
