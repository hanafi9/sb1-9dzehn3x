#!/usr/bin/env python3
"""Bilan de santé de Kamil dans le terminal (le même que le bouton « 🩺 Tout vérifier » de l'Atelier).

    python3 ~/domokami/inmoov/tools/check_all.py            # vérifie tout
    python3 ~/domokami/inmoov/tools/check_all.py --start    # démarre d'abord les programmes arrêtés

Programmes, caméras, Coral, son, voix, clés, Home Assistant, MQTT, température, alimentation, version.
"""

import json
import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8090"
ICON = {"ok": "✅", "warn": "⚠️ ", "bad": "❌"}


def call(path, method="GET", timeout=40):
    req = urllib.request.Request(URL + path, method=method, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    try:
        if "--start" in sys.argv:
            r = call("/api/programs/all/start", "POST", timeout=120)
            print("Démarrage : " + ", ".join("%s %s" % kv for kv in r["results"].items()))
            print("(30 s pour que tout se lance…)")
            time.sleep(30)
        r = call("/api/check")
    except (urllib.error.URLError, OSError) as e:
        print("❌ L'Atelier ne répond pas (%s)." % getattr(e, "reason", e))
        print("   → sudo systemctl restart inmoov-app   puis   sudo systemctl status inmoov-app")
        return 1
    group = None
    for c in r["checks"]:
        if c["group"] != group:
            group = c["group"]
            print("\n— %s —" % group)
        print("%s %s : %s" % (ICON[c["status"]], c["name"], c["detail"]))
        if c["fix"]:
            print("     → %s" % c["fix"])
    print("\n%s" % ("✅ Tout va bien" if not r["bad"] else "❌ %d problème(s)" % r["bad"])
          + (", ⚠️  %d à surveiller" % r["warn"] if r["warn"] else ""))
    return 1 if r["bad"] else 0


if __name__ == "__main__":
    sys.exit(main())
