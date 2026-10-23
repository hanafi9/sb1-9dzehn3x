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
import queue
import subprocess
import tempfile
import threading
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

    def synthesize(self, text):
        """Fabrique le fichier son ; renvoie (chemin du .wav, durée en secondes)."""
        fd, path = tempfile.mkstemp(suffix=".wav", prefix="inmoov-")
        os.close(fd)
        try:
            with wave.open(path, "wb") as wav:
                self.voice.synthesize_wav(text, wav, syn_config=self.syn_config)
            with wave.open(path, "rb") as wav:
                duration = wav.getnframes() / float(wav.getframerate())
        except Exception:
            _remove(path)
            raise
        return path, duration

    def play(self, path, duration):
        """Joue le fichier puis l'efface (bloquant)."""
        try:
            subprocess.run(self.player + [path], check=False, timeout=duration + 10)
        finally:
            _remove(path)

    def speak(self, text):
        """Prononce le texte et renvoie sa durée en secondes (bloquant)."""
        path, duration = self.synthesize(text)
        self.play(path, duration)
        return duration


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


class SpeechPipeline:
    """Parole phrase par phrase : la phrase suivante est fabriquée pendant que la
    précédente est jouée, pour qu'il n'y ait presque pas de blanc entre les deux.

    put(texte) rend la main tout de suite ; wait() attend que tout ait été dit.
    fallback(texte) est appelé si Piper échoue (ex. voix de MyRobotLab).
    """

    def __init__(self, speaker, fallback=None):
        self.speaker = speaker
        self.fallback = fallback
        self.texts = queue.Queue()
        self.sounds = queue.Queue()
        self.pending = 0
        self.done = threading.Condition()
        threading.Thread(target=self._synth_loop, name="piper-synth", daemon=True).start()
        threading.Thread(target=self._play_loop, name="piper-play", daemon=True).start()

    def put(self, text):
        text = (text or "").strip()
        if not text:
            return
        with self.done:
            self.pending += 1
        self.texts.put(text)

    def wait(self, timeout=120):
        with self.done:
            return self.done.wait_for(lambda: self.pending == 0, timeout)

    def _synth_loop(self):
        while True:
            text = self.texts.get()
            try:
                self.sounds.put((text,) + self.speaker.synthesize(text))
            except Exception:
                log.exception("Voix Piper en échec")
                self.sounds.put((text, None, 0.0))

    def _play_loop(self):
        while True:
            text, path, duration = self.sounds.get()
            try:
                if path is not None:
                    self.speaker.play(path, duration)
                elif self.fallback is not None:
                    self.fallback(text)
            except Exception:
                log.exception("Lecture du son impossible")
            finally:
                with self.done:
                    self.pending -= 1
                    self.done.notify_all()
