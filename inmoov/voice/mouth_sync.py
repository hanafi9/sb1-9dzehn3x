"""Bouche de Kamil synchronisée avec sa voix.

Juste avant de jouer une phrase, on mesure le volume du fichier son tranche par tranche (40 ms) :
c'est l'ouverture de la bouche, de 0 (fermée) à 100 (grande ouverte). L'onglet Kamil de l'Atelier
lit cette courbe (kamil_bridge.LocalBridge.mouth) et la rejoue en même temps que le haut-parleur.
"""

import wave

import numpy as np

FRAME_MS = 40
QUIET_DB = -42.0     # en dessous : bouche fermée (souffle, silence entre les mots)
LOUD_DB = -14.0      # au-dessus : bouche grande ouverte


def envelope(path, frame_ms=FRAME_MS):
    """Ouverture de la bouche (0-100) pour chaque tranche de frame_ms du fichier WAV 16 bits."""
    with wave.open(path, "rb") as w:
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(w.getnframes())
    if width != 2 or not raw:
        return []
    audio = np.frombuffer(raw[: len(raw) // (2 * channels) * 2 * channels], dtype="<i2").astype(np.float32)
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    step = max(1, int(rate * frame_ms / 1000))
    n = int(np.ceil(len(audio) / step))
    audio = np.pad(audio, (0, n * step - len(audio)))
    rms = np.sqrt(np.mean((audio.reshape(n, step) / 32768.0) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    opening = np.clip((db - QUIET_DB) / (LOUD_DB - QUIET_DB), 0.0, 1.0)
    # la bouche s'ouvre vite et se referme un peu moins vite (comme une vraie mâchoire)
    out, prev = [], 0.0
    for v in opening:
        prev = v if v > prev else prev * 0.45 + v * 0.55
        prev = 0.0 if prev < 0.03 else prev
        out.append(int(round(prev * 100)))
    return out
