"""Traitement du texte reconnu : mot de réveil, commandes, filtres anti-erreurs."""

import difflib
import html
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


def is_hallucination(text, vocabulary=""):
    """Vrai pour les phrases que Whisper invente sur du bruit :
    sous-titres connus, mots répétés en boucle (« 200, 200, 200… »), ou simple
    récitation des mots du vocabulaire qu'on lui a donné (« au revoir, regarde, gauche… »)."""
    n = normalize(text).strip(" .")
    if not n:
        return True
    if any(n == normalize(h).strip(" .") for h in HALLUCINATIONS):
        return True
    words = n.split()
    if len(words) >= 6:
        # répétition : peu de mots différents, ou un même mot plus de 4 fois de suite
        if len(set(words)) <= len(words) / 3:
            return True
        run = 1
        for a, b in zip(words, words[1:]):
            run = run + 1 if a == b else 1
            if run >= 4:
                return True
    vocab = set(normalize(vocabulary).replace(",", " ").split())
    if vocab and len(words) >= 4 and all(w in vocab for w in words):
        return True
    return False


def clean_chatbot_reply(reply):
    """Réponse du chatbot d'InMoov2 prête à être dite : sans balises HTML (« <img src=…/> »).

    Renvoie None s'il ne reste rien à prononcer.
    """
    if not isinstance(reply, str):
        return None
    text = html.unescape(re.sub(r"<[^>]*>", " ", reply))
    text = re.sub(r"\s+([.,])", r"\1", re.sub(r"\s+", " ", text)).strip()
    return text or None


def find_wake_word_anywhere(text, wake_words, threshold=0.9):
    """Cherche un mot de réveil n'importe où dans la phrase (ex. « … la télé… Kamil, allume le lustre »).

    Renvoie ce qui suit sa dernière apparition, ou None. Seuil plus strict qu'au début de la
    phrase, pour que « famille » ne passe pas pour « Camille » au milieu des informations.
    """
    original = [w for w in text.split() if normalize(w)]
    words = [normalize(w) for w in original]
    targets = [normalize(w).replace(" ", "") for w in wake_words or []]
    for start in range(len(words) - 1, -1, -1):
        for size in (1, 2):
            chunk = "".join(words[start:start + size])
            if chunk and any(difflib.SequenceMatcher(None, chunk, t).ratio() >= threshold for t in targets):
                return " ".join(original[start + size:]).lstrip(" ,.;:!?")
    return None


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


class SentenceSplitter:
    """Découpe un texte qui arrive par morceaux (réponse de Claude en direct) en phrases.

    Le robot peut ainsi dire la première phrase pendant que Claude écrit la suite.
    Une phrase se termine par . ! ? … ou : suivi d'un espace, ou par un retour à la ligne.
    """

    END = re.compile(r"(?<=[.!?…:])\s+|\n+")

    def __init__(self, min_chars=12):
        self.buffer = ""
        self.min_chars = min_chars  # évite de dire « 3. » ou « M. » tout seuls

    def feed(self, chunk):
        """Ajoute un morceau ; renvoie la liste des phrases désormais complètes."""
        self.buffer += chunk
        sentences, start = [], 0
        for m in self.END.finditer(self.buffer):
            sentence = self.buffer[start:m.start()].strip()
            if len(sentence) >= self.min_chars or (sentence and m.group().count("\n")):
                sentences.append(sentence)
                start = m.end()
        self.buffer = self.buffer[start:]
        return sentences

    def flush(self):
        """Fin du texte : renvoie ce qui reste (ou une chaîne vide)."""
        rest, self.buffer = self.buffer.strip(), ""
        return rest
