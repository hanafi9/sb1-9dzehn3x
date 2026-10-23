"""Mémoire des conversations (« souvenirs d'épisodes »).

À la fin de chaque conversation, Claude en écrit un résumé de deux ou trois phrases
(qui, de quoi on a parlé, ce qui reste à faire). Les derniers résumés sont donnés au
début de la conversation suivante, pour que le robot puisse dire « la dernière fois, tu
me parlais de… ». Stocké en clair dans un fichier JSON sur le Pi, effaçable à tout moment.
"""

import json
import logging
import os
import threading
import time

log = logging.getLogger("episodes")

MAX_EPISODES = 100
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
        "octobre", "novembre", "décembre"]

SUMMARY_PROMPT = """Voici la transcription d'une conversation orale entre un robot humanoïde et une ou
plusieurs personnes. Résume-la pour la mémoire du robot : en deux ou trois phrases, qui était là
(prénoms si connus), de quoi on a parlé, ce que les personnes ont ressenti ou demandé, et ce qui
reste à faire ou promis. Écris au passé, à la deuxième personne (« tu as parlé avec… »)."""

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "people": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "people"],
    "additionalProperties": False,
}


def french_datetime(ts):
    t = time.localtime(ts)
    return "%s %d %s à %d h %02d" % (JOURS[t.tm_wday], t.tm_mday, MOIS[t.tm_mon - 1], t.tm_hour, t.tm_min)


class EpisodeStore:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def add(self, summary, people, when=None):
        summary = " ".join(str(summary).split())[:600]
        if not summary:
            return False
        with self.lock:
            episodes = self.load()
            episodes.append({"time": when or time.time(), "summary": summary,
                             "people": [" ".join(str(p).split())[:60] for p in people][:10]})
            episodes = episodes[-MAX_EPISODES:]
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(episodes, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
        return True

    def as_text(self, n=8):
        lines = []
        for e in self.load()[-n:]:
            who = (" (avec %s)" % ", ".join(e["people"])) if e.get("people") else ""
            lines.append("- %s%s : %s" % (french_datetime(e["time"]), who, e["summary"]))
        return "\n".join(lines)


def transcript(messages):
    """Texte lisible de la conversation : seules les phrases dites (pas les outils ni l'état)."""
    lines = []
    for m in messages:
        role, content = m.get("role"), m.get("content")
        if role == "user" and isinstance(content, str):
            lines.append("Personne : " + content)
        elif role == "assistant":
            said = " ".join(getattr(b, "text", "") for b in content
                            if getattr(b, "type", None) == "text") if isinstance(content, list) else ""
            if said.strip():
                lines.append("Robot : " + said.strip())
    return "\n".join(lines)


def summarize(client, model, messages):
    """Un appel à Claude pour résumer ; renvoie {"summary", "people"} ou None."""
    text = transcript(messages)
    if text.count("Personne :") < 2:
        return None          # simple salut : rien à retenir
    try:
        response = client.messages.create(
            model=model,
            max_tokens=2048,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SUMMARY_SCHEMA}},
            messages=[{"role": "user", "content": SUMMARY_PROMPT + "\n\n" + text}],
        )
    except Exception as e:  # le résumé ne doit jamais faire planter le robot
        log.warning("Résumé de conversation impossible : %s", e)
        return None
    if getattr(response, "stop_reason", None) != "end_turn":
        return None
    raw = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        data = json.loads(raw)
        return {"summary": str(data["summary"]), "people": [str(p) for p in data.get("people", [])]}
    except (ValueError, KeyError, TypeError):
        return None
