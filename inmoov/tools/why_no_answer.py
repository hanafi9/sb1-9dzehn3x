#!/usr/bin/env python3
"""Pourquoi Kamil n'a pas répondu ? Résumé, phrase par phrase, de ce qu'il a entendu et de ce qu'il en a fait.

    cd ~/domokami/inmoov && python3 tools/why_no_answer.py          # les 25 dernières phrases
    cd ~/domokami/inmoov && python3 tools/why_no_answer.py 60       # les 60 dernières

Lit app/data/logs/voice.log (et voice.log.1). Pour chaque phrase captée par le micro :
heure, durée du son, texte compris, et le verdict (réponse, ignorée et pourquoi…).
"""

import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LOGS = [os.path.join(ROOT, "app", "data", "logs", n) for n in ("voice.log.1", "voice.log")]

HEARD = re.compile(r"^(\S+ \S+?),\d+ voice INFO Entendu \(([\d.]+) s audio, ([\d.]+) s calcul\) : ?(.*)$")
# (motif dans les lignes qui suivent, verdict) : le premier trouvé l'emporte
VERDICTS = [
    ("(pas de mot de réveil)", "❌ ignorée : « Kamil » pas reconnu dans la phrase"),
    ("invention de Whisper", "❌ ignorée : bruit pris pour de la parole"),
    ("parole continue sans « Kamil »", "❌ ignorée : trop longue sans « Kamil » (prise pour la télé)"),
    ("voix inconnue sans « Kamil »", "❌ ignorée : voix inconnue sans « Kamil » (prise pour la télé)"),
    ("Claude se tait", "❌ Claude a jugé que ce n'était pas pour lui"),
    ("Claude indisponible", "⚠️ Claude indisponible (crédit, Internet ?)"),
    ("Erreur API Claude", "⚠️ erreur de Claude"),
    ("IA de secours injoignable", "⚠️ IA de secours injoignable"),
    ("Claude (", "✅ réponse de Claude"),
    ("Réponse de l'IA locale", "✅ réponse de l'IA de secours"),
    ("Commande :", "✅ commande exécutée"),
    ("🔊", "✅ réponse dite"),
]


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    lines = []
    for path in LOGS:
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                lines += f.read().splitlines()
        except OSError:
            pass
    if not lines:
        print("Pas de journal de la voix (%s)" % LOGS[-1])
        return
    events = [i for i, ln in enumerate(lines) if HEARD.match(ln)]
    counts = {}
    print("%-19s %6s %6s  %-55s %s" % ("heure", "son", "calcul", "compris", "verdict"))
    for k, i in enumerate(events[-limit:]):
        when, audio, calc, text = HEARD.match(lines[i]).groups()
        nxt = events[events.index(i) + 1] if events.index(i) + 1 < len(events) else len(lines)
        block = "\n".join(lines[i + 1:nxt])
        if not text.strip():
            verdict = "❌ rien compris (bruit, ou parole trop faible)"
        else:
            verdict = next((v for motif, v in VERDICTS if motif in block), "❔ pas de réponse (voir le journal)")
        if "repérage du mot de réveil" in "\n".join(lines[max(0, i - 3):i]) and "pas de mot de réveil" in block:
            verdict += " [repérage sur le Pi]"
        counts[verdict.split(" :")[0].split(" (")[0]] = counts.get(verdict.split(" :")[0].split(" (")[0], 0) + 1
        short = (text[:52] + "…") if len(text) > 53 else text
        print("%-19s %5ss %5ss  %-55s %s" % (when, audio, calc, "« %s »" % short if text else "—", verdict))
    print("\nBilan :", ", ".join("%s × %d" % (v, n) for v, n in sorted(counts.items(), key=lambda x: -x[1])))
    slow = [float(HEARD.match(lines[i]).group(3)) for i in events[-limit:]]
    if slow:
        print("Calcul de la reconnaissance : moyenne %.1f s, maximum %.1f s" % (sum(slow) / len(slow), max(slow)))


if __name__ == "__main__":
    main()
