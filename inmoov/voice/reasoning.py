"""Réfléchir selon la question : réponse rapide pour bavarder, réflexion poussée sinon.

Le choix se fait sur le Pi, sans appel supplémentaire à l'IA, d'après la phrase entendue.
Le niveau choisi est transmis à Claude par un « effort par message » (l'historique déjà
envoyé reste en cache : pas de surcoût ni de lenteur à chaque changement).
"""

import random
import re

THINK_PATTERNS = [
    r"\bpourquoi\b", r"\bcomment (ça|ca|cela) (marche|fonctionne)", r"\bcomment (faire|on fait|je fais)",
    r"\bexplique", r"\bcalcul", r"\bcombien (font|fait|de temps|de fois|co[uû]te)", r"\br[ée]sou[ds]",
    r"\bprobl[èe]me", r"\bconseil", r"\b(que|qu'est-ce que tu) pense", r"\b[àa] ton avis", r"\bcompare",
    r"\bdiff[ée]rence", r"\bimagine", r"\binvente", r"\bhistoire", r"\bdevine", r"\b[ée]nigme",
    r"\bdevinette", r"\bmeilleur", r"\borganis", r"\bplanifi", r"\baide-moi", r"\bque faire\b",
    r"\bqu'est-ce que je (dois|devrais)", r"\bsi .+ alors\b", r"\bd[ée]cid", r"\banalys", r"\b[ée]tudie",
    r"\bque vois-tu\b", r"\bqu'est-ce que tu vois\b", r"\bregarde autour",
]
_THINK = re.compile("|".join(THINK_PATTERNS), re.IGNORECASE)

THINKING_PHRASES = ["Laisse-moi réfléchir.", "Bonne question, je réfléchis.", "Hmm, voyons voir.",
                    "Attends, je réfléchis un instant."]


def choose_effort(text, quick="low", think="high", long_words=22):
    """Niveau d'effort Claude pour cette phrase."""
    words = len(text.split())
    if _THINK.search(text) or words >= long_words:
        return think
    return quick


def thinking_phrase(rng=random):
    return rng.choice(THINKING_PHRASES)
