"""Reconnaître QUI parle à sa voix (empreinte vocale), entièrement sur le Pi.

Un petit modèle (sherpa-onnx + WeSpeaker ResNet34 entraîné sur VoxCeleb, voix de nombreuses
langues) transforme une phrase en « empreinte » de 256 nombres qui décrit le timbre de la
voix. Chaque personne enregistrée (voice/enroll_voice.py) a une empreinte moyenne gardée dans
data/voices.json ; une nouvelle phrase est comparée à chacune (similarité cosinus, 1 = même voix).

Ce n'est pas un verrou de sécurité : un enregistrement ou une voix très proche peut le tromper.
"""

import json
import logging
import os
import threading

import numpy as np

log = logging.getLogger("speaker")

MODEL_NAME = "wespeaker_en_voxceleb_resnet34_LM.onnx"
MODEL_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
             + MODEL_NAME)
SAMPLE_RATE = 16000


def make_extractor(model_path, threads=2):
    import sherpa_onnx  # importé seulement si la reconnaissance de voix est activée

    if not os.path.isfile(model_path):
        raise FileNotFoundError("modèle d'empreinte vocale introuvable : %s (voir enroll_voice.py)" % model_path)
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model_path, num_threads=threads,
                                                         debug=False, provider="cpu")
    return sherpa_onnx.SpeakerEmbeddingExtractor(config)


def _unit(v):
    v = np.asarray(v, dtype=np.float32)
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


class VoiceIdentifier:
    def __init__(self, extractor, db_path, threshold=0.55, min_seconds=1.0):
        """extractor : sherpa_onnx.SpeakerEmbeddingExtractor (ou un faux pour les tests)."""
        self.extractor = extractor
        self.db_path = db_path
        self.threshold = threshold
        self.min_seconds = min_seconds
        self.lock = threading.Lock()
        self.voices = self._load()     # nom -> {"samples": [[...], …]}

    # ------------------------------------------------------------ empreintes
    def embed(self, audio):
        """audio : float32 de -1 à 1, 16 kHz. Renvoie l'empreinte normalisée, ou None si trop court."""
        if len(audio) < self.min_seconds * SAMPLE_RATE:
            return None
        stream = self.extractor.create_stream()
        stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=np.asarray(audio, dtype=np.float32))
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return None
        return _unit(self.extractor.compute(stream))

    def scores(self, audio):
        """Similarité de cette phrase avec chaque voix connue : {nom: -1..1}."""
        emb = self.embed(audio)
        if emb is None:
            return {}
        with self.lock:
            return {name: float(np.dot(emb, self._mean(v))) for name, v in self.voices.items()}

    def identify(self, audio):
        """(nom, score) de la voix la plus proche si elle dépasse le seuil, sinon (None, meilleur score)."""
        scores = self.scores(audio)
        if not scores:
            return None, None
        name, best = max(scores.items(), key=lambda kv: kv[1])
        return (name if best >= self.threshold else None), best

    # ------------------------------------------------------------ voix connues
    def enroll(self, name, audios):
        """Ajoute des phrases à la voix de name ; renvoie le nombre de phrases utilisables."""
        name = " ".join(str(name).split())[:40]
        if not name:
            raise ValueError("prénom vide")
        embs = [e for e in (self.embed(a) for a in audios) if e is not None]
        if not embs:
            return 0
        with self.lock:
            entry = self.voices.setdefault(name, {"samples": []})
            entry["samples"] = (entry["samples"] + [e.round(5).tolist() for e in embs])[-30:]
            self._save()
        return len(embs)

    def forget(self, name):
        with self.lock:
            removed = self.voices.pop(name, None) is not None
            self._save()
        return removed

    def names(self):
        return sorted(self.voices)

    @staticmethod
    def _mean(entry):
        return _unit(np.mean(np.asarray(entry["samples"], dtype=np.float32), axis=0))

    def _load(self):
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {k: v for k, v in data.items() if isinstance(v, dict) and v.get("samples")}
        except (OSError, ValueError, AttributeError):
            return {}

    def _save(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        tmp = self.db_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.voices, f)
        os.replace(tmp, self.db_path)
