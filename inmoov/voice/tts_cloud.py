"""Voix en ligne (OpenAI, modèle gpt-4o-mini-tts) : plus naturelle et plus claire que Piper.

Le ton se décrit en français dans « instructions » (ex. voix d'homme mûr, posée, très claire).
API : POST https://api.openai.com/v1/audio/speech
      {"model", "voice", "input", "instructions", "response_format": "pcm", "speed"}
Réponse « pcm » : échantillons bruts 16 bits mono à 24 kHz, mis ici dans un fichier WAV.

Même interface que PiperSpeaker (synthesize / play / speak / warm_up) : la file de parole
phrase par phrase fonctionne pareil. Sans Internet ou sans clé, Piper prend le relais.
"""

import json
import logging
import os
import tempfile
import threading
import urllib.error
import urllib.request
import wave

from cloud_stt import USER_AGENT

log = logging.getLogger("tts")

DEFAULT_INSTRUCTIONS = ("Voix d'homme mûr, posée et chaleureuse, diction très claire et articulée, "
                        "français de France, rythme naturel, sourire dans la voix.")


class CloudSpeaker:
    def __init__(self, cfg, fallback=None, player=("aplay", "-q")):
        """cfg : section voice.cloud_tts ; fallback : PiperSpeaker utilisé si le service échoue."""
        self.base_url = (cfg.get("base_url") or "https://api.openai.com/v1").rstrip("/")
        self.model = cfg.get("model") or "gpt-4o-mini-tts"
        self.voice = cfg.get("voice") or "onyx"
        self.instructions = cfg.get("instructions") or DEFAULT_INSTRUCTIONS
        self.speed = cfg.get("speed")
        self.key_env = cfg.get("api_key_env") or "OPENAI_API_KEY"
        self.rate = int(cfg.get("pcm_rate", 24000))
        self.timeout = float(cfg.get("timeout_s", 8))
        self.fallback = fallback
        self.player = list(player)
        self.lock = threading.Lock()
        self.cache = {}

    def _fetch_pcm(self, text):
        key = os.environ.get(self.key_env, "")
        if not key:
            raise RuntimeError("clé %s absente (anthropic.env)" % self.key_env)
        body = {"model": self.model, "voice": self.voice, "input": text, "response_format": "pcm"}
        if self.instructions and not self.model.startswith("tts-1"):   # tts-1 ne gère pas les consignes
            body["instructions"] = self.instructions
        if self.speed:
            body["speed"] = float(self.speed)
        req = urllib.request.Request(self.base_url + "/audio/speech", data=json.dumps(body).encode("utf-8"),
                                     method="POST", headers={"Authorization": "Bearer " + key,
                                                             "Content-Type": "application/json",
                                                             "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError("voix en ligne : %d %s" % (e.code, e.read().decode("utf-8", "replace")[:150]))
        except (urllib.error.URLError, OSError) as e:
            raise RuntimeError("voix en ligne injoignable (%s)" % getattr(e, "reason", e))

    def synthesize(self, text):
        """Fichier WAV de la phrase ; renvoie (chemin, durée en secondes)."""
        pcm = self.cache.get(text)
        if pcm is None:
            try:
                pcm = self._fetch_pcm(text)
            except RuntimeError as e:
                if self.fallback is None:
                    raise
                log.warning("%s : voix Piper à la place", e)
                return self.fallback.synthesize(text)
            if len(text) <= 60:
                self.cache[text] = pcm
        fd, path = tempfile.mkstemp(suffix=".wav", prefix="inmoov-")
        os.close(fd)
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.rate)
            w.writeframes(pcm[: len(pcm) // 2 * 2])
        return path, len(pcm) / 2.0 / self.rate

    def play(self, path, duration):
        from tts_piper import _remove
        import subprocess

        try:
            subprocess.run(self.player + [path], check=False, timeout=duration + 10)
        finally:
            _remove(path)

    def speak(self, text):
        path, duration = self.synthesize(text)
        self.play(path, duration)
        return duration

    def warm_up(self, phrases):
        """Prépare en arrière-plan les phrases courtes (dites ensuite sans délai)."""
        def job():
            for phrase in phrases:
                if phrase in self.cache:
                    continue
                try:
                    self.cache[phrase] = self._fetch_pcm(phrase)
                except RuntimeError:
                    return   # pas de réseau : inutile d'insister, Piper prendra le relais
        threading.Thread(target=job, name="tts-warm", daemon=True).start()
