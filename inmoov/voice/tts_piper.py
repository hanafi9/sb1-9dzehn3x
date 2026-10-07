"""Voix française hors ligne avec Piper (paquet piper-tts).

Voix françaises disponibles (liste officielle VOICES.md de Piper) :
fr_FR-tom-medium (homme), fr_FR-siwis-medium / -low (femme), fr_FR-upmc-medium,
fr_FR-gilles-low, fr_FR-mls-medium.

Téléchargement d'une voix (une seule fois) :
    python -m piper.download_voices --download-dir ../models fr_FR-tom-medium

Lecture du son avec « aplay » (paquet alsa-utils, installé sur Raspberry Pi OS).
"""

import logging
import os
import subprocess
import tempfile
import wave

log = logging.getLogger("piper")


class PiperSpeaker:
    def __init__(self, model_path, player=("aplay", "-q"), length_scale=None):
        from piper import PiperVoice  # importé seulement si cette voix est choisie

        if not os.path.isfile(model_path):
            raise FileNotFoundError("voix Piper introuvable : %s" % model_path)
        self.voice = PiperVoice.load(model_path)
        self.player = list(player)
        self.syn_config = None
        if length_scale:
            from piper import SynthesisConfig

            self.syn_config = SynthesisConfig(length_scale=length_scale)

    def speak(self, text):
        """Prononce le texte et renvoie sa durée en secondes (bloquant)."""
        fd, path = tempfile.mkstemp(suffix=".wav", prefix="inmoov-")
        os.close(fd)
        try:
            with wave.open(path, "wb") as wav:
                self.voice.synthesize_wav(text, wav, syn_config=self.syn_config)
            with wave.open(path, "rb") as wav:
                duration = wav.getnframes() / float(wav.getframerate())
            subprocess.run(self.player + [path], check=False, timeout=duration + 10)
            return duration
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
