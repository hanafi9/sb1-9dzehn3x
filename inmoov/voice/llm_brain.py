"""Cerveau conversationnel d'InMoov basé sur Claude (API Anthropic).

Remplace le chatbot AIML d'InMoov2 : Claude répond en français, se souvient de la
conversation et peut bouger la tête et les mains grâce à des « outils ».
Les jambes ne sont volontairement PAS accessibles à l'IA (sécurité).

Nécessite la variable d'environnement ANTHROPIC_API_KEY et une connexion Internet.
"""

import logging
import time

import anthropic

log = logging.getLogger("brain")

SYSTEM_PROMPT = """Tu es {name}, un robot humanoïde InMoov imprimé en 3D, construit par {owner}.
Tu as une tête, un torse et deux bras avec des mains ; tes jambes sont en construction.
Tu vois grâce à une caméra et tu suis les visages automatiquement.

Ce que tu dis est lu à voix haute par une synthèse vocale :
- réponds en français, en une à trois phrases courtes, comme à l'oral ;
- pas de listes, pas de titres, pas d'emojis, pas de markdown, pas d'URL ;
- écris les nombres et les unités comme on les prononce si c'est plus clair.

Tu peux bouger avec les outils fournis. Utilise-les quand on te le demande ou quand un
geste rend la conversation plus vivante (par exemple tourner la tête vers la personne).
Si quelqu'un te demande un mouvement que tes outils ne permettent pas, dis-le simplement.
Si tu n'as pas bien compris (la reconnaissance vocale fait parfois des erreurs), demande
de répéter plutôt que d'inventer.{extra}"""

# Outils exposés à Claude. strict=True garantit des arguments conformes au schéma ;
# les bornes physiques sont de toute façon réappliquées dans _run_tool().
TOOLS = [
    {
        "name": "move_head",
        "description": (
            "Tourne la tête du robot. rothead : rotation gauche/droite en degrés "
            "(90 = face, plus grand = vers la gauche du robot). neck : inclinaison en degrés "
            "(90 = droit, plus petit = vers le haut, plus grand = vers le bas)."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "rothead": {"type": "number", "description": "Rotation, entre 30 et 150."},
                "neck": {"type": "number", "description": "Inclinaison, entre 60 et 120."},
            },
            "required": ["rothead", "neck"],
            "additionalProperties": False,
        },
    },
    {
        "name": "hand",
        "description": "Ouvre, ferme ou remet au repos une main du robot.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "side": {"type": "string", "enum": ["left", "right"]},
                "action": {"type": "string", "enum": ["open", "close", "rest"]},
            },
            "required": ["side", "action"],
            "additionalProperties": False,
        },
    },
    {
        "name": "rest_position",
        "description": "Remet tout le haut du corps du robot en position de repos.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    },
]


class ClaudeBrain:
    def __init__(self, cfg, call, speak, client=None):
        """
        cfg   : section "brain" de config.json
        call  : fonction (service, methode, *params) -> (succès, réponse) vers MyRobotLab
        speak : fonction (texte) qui fait parler le robot
        """
        self.cfg = cfg
        self.call = call
        self.speak = speak
        self.client = client or anthropic.Anthropic(timeout=cfg["timeout_s"], max_retries=1)
        extra = ("\n\n" + cfg["extra_instructions"]) if cfg.get("extra_instructions") else ""
        self.system = SYSTEM_PROMPT.format(name=cfg["robot_name"], owner=cfg["owner_name"], extra=extra)
        self.messages = []
        self.last_activity = 0.0

    def reset(self):
        self.messages = []

    def _maybe_reset(self):
        # On repart d'une conversation neuve après un long silence ou si l'historique
        # devient long : on n'efface jamais seulement une partie de l'historique.
        now = time.monotonic()
        if self.messages and now - self.last_activity > self.cfg["reset_after_idle_s"]:
            log.info("Nouvelle conversation (silence de plus de %d s)", self.cfg["reset_after_idle_s"])
            self.reset()
        elif len(self.messages) > self.cfg["max_history_messages"]:
            log.info("Nouvelle conversation (historique trop long)")
            self.reset()
        self.last_activity = now

    def _create(self):
        return self.client.beta.messages.create(
            model=self.cfg["model"],
            max_tokens=self.cfg["max_tokens"],
            system=self.system,
            tools=TOOLS,
            messages=self.messages,
            output_config={"effort": self.cfg["effort"]},
            cache_control={"type": "ephemeral"},
            # si Claude refuse une demande, l'API la relance sur le modèle de secours recommandé
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )

    def ask(self, text):
        """Envoie la phrase entendue à Claude, exécute ses gestes, le fait parler.

        Renvoie le texte prononcé, ou None si Claude est injoignable
        (l'appelant peut alors se rabattre sur le chatbot d'InMoov2).
        """
        self._maybe_reset()
        self.messages.append({"role": "user", "content": text})
        spoken = []
        try:
            for _ in range(self.cfg["max_tool_rounds"]):
                response = self._create()
                if response.stop_reason == "refusal":
                    log.warning("Demande refusée par Claude : %s", getattr(response, "stop_details", None))
                    self.reset()
                    self.speak("Je préfère ne pas répondre à cette question.")
                    return "refus"

                # on renvoie le contenu tel quel (blocs de réflexion compris)
                self.messages.append({"role": "assistant", "content": response.content})
                text_out = " ".join(b.text for b in response.content if b.type == "text").strip()
                if text_out:
                    spoken.append(text_out)
                    self.speak(text_out)

                tool_uses = [b for b in response.content if b.type == "tool_use"]
                if response.stop_reason == "max_tokens" and tool_uses:
                    # appel d'outil coupé : l'historique serait invalide, on repart à zéro
                    log.warning("Réponse coupée (max_tokens) pendant un appel d'outil")
                    self.reset()
                    break
                if response.stop_reason != "tool_use" or not tool_uses:
                    break
                results = [self._tool_result(b) for b in tool_uses]
                self.messages.append({"role": "user", "content": results})
            else:
                log.warning("Trop d'allers-retours d'outils, on s'arrête")
        except anthropic.APIConnectionError as e:
            log.error("Pas de connexion à l'API Claude : %s", e)
            self.reset()
            return None
        except anthropic.AuthenticationError:
            log.error("Clé ANTHROPIC_API_KEY absente ou invalide")
            self.reset()
            return None
        except anthropic.RateLimitError:
            log.warning("Limite de requêtes atteinte")
            self.reset()
            self.speak("Laisse-moi souffler une petite minute.")
            return "limite"
        except anthropic.APIStatusError as e:
            log.error("Erreur API Claude %s : %s", e.status_code, e.message)
            self.reset()
            return None
        return " ".join(spoken)

    def _tool_result(self, block):
        try:
            ok, message = self._run_tool(block.name, block.input)
        except (KeyError, TypeError, ValueError) as e:
            ok, message = False, "arguments invalides : %s" % e
        log.info("Outil %s%s -> %s", block.name, dict(block.input), message)
        result = {"type": "tool_result", "tool_use_id": block.id, "content": message}
        if not ok:
            result["is_error"] = True
        return result

    def _run_tool(self, name, args):
        c = self.cfg
        if name == "move_head":
            rot = _clamp(float(args["rothead"]), c["rothead_min"], c["rothead_max"])
            neck = _clamp(float(args["neck"]), c["neck_min"], c["neck_max"])
            ok1, _ = self.call(c["rothead_service"], "moveTo", rot)
            ok2, _ = self.call(c["neck_service"], "moveTo", neck)
            ok = ok1 and ok2
            return ok, ("tête tournée (rothead=%.0f, neck=%.0f)" % (rot, neck)) if ok else "MyRobotLab injoignable"
        if name == "hand":
            service = c["left_hand_service"] if args["side"] == "left" else c["right_hand_service"]
            if args["action"] not in ("open", "close", "rest"):
                raise ValueError(args["action"])
            ok, _ = self.call(service, args["action"])
            return ok, "fait" if ok else "MyRobotLab injoignable"
        if name == "rest_position":
            ok, _ = self.call(c["robot_service"], "rest")
            return ok, "fait" if ok else "MyRobotLab injoignable"
        return False, "outil inconnu : %s" % name


def _clamp(value, lo, hi):
    return max(float(lo), min(float(hi), value))
