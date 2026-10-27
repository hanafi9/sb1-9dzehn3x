#!/usr/bin/env python3
"""Régler la baisse du son de la télé : baisse, attend, remet, comme pendant une conversation avec Kamil.

    cd ~/domokami/inmoov && python3 tools/duck_test.py          # attend 8 s entre la baisse et la remise
    cd ~/domokami/inmoov && python3 tools/duck_test.py 15

Utilise le réglage brain.home_assistant.duck de config.json. Note la valeur affichée par l'ampli
avant, pendant et après : si elle ne revient pas à la même, ajuste "pause" ou "up_steps".
Le jeton Home Assistant (anthropic.env) n'est jamais affiché.
"""

import json
import logging
import os
import sys
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [os.path.join(ROOT, "app"), os.path.join(ROOT, "voice")]
from launcher import read_env_file  # noqa: E402
from ducking import Ducker  # noqa: E402
from home_assistant import HomeAssistant  # noqa: E402


def main():
    wait = float(sys.argv[1]) if len(sys.argv) > 1 else 8
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        ha = json.load(f)["brain"]["home_assistant"]
    devices = ha.get("duck") or []
    if not devices:
        print("brain.home_assistant.duck est vide dans config.json : rien à essayer")
        return
    token = read_env_file(os.path.join(ROOT, "anthropic.env")).get("HOME_ASSISTANT_TOKEN", "")
    home = HomeAssistant(ha["url"], token, verify_ssl=ha.get("verify_ssl", True), ca_file=ha.get("ca_file"),
                         timeout=20)
    print("Réglage :", json.dumps(devices, ensure_ascii=False))
    input("Note la valeur de l'ampli, puis Entrée pour baisser…")
    d = Ducker(home, devices)
    t = time.time()
    d.duck(wait=True)
    print("Baissé en %.1f s. Remise dans %g s…" % (time.time() - t, wait))
    time.sleep(wait)
    t = time.time()
    d.restore(wait=True)
    print("Remis en %.1f s. L'ampli doit afficher la même valeur qu'au départ." % (time.time() - t))


if __name__ == "__main__":
    main()
