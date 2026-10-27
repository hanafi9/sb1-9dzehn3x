#!/usr/bin/env python3
"""Pourquoi un téléphone ne reçoit pas les notifications de Home Assistant ?

    cd ~/domokami/inmoov && python3 tools/check_notify.py                      # téléphone d'Hanafi
    cd ~/domokami/inmoov && python3 tools/check_notify.py notify.mobile_app_nadia

1. passe le journal de l'application mobile de Home Assistant en mode détaillé (debug) ;
2. envoie une notification de test au téléphone ;
3. lit le journal de Home Assistant (/api/error_log) et affiche les lignes de ce téléphone,
   où se trouve la vraie raison (réseau, jeton du téléphone refusé, quota…) ;
4. remet le journal en mode normal.
Le jeton Home Assistant (anthropic.env) n'est jamais affiché.
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "app"))
from launcher import read_env_file  # noqa: E402


def main():
    service = sys.argv[1] if len(sys.argv) > 1 else "notify.mobile_app_redmi_hanafi"
    token = read_env_file(os.path.join(ROOT, "anthropic.env")).get("HOME_ASSISTANT_TOKEN", "")
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        ha = json.load(f)["brain"]["home_assistant"]
    url = ha["url"].rstrip("/")
    ctx = ssl.create_default_context()
    if not ha.get("verify_ssl", True):
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE

    def call(path, body=None, raw=False):
        req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
                                     method="POST" if body is not None else "GET",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            data = r.read()
        return data.decode("utf-8", "replace") if raw else json.loads(data or b"null")

    print("1. Journal détaillé de l'application mobile…")
    call("/api/services/logger/set_level", {"homeassistant.components.mobile_app": "debug"})
    domain, name = service.split(".", 1)
    print("2. Notification de test vers %s…" % service)
    try:
        call("/api/services/%s/%s" % (domain, name), {"title": "🧪 Kamil", "message": "Test de notification"})
        print("   Home Assistant a accepté la demande")
    except urllib.error.HTTPError as e:
        print("   Home Assistant a répondu %d : %s" % (e.code, e.read().decode("utf-8", "replace")[:200]))
    time.sleep(4)
    print("3. Lignes du journal de Home Assistant pour ce téléphone :\n")
    try:
        log = call("/api/error_log", raw=True)
    except urllib.error.HTTPError as e:
        log = ""
        print("   journal illisible (%d) : il faut un compte administrateur pour le jeton" % e.code)
    lines = log.splitlines()
    shown = 0
    for i, line in enumerate(lines):
        if "mobile_app" in line and ("notif" in line.lower() or "push" in line.lower() or "rate limit" in line):
            for extra in lines[i:i + 6]:            # la ligne et sa suite (traceback, message du relais)
                print("   " + extra[:300])
            print()
            shown += 1
    lines_kept = [ln for ln in lines if "mobile_app" in ln]
    if not shown:
        print("   aucune ligne trouvée" + (" (dernières lignes mobile_app :)" if lines_kept else ""))
        for line in lines_kept[-5:]:
            print("   " + line[:300])
    print("4. Journal remis en mode normal")
    call("/api/services/logger/set_level", {"homeassistant.components.mobile_app": "warning"})


if __name__ == "__main__":
    main()
