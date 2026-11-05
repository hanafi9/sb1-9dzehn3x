#!/usr/bin/env python3
"""Essayer un micro pour Kamil : liste les micros, puis l'écoute 5 s comme Kamil (16 kHz, mono).

    cd ~/domokami/inmoov && .venv-voice/bin/python tools/mic_test.py Polycom
    cd ~/domokami/inmoov && .venv-voice/bin/python tools/mic_test.py Polycom --save   # + le met dans config.json

Arrêter la voix de Kamil avant (le micro ne sert qu'à un programme à la fois).
Le nom donné peut être un morceau du nom du micro. S'il refuse le 16 kHz, l'essai passe
par « pulse » puis « default » ; Kamil sait aussi convertir lui-même du 48 kHz (Polycom).
"""

import json
import logging
import os
import sys
import time

import numpy as np
import sounddevice as sd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "voice"))
from mic_input import open_mic  # noqa: E402  (même ouverture que Kamil : 48 kHz converti en 16 kHz)
RATE, FRAME = 16000, 480


def listen(device, seconds=5):
    peaks = []

    def cb(data, frames, t, status):
        peaks.append(int(np.abs(np.frombuffer(data, dtype=np.int16)).max()))
    with open_mic(sd, device, cb, RATE, FRAME):
        print("  Parle normalement depuis ta place habituelle…", flush=True)
        end = time.time() + seconds
        while time.time() < end:
            time.sleep(0.5)
            level = max(peaks[-16:] or [0]) * 100 // 32768
            print("  niveau %3d %% %s" % (level, "█" * (level // 3)), flush=True)
    return max(peaks or [0]) * 100 // 32768


def main():
    logging.basicConfig(level=logging.INFO, format="  %(message)s")
    name = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    print("Micros vus par Kamil :")
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            print("  %2d  %s (%d voie(s), %d Hz)" % (i, d["name"], d["max_input_channels"], d["default_samplerate"]))
    if not name:
        print("\nRelance avec un nom de micro, ex. : tools/mic_test.py Polycom")
        return
    for device in (name, "pulse", "default"):
        print("\nEssai de « %s »…" % device)
        try:
            peak = listen(device)
        except Exception as e:
            print("  refusé : %s" % e)
            continue
        print("  plus fort : %d %%  %s" % (peak, "bon niveau" if 20 <= peak <= 95 else
                                          "trop faible (rapproche-toi ou monte input_gain)" if peak < 20 else
                                          "sature (baisse input_gain)"))
        if "--save" in sys.argv:
            path = os.path.join(ROOT, "config.json")
            with open(path, encoding="utf-8") as f:
                cfg = json.load(f)
            cfg.setdefault("voice", {})["input_device"] = device
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
            print("  enregistré : voice.input_device = %r (input_gain actuel : %s)"
                  % (device, cfg["voice"].get("input_gain", 1)))
        return
    print("\nAucun essai n'a marché : envoie ce texte.")


if __name__ == "__main__":
    main()
