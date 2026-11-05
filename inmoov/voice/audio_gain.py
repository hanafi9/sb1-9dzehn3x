"""Amplification du micro quand il est trop faible (certains micros USB n'ont pas de
réglage de volume d'enregistrement : le son arrive à quelques % seulement)."""

import numpy as np


def amplify_pcm16(frame, gain):
    """Multiplie une trame audio 16 bits (octets) par gain, sans dépasser les limites."""
    if gain == 1:
        return frame
    samples = np.frombuffer(frame, dtype=np.int16).astype(np.int32) * gain
    return np.clip(samples, -32768, 32767).astype(np.int16).tobytes()


def normalize_peak(audio, target=0.7, max_gain=20.0):
    """Monte une phrase (float32 -1..1) pour que son plus fort passage atteigne target.

    max_gain évite de transformer un simple bruit de fond en vacarme.
    """
    peak = float(np.abs(audio).max()) if len(audio) else 0.0
    if peak <= 0:
        return audio
    gain = min(max_gain, target / peak)
    return audio * gain if gain > 1 else audio
