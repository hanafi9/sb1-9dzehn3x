"""Banc d'essai : tester d'un coup d'œil caméras, voix, haut-parleurs, micro et servos.

Fonctions sans Flask (testables) utilisées par l'onglet « Banc d'essai » de l'Atelier.
"""

import array
import json
import os
import subprocess
import time

SPEAKER_FILES = {
    "left": "/usr/share/sounds/alsa/Front_Left.wav",
    "right": "/usr/share/sounds/alsa/Front_Right.wav",
    "both": "/usr/share/sounds/alsa/Front_Center.wav",
}
RESULTS = ("ok", "bad", "")
# Petit programme lancé avec le Python de la voix (.venv-voice), où Piper est installé
PIPER_SNIPPET = ("import sys; sys.path.insert(0, sys.argv[1]); from tts_piper import PiperSpeaker; "
                 "PiperSpeaker(sys.argv[2]).speak(sys.argv[3])")


def vision_paths(cfg, base):
    """Chemins des images partagées et de l'état écrit par face_tracker.py."""
    v = cfg.get("vision", {})

    def resolve(p):
        return p if not p or os.path.isabs(p) else os.path.join(base, p)

    return {
        0: resolve(v.get("share_frame_path") or "/dev/shm/inmoov_frame.jpg"),
        1: resolve(v.get("share_frame2_path") or "/dev/shm/inmoov_frame2.jpg"),
        "state": resolve(v.get("state_path") or "/dev/shm/inmoov_vision.json"),
    }


def file_age(path, now=None):
    """Âge du fichier en secondes, ou None s'il n'existe pas."""
    try:
        return (time.time() if now is None else now) - os.path.getmtime(path)
    except OSError:
        return None


def read_vision_state(path, max_age_s=5.0, now=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        return None
    now = time.time() if now is None else now
    if not isinstance(state, dict):
        return None
    state["age_s"] = round(now - float(state.get("time", 0)), 1)
    state["fresh"] = state["age_s"] <= max_age_s
    return state


def process_running(pattern, run=subprocess.run):
    """Vrai si un programme dont la ligne de commande contient pattern tourne (pgrep -f)."""
    try:
        res = run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.returncode == 0 and bool(res.stdout.strip())


def piper_command(root, cfg, text):
    """Commande qui fait dire text par la voix Piper du robot."""
    voice = cfg.get("voice", {})
    model = voice.get("piper_model") or "models/fr_FR-tom-medium.onnx"
    model = model if os.path.isabs(model) else os.path.join(root, model)
    python = os.path.join(root, ".venv-voice", "bin", "python")
    if not os.path.isfile(python):
        raise FileNotFoundError("Python de la voix absent (%s) : voir README, partie voix" % python)
    if not os.path.isfile(model):
        raise FileNotFoundError("voix Piper absente (%s) : voir README 8.2" % model)
    return [python, "-c", PIPER_SNIPPET, os.path.join(root, "voice"), model, text]


def clean_text(text, max_len=300):
    text = " ".join(str(text or "").split())
    if not text:
        raise ValueError("texte vide")
    return text[:max_len]


def mic_level(raw):
    """Niveau d'un enregistrement 16 bits mono : (crête 0-100 %, moyenne 0-100 %)."""
    samples = array.array("h")
    samples.frombytes(raw[: len(raw) // 2 * 2])
    if not samples:
        return 0.0, 0.0
    peak = max(abs(s) for s in samples)
    mean = sum(abs(s) for s in samples) / len(samples)
    return round(100.0 * peak / 32768, 1), round(100.0 * mean / 32768, 2)


def record_command(seconds):
    return ["arecord", "-q", "-d", str(int(seconds)), "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"]
