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
import time
import wave

log = logging.getLogger("piper")


class PiperSpeaker:
    def __init__(self, model_path, player=("aplay", "-q"), length_scale=None, speaker_id=None, pitch=None,
                 gain=None):
        from piper import PiperVoice  # importé seulement si cette voix est choisie

        if not os.path.isfile(model_path):
            raise FileNotFoundError("voix Piper introuvable : %s" % model_path)
        self.voice = PiperVoice.load(model_path)
        self.player = list(player)
        self.gain = float(gain or 1.0)  # > 1 : voix plus forte (petit haut-parleur, ex. Polycom)
        self.syn_config = None
        # pitch > 1 : voix plus aiguë, plus douce (son joué plus vite, compensé en faisant parler Piper
        # plus lentement : même vitesse de parole), comme la voix en ligne
        self.pitch = min(max(float(pitch or 1.0), 0.7), 1.5)
        if length_scale or speaker_id is not None or self.pitch != 1.0:
            from piper import SynthesisConfig

            # length_scale : < 1 parle plus vite, > 1 plus lentement ;
            # speaker_id : numéro de la voix dans un modèle à plusieurs voix (ex. fr_FR-upmc-medium)
            scale = (length_scale or 1.0) * self.pitch
            self.syn_config = SynthesisConfig(length_scale=scale if scale != 1.0 else None, speaker_id=speaker_id)
        self.lock = threading.Lock()   # une seule fabrication de son à la fois
        self.cache = {}                # phrases courtes déjà fabriquées : dites sans délai

    def synthesize(self, text):
        """Fabrique le fichier son ; renvoie (chemin du .wav, durée en secondes)."""
        fd, path = tempfile.mkstemp(suffix=".wav", prefix="inmoov-")
        os.close(fd)
        try:
            cached = self.cache.get(text)
            if cached is None:
                with self.lock, wave.open(path, "wb") as wav:
                    self.voice.synthesize_wav(text, wav, syn_config=self.syn_config)
                if getattr(self, "pitch", 1.0) != 1.0:
                    _repitch(path, self.pitch)
                if getattr(self, "gain", 1.0) != 1.0:
                    louder(path, self.gain)
                if len(text) <= 60:
                    with open(path, "rb") as f:
                        self.cache[text] = f.read()
            else:
                with open(path, "wb") as f:
                    f.write(cached)
            with wave.open(path, "rb") as wav:
                duration = wav.getnframes() / float(wav.getframerate())
        except Exception:
            _remove(path)
            raise
        return path, duration

    def warm_up(self, phrases):
        """Prépare en arrière-plan les phrases courtes (« Présent ! », « Hmm, voyons voir. »)."""
        def job():
            for phrase in phrases:
                try:
                    _remove(self.synthesize(phrase)[0])
                except Exception:  # pas grave : elle sera fabriquée au moment de la dire
                    log.debug("phrase non préparée : %s", phrase)
        threading.Thread(target=job, name="piper-warm", daemon=True).start()

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


def _repitch(path, pitch):
    """Même son, fréquence d'échantillonnage multipliée : joué plus vite, donc plus aigu."""
    with wave.open(path, "rb") as w:
        params, frames = w.getparams(), w.readframes(w.getnframes())
    with wave.open(path, "wb") as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(params.sampwidth)
        w.setframerate(int(round(params.framerate * pitch)))
        w.writeframes(frames)


def louder(path, gain):
    """Voix plus forte sans grésiller : son ramené au maximum, puis amplifié avec un limiteur doux
    (tanh) qui arrondit les crêtes au lieu de les couper."""
    import numpy as np

    with wave.open(path, "rb") as w:
        params, frames = w.getparams(), w.readframes(w.getnframes())
    if params.sampwidth != 2 or not frames:
        return
    x = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    peak = float(np.abs(x).max())
    if peak < 1e-4:
        return
    g = max(float(gain), 1.0)
    y = np.tanh(g * x / peak) / np.tanh(g) * 0.97
    with wave.open(path, "wb") as w:
        w.setparams(params)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


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
        self.on_play_start = None   # appelée juste avant de jouer chaque phrase (mesure du délai)
        self.on_audio = None        # appelée avec (fichier son, durée) juste avant de le jouer (bouche)
        self.on_idle = None         # appelée quand la dernière phrase de la file a fini de sonner
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
                if self.on_play_start is not None:
                    self.on_play_start(text)
                if path is not None:
                    if self.on_audio is not None:
                        try:
                            self.on_audio(path, duration)
                        except Exception:
                            log.exception("Synchronisation de la bouche impossible")
                    t0 = time.monotonic()
                    self.speaker.play(path, duration)
                    late = time.monotonic() - t0 - duration
                    if late > 0.5:   # le haut-parleur a mis du temps à démarrer : bouche en avance
                        log.warning("Son joué avec %.1f s de retard sur sa durée (%.1f s) : sortie audio lente "
                                    "(Bluetooth, HDMI, PipeWire ?)", late, duration)
                elif self.fallback is not None:
                    self.fallback(text)
            except Exception:
                log.exception("Lecture du son impossible")
            finally:
                with self.done:
                    self.pending -= 1
                    idle = self.pending == 0
                    self.done.notify_all()
                if idle and self.on_idle is not None:
                    try:
                        self.on_idle()
                    except Exception:
                        log.exception("Fin de parole : rappel en échec")
