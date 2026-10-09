"""Mémoire à long terme du robot : ce qu'on lui a appris sur les personnes.

Stockée en clair dans un petit fichier JSON sur le Pi (visible et effaçable
depuis l'onglet IA de l'Atelier). Rien n'est envoyé ailleurs qu'à l'IA, au
début de chaque conversation.
"""

import json
import os
import threading
import time

MAX_FACTS = 200          # au-delà, les plus anciens sont oubliés
MAX_FACT_LENGTH = 200


class MemoryStore:
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

    def _save(self, facts):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(facts, f, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)

    def add(self, person, fact):
        person = " ".join(str(person).split())[:60] or "inconnu"
        fact = " ".join(str(fact).split())[:MAX_FACT_LENGTH]
        if not fact:
            raise ValueError("fait vide")
        with self.lock:
            facts = self.load()
            if any(f["person"].lower() == person.lower() and f["fact"].lower() == fact.lower() for f in facts):
                return False
            facts.append({"person": person, "fact": fact, "time": int(time.time())})
            self._save(facts[-MAX_FACTS:])
        return True

    def delete(self, index):
        with self.lock:
            facts = self.load()
            if not 0 <= index < len(facts):
                raise IndexError("souvenir introuvable")
            facts.pop(index)
            self._save(facts)

    def clear(self):
        with self.lock:
            self._save([])

    def as_text(self):
        """Résumé lisible, groupé par personne, pour le début de conversation."""
        by_person = {}
        for f in self.load():
            by_person.setdefault(f["person"], []).append(f["fact"])
        return "\n".join("- %s : %s" % (p, " ; ".join(fs)) for p, fs in by_person.items())
