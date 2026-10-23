#!/usr/bin/env python3
"""Comparer les modèles Whisper sur VOTRE voix et VOTRE micro, avant d'en changer.

Arrêtez d'abord la voix (speech_listener.py) : le micro ne peut servir qu'à un programme.

    ../.venv-voice/bin/python whisper_test.py                    # 3 phrases, modèles base et small
    ../.venv-voice/bin/python whisper_test.py --models base small medium --phrases 2

Pour chaque phrase enregistrée, affiche le texte reconnu et le temps de calcul de chaque
modèle. Le 1er essai d'un modèle le télécharge (base ~150 Mo, small ~480 Mo, medium ~1,5 Go).
"""

import argparse
import json
import os
import time
import wave

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel

from audio_gain import normalize_peak

RATE = 16000
PHRASES = ["Kamil, quelle heure est-il ?", "Kamil, raconte-moi une histoire courte.",
           "Kamil, regarde à gauche puis lève la main droite.", "Kamil, comment s'appelle ton créateur ?"]


def record(seconds, device):
    audio = sd.rec(int(seconds * RATE), samplerate=RATE, channels=1, dtype="int16", device=device)
    sd.wait()
    return audio[:, 0]


def level(audio):
    peak = int(np.abs(audio).max()) if len(audio) else 0
    return 100.0 * peak / 32768


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "..", "config.json"))
    parser.add_argument("--models", nargs="+", default=["base", "small"])
    parser.add_argument("--beams", nargs="+", type=int, default=[1])
    parser.add_argument("--phrases", type=int, default=3)
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--wav", nargs="+", help="réutiliser des enregistrements (ex. /tmp/kamil-essai-*.wav)")
    parser.add_argument("--no-gain", action="store_true", help="sans l'amplification automatique")
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as f:
        vcfg = json.load(f)["voice"]

    clips = []
    for i, path in enumerate(args.wav or []):
        with wave.open(path, "rb") as w:
            audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        print("%s : niveau %.0f %%" % (path, level(audio)))
        clips.append((PHRASES[i % len(PHRASES)], audio.astype(np.float32) / 32768.0, path))
    for i in range(0 if args.wav else args.phrases):
        phrase = PHRASES[i % len(PHRASES)]
        input("\nAppuyez sur Entrée puis dites : « %s » (%d s)" % (phrase, args.seconds))
        audio = record(args.seconds, vcfg.get("input_device"))
        lvl = level(audio)
        note = " ← trop faible : rapprochez-vous ou montez le micro (alsamixer -c 2, F4)" if lvl < 10 else \
            " ← saturé : baissez le micro (alsamixer)" if lvl > 95 else ""
        print("   niveau du micro : %.0f %%%s" % (lvl, note))
        path = "/tmp/kamil-essai-%d.wav" % (i + 1)
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(audio.tobytes())
        clips.append((phrase, audio.astype(np.float32) / 32768.0, path))
    print("\n(enregistrements gardés dans /tmp/kamil-essai-*.wav ; pour les réécouter : aplay /tmp/kamil-essai-1.wav)")

    for name in args.models:
        print("\n=== Modèle %s : chargement…" % name)
        model = WhisperModel(name, device="cpu", compute_type=vcfg.get("whisper_compute_type", "int8"),
                             cpu_threads=vcfg.get("whisper_threads", 4))
        for beam in args.beams:
            total = 0.0
            for phrase, audio, _ in clips:
                if not args.no_gain and vcfg.get("auto_gain", True):
                    audio = normalize_peak(audio, max_gain=vcfg.get("auto_gain_max", 20.0))
                t0 = time.monotonic()
                segments, _ = model.transcribe(audio, language=vcfg.get("language", "fr"), beam_size=beam,
                                               initial_prompt=vcfg.get("vocabulary") or None,
                                               condition_on_previous_text=False, temperature=0.0,
                                               without_timestamps=True, vad_filter=True)
                text = " ".join(s.text.strip() for s in segments)
                spent = time.monotonic() - t0
                total += spent
                print("  [%s, beam %d] %4.1f s  dit : %s\n%s reconnu : %s" % (name, beam, spent, phrase, " " * 22, text))
            print("  → %s beam %d : %.1f s en moyenne par phrase" % (name, beam, total / len(clips)))


if __name__ == "__main__":
    main()
