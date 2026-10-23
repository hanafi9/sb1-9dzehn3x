#!/usr/bin/env python3
"""Écouter les voix françaises de Piper avant d'en choisir une pour le robot.

    ../.venv-voice/bin/python voices_test.py                          # les voix françaises conseillées
    ../.venv-voice/bin/python voices_test.py fr_FR-upmc-medium        # une voix (toutes ses variantes)
    ../.venv-voice/bin/python voices_test.py fr_FR-tom-medium --speeds 0.8 1.0 1.2
    ../.venv-voice/bin/python -m piper.download_voices | grep fr_     # liste officielle complète

Chaque voix manquante est téléchargée une fois dans ../models (20 à 120 Mo).
La voix et la vitesse choisies se mettent ensuite dans config.json, section voice :
piper_model, piper_speaker_id (voix à plusieurs locuteurs) et piper_length_scale (vitesse).
"""

import argparse
import json
import os
import subprocess
import sys

from tts_piper import PiperSpeaker

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, "..", "models"))
VOICES = ["fr_FR-tom-medium", "fr_FR-siwis-medium", "fr_FR-upmc-medium", "fr_FR-gilles-low", "fr_FR-mls-medium"]
SENTENCE = ("Bonjour ! Je suis Kamil, ton robot. J'ai une batterie pleine, des vis bien serrées "
            "et une grande envie de discuter. On commence ?")


def ensure(voice):
    model = os.path.join(MODELS, voice + ".onnx")
    if not os.path.isfile(model):
        print("  téléchargement de %s…" % voice)
        subprocess.run([sys.executable, "-m", "piper.download_voices", "--download-dir", MODELS, voice], check=False)
    return model if os.path.isfile(model) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("voices", nargs="*", default=VOICES)
    parser.add_argument("--speeds", nargs="+", type=float, default=[1.0],
                        help="length_scale : 0.8 = plus rapide, 1.2 = plus lent")
    parser.add_argument("--max-speakers", type=int, default=4, help="variantes essayées par voix à plusieurs locuteurs")
    parser.add_argument("--text", default=SENTENCE)
    args = parser.parse_args()
    os.makedirs(MODELS, exist_ok=True)
    for voice in args.voices:
        model = ensure(voice)
        if model is None:
            print("%s : introuvable (nom exact ? voir : python -m piper.download_voices | grep fr_)" % voice)
            continue
        with open(model + ".json", encoding="utf-8") as f:
            speakers = json.load(f).get("speaker_id_map") or {}
        ids = sorted(speakers.items(), key=lambda kv: kv[1])[:args.max_speakers] or [("", None)]
        for name, sid in ids:
            for speed in args.speeds:
                label = "%s%s, vitesse %.1f" % (voice, " (locuteur %d : %s)" % (sid, name) if sid is not None else "",
                                                 speed)
                input("\nEntrée pour écouter : %s" % label)
                PiperSpeaker(model, length_scale=speed if speed != 1.0 else None, speaker_id=sid).speak(args.text)
    print("\nPour garder une voix : config.json → voice → \"piper_model\": \"models/<voix>.onnx\", "
          "\"piper_speaker_id\": <numéro ou null>, \"piper_length_scale\": <vitesse ou null>")


if __name__ == "__main__":
    main()
