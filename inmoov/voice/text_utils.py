"""Traitement du texte reconnu : mot de réveil, commandes, filtres anti-erreurs."""

import difflib
import re
import unicodedata

# Phrases que Whisper « invente » souvent en français sur du silence ou du bruit
# (il a été entraîné sur des vidéos sous-titrées).
HALLUCINATIONS = [
    "sous-titres realises par la communaute d'amara.org",
    "sous-titrage st' 501",
    "sous-titrage societe radio-canada",
    "merci d'avoir regarde cette video",
    "abonnez-vous",
    "...",
]


def normalize(text):
    """Minuscules, sans accents ni ponctuation, espaces simplifiés."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-z0-9' -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_hallucination(text):
    n = normalize(text).strip(" .")
    if not n:
        return True
    return any(n == normalize(h).strip(" .") for h in HALLUCINATIONS)


def strip_wake_word(text, wake_words, threshold=0.75):
    """Cherche un mot de réveil au début de la phrase.

    Renvoie (trouvé, reste_de_la_phrase). La comparaison est approximative
    car Whisper écrit parfois « In Move », « Inmove », « Inmouv »...
    """
    # on garde les mots d'origine (accents compris) pour le chatbot
    original = [w for w in text.split() if normalize(w)]
    words = [normalize(w) for w in original]
    if not wake_words:
        return True, text.strip()
    targets = [normalize(w).replace(" ", "") for w in wake_words]
    # on teste les 3 premiers mots, seuls ou collés par 2 (« in moov » -> « inmoov »)
    for start in range(min(3, len(words))):
        for size in (1, 2):
            chunk = "".join(words[start:start + size])
            if not chunk:
                continue
            for t in targets:
                if difflib.SequenceMatcher(None, chunk, t).ratio() >= threshold:
                    rest = " ".join(original[start + size:])
                    return True, rest.lstrip(" ,.;:!?")
    return False, text.strip()


def match_command(text, commands, threshold=0.8):
    """Trouve la commande locale la plus proche du texte reconnu.

    commands : dict { "phrase": [[service, methode, param...], ...] }
    Renvoie (phrase, actions) ou (None, None).
    """
    n = normalize(text)
    if not n:
        return None, None
    best, best_score = None, 0.0
    for phrase in commands:
        p = normalize(phrase)
        score = 1.0 if p in n else difflib.SequenceMatcher(None, n, p).ratio()
        if score > best_score:
            best, best_score = phrase, score
    if best is not None and best_score >= threshold:
        return best, commands[best]
    return None, None
