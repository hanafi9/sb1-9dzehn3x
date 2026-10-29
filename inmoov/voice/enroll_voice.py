#!/usr/bin/env python3
"""Apprendre à Kamil à reconnaître une voix (empreinte vocale gardée sur le Pi).

Arrêtez d'abord la voix (speech_listener.py) : le micro ne sert qu'à un programme à la fois.

    ../.venv-voice/bin/python enroll_voice.py Sam           # enregistre 6 phrases de Sam
    ../.venv-voice/bin/python enroll_voice.py --test        # qui parle ? (scores de chaque voix)
    ../.venv-voice/bin/python enroll_voice.py --list        # voix connues
    ../.venv-voice/bin/python enroll_voice.py --forget Sam

Le modèle d'empreinte (~27 Mo) est téléchargé la première fois dans ../models.
Refaire l'enregistrement d'une personne ajoute des phrases (utile si elle est mal reconnue).
"""

import argparse
import os
import sys
import urllib.request

import numpy as np
import sounddevice as sd

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, ROOT)   # mrl_client.py est dans le dossier inmoov

from audio_gain import normalize_peak  # noqa: E402
from mrl_client import load_config  # noqa: E402
from speaker_id import MODEL_NAME, MODEL_URL, SAMPLE_RATE, VoiceIdentifier, make_extractor  # noqa: E402
PHRASES = [
    "Bonjour Kamil, c'est moi, tu me reconnais ?",
    "Aujourd'hui il fait beau, on pourrait aller se promener au parc.",
    "Kamil, raconte-moi une histoire de robot qui apprend à danser.",
    "Un, deux, trois, quatre, cinq, six, sept, huit, neuf, dix.",
    "J'aime bien bricoler le week-end avec un tournevis et une perceuse.",
    "Kamil, quelle heure est-il et quel temps fera-t-il demain ?",
    "Les chaussettes de l'archiduchesse sont-elles sèches ou archisèches ?",
    "Ce soir, on mange des pâtes avec beaucoup de fromage râpé.",
]


def resolve(path):
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def ensure_model(path):
    if os.path.isfile(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print("Téléchargement du modèle d'empreinte vocale (~27 Mo)…")
    tmp = path + ".part"
    urllib.request.urlretrieve(MODEL_URL, tmp)
    os.replace(tmp, path)


def record(seconds, vcfg):
    audio = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                   device=vcfg.get("input_device"))
    sd.wait()
    audio = audio[:, 0].astype(np.float32) / 32768.0 * float(vcfg.get("input_gain", 1))
    level = 100.0 * float(np.abs(audio).max()) if len(audio) else 0.0
    if level < 5:
        print("   ⚠ niveau très faible (%.0f %%) : rapprochez-vous du micro" % level)
    return normalize_peak(np.clip(audio, -1, 1), max_gain=float(vcfg.get("auto_gain_max", 20)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", nargs="?", help="prénom de la personne à enregistrer")
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--phrases", type=int, default=6)
    parser.add_argument("--seconds", type=float, default=4.5)
    parser.add_argument("--test", action="store_true", help="qui parle ? affiche le score de chaque voix")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--forget", metavar="PRÉNOM")
    args = parser.parse_args()

    cfg = load_config(args.config)
    vcfg = cfg["voice"]
    scfg = vcfg.get("speaker_id") or {}
    model = resolve(scfg.get("model") or "models/" + MODEL_NAME)
    ensure_model(model)
    ident = VoiceIdentifier(make_extractor(model), resolve(scfg.get("db_path") or "data/voices.json"),
                            threshold=float(scfg.get("threshold", 0.55)))

    if args.list:
        print("Voix connues :", ", ".join("%s (%d phrases)" % (n, len(ident.voices[n]["samples"]))
                                          for n in ident.names()) or "aucune")
        return 0
    if args.forget:
        print("Voix oubliée." if ident.forget(args.forget) else "Voix inconnue : %s" % args.forget)
        return 0
    if args.test or not args.name:
        if not ident.names():
            print("Aucune voix enregistrée : enroll_voice.py <prénom>")
            return 1
        input("\nEntrée, puis parlez %.0f s (n'importe quelle phrase)…" % args.seconds)
        scores = ident.scores(record(args.seconds, vcfg))
        for name, score in sorted(scores.items(), key=lambda kv: -kv[1]):
            print("   %-15s %.2f%s" % (name, score, "  ← reconnu" if score >= ident.threshold else ""))
        print("Seuil actuel : %.2f (config.json → voice → speaker_id → threshold)" % ident.threshold)
        return 0

    print("Enregistrement de la voix de %s : %d phrases de %.0f s. Parlez normalement, à votre "
          "distance habituelle du robot." % (args.name, args.phrases, args.seconds))
    audios = []
    for i in range(args.phrases):
        input("\nEntrée, puis dites : « %s »" % PHRASES[i % len(PHRASES)])
        audios.append(record(args.seconds, vcfg))
    n = ident.enroll(args.name, audios)
    print("\n%d phrase(s) retenue(s) pour %s." % (n, args.name))
    if n == 0:
        print("Aucune phrase utilisable : vérifiez le micro (niveau) puis recommencez.")
        return 1

    input("\nVérification : Entrée, puis dites une phrase nouvelle, au choix…")
    scores = ident.scores(record(args.seconds, vcfg))
    for name, score in sorted(scores.items(), key=lambda kv: -kv[1]):
        print("   %-15s %.2f%s" % (name, score, "  ← reconnu" if score >= ident.threshold else ""))
    if scores.get(args.name, 0) < ident.threshold:
        print("Pas encore reconnu : relancez enroll_voice.py %s pour ajouter des phrases." % args.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
