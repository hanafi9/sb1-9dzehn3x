#!/usr/bin/env python3
"""Tester le mot de réveil avec TA voix, TON micro et TA pièce (télé allumée comme d'habitude).

    curl -s -X POST http://127.0.0.1:8090/api/programs/voice/stop        # libère le micro
    cd ~/domokami/inmoov && .venv-voice/bin/python tools/wake_test.py      # 10 essais
    cd ~/domokami/inmoov && .venv-voice/bin/python tools/wake_test.py 20   # 20 essais

À chaque essai : Entrée, puis dire « Kamil » (seul ou avec une demande) pendant les 3 secondes.
Le son est reconnu par le Whisper du Pi qui repère « Kamil » (même modèle et mêmes seuils que
Kamil), de deux façons :
  - « actuel »   : comme Kamil aujourd'hui ;
  - « avec aide » : en donnant « Kamil » à Whisper comme mot attendu (réglage wake_hint).
Pour chaque essai : le texte compris, et si « Kamil » a été repéré. Le bilan dit lequel est le meilleur.
Rien n'est envoyé en ligne (pas de quota Groq utilisé).
"""

import json
import os
import sys
import time

import numpy as np
import sounddevice as sd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "voice"))
from audio_gain import amplify_pcm16, normalize_peak  # noqa: E402
from mic_input import open_mic  # noqa: E402
from text_utils import find_wake_word_anywhere, strip_wake_word, whisper_hint  # noqa: E402

RATE, FRAME, SECONDS = 16000, 480, 3.0


def record(device, gain):
    frames = []
    with open_mic(sd, device, lambda f, n, t, s: frames.append(f), RATE, FRAME):
        time.sleep(SECONDS)
    pcm = amplify_pcm16(b"".join(frames), gain)
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def recognize(model, audio, cfg):
    """Comme le repérage de Kamil : texte gardé + texte douteux ; les morceaux pris pour du silence sont perdus."""
    prompt, hint = whisper_hint(cfg)
    segments, _ = model.transcribe(audio, language=cfg.get("language", "fr"), beam_size=1, initial_prompt=prompt,
                                   condition_on_previous_text=False, temperature=0.0, without_timestamps=True,
                                   vad_filter=False, **({"hotwords": hint} if hint else {}))
    heard, lost = [], []
    for seg in segments:
        if seg.no_speech_prob > cfg.get("max_no_speech_prob", 0.6):
            lost.append(seg.text.strip())
        else:
            heard.append(seg.text.strip())
    text = " ".join(heard).strip()
    found = bool(text) and (strip_wake_word(text, cfg["wake_words"])[0]
                            or find_wake_word_anywhere(text, cfg["wake_words"], threshold=0.75) is not None)
    return text, " ".join(lost).strip(), found


def main():
    tries = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)["voice"]
    name = (cfg.get("cloud_stt") or {}).get("screen_model") or cfg["whisper_model"]
    print("Mots de réveil : %s | Whisper du Pi : %s | micro : %s" % (cfg["wake_words"], name,
                                                                    cfg.get("input_device") or "par défaut"))
    from faster_whisper import WhisperModel
    model = WhisperModel(name, device="cpu", compute_type=cfg.get("whisper_compute_type", "int8"),
                         cpu_threads=cfg.get("whisper_threads", 4))
    variants = {"actuel": dict(cfg, wake_hint=False), "avec aide": dict(cfg, wake_hint=True)}
    score = {k: 0 for k in variants}
    tty = open("/dev/tty")
    for i in range(1, tries + 1):
        print("\nEssai %d/%d : Entrée, puis dis « Kamil » (seul ou avec une demande)…" % (i, tries), end=" ", flush=True)
        tty.readline()
        print("🎤 j'écoute %g s…" % SECONDS, flush=True)
        audio = record(cfg.get("input_device"), cfg.get("input_gain", 1))
        level = int(np.abs(audio).max() * 100)
        if cfg.get("auto_gain", True):
            audio = normalize_peak(audio, max_gain=cfg.get("auto_gain_max", 20.0))
        print("   niveau du micro : %d %%%s" % (level, "  (très faible : parle plus près ?)" if level < 5 else ""))
        for label, vcfg in variants.items():
            t0 = time.time()
            text, lost, found = recognize(model, audio, vcfg)
            score[label] += found
            print("   %-10s %s « %s »%s (%.1f s)" % (label, "✅" if found else "❌", text or "—",
                                                   "  [pris pour du silence : « %s »]" % lost if lost else "",
                                                   time.time() - t0))
    print("\nBilan sur %d essais : %s" % (tries, ", ".join("%s %d/%d" % (k, v, tries) for k, v in score.items())))
    if score["avec aide"] > score["actuel"]:
        print("→ l'aide marche mieux : mettre \"wake_hint\": true dans la section voice de config.json")
    print("Ne pas oublier de relancer la voix : curl -s -X POST http://127.0.0.1:8090/api/programs/voice/start")


if __name__ == "__main__":
    main()
