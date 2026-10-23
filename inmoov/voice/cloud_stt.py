"""Reconnaissance vocale en ligne : bien plus juste et plus rapide que Whisper sur le Pi.

Même format pour plusieurs services (API « audio/transcriptions » compatible OpenAI) :
- Groq   : https://api.groq.com/openai/v1 , modèles whisper-large-v3-turbo / whisper-large-v3
- OpenAI : https://api.openai.com/v1       , modèles gpt-4o-mini-transcribe / gpt-4o-transcribe / whisper-1

La phrase (quelques secondes de son) est envoyée au service ; s'il ne répond pas (pas
d'Internet, clé absente…), le robot repasse sur le Whisper du Pi. La clé vient d'une variable
d'environnement (fichier anthropic.env, jamais envoyé sur GitHub).
"""

import io
import json
import logging
import os
import urllib.error
import urllib.request
import uuid
import wave

import numpy as np

log = logging.getLogger("stt")

PROVIDERS = {
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "whisper-large-v3-turbo",
             "api_key_env": "GROQ_API_KEY"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini-transcribe",
               "api_key_env": "OPENAI_API_KEY"},
}


class CloudError(Exception):
    pass


def wav_bytes(audio, rate=16000):
    """float32 -1..1 -> fichier WAV 16 bits mono en mémoire."""
    pcm = (np.clip(np.asarray(audio, dtype=np.float32), -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def multipart(fields, filename, data):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                      % (boundary, name, value)).encode("utf-8"))
    parts.append(('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
                  'Content-Type: audio/wav\r\n\r\n' % (boundary, filename)).encode("utf-8") + data + b"\r\n")
    parts.append(("--%s--\r\n" % boundary).encode("utf-8"))
    return b"".join(parts), "multipart/form-data; boundary=" + boundary


class CloudTranscriber:
    def __init__(self, cfg):
        """cfg : section voice.cloud_stt (provider, model, base_url, api_key_env, language, timeout_s)."""
        preset = PROVIDERS.get(cfg.get("provider", "groq"), {})
        self.base_url = (cfg.get("base_url") or preset.get("base_url", "")).rstrip("/")
        self.model = cfg.get("model") or preset.get("model")
        self.key_env = cfg.get("api_key_env") or preset.get("api_key_env", "")
        self.language = cfg.get("language", "fr")
        self.prompt = cfg.get("prompt", "")
        self.timeout = float(cfg.get("timeout_s", 6))
        if not self.base_url or not self.model:
            raise ValueError("cloud_stt : provider inconnu, donnez base_url et model")

    def transcribe(self, audio):
        """Renvoie le texte reconnu ; CloudError si le service ne répond pas correctement."""
        key = os.environ.get(self.key_env, "")
        if not key:
            raise CloudError("clé %s absente (anthropic.env)" % self.key_env)
        fields = {"model": self.model, "language": self.language, "response_format": "json", "temperature": "0"}
        if self.prompt:
            fields["prompt"] = self.prompt
        body, ctype = multipart(fields, "phrase.wav", wav_bytes(audio))
        req = urllib.request.Request(self.base_url + "/audio/transcriptions", data=body, method="POST",
                                     headers={"Authorization": "Bearer " + key, "Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200]
            raise CloudError("le service a répondu %d : %s" % (e.code, detail))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise CloudError("service injoignable (%s)" % getattr(e, "reason", e))
        if not isinstance(data, dict) or "text" not in data:
            raise CloudError("réponse inattendue")
        return str(data["text"]).strip()
