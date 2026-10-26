#!/usr/bin/env python3
"""Diagnostic des alertes du mode garde : trouve le maillon qui bloque, de Kamil jusqu'aux téléphones.

    cd ~/domokami/inmoov && .venv-voice/bin/python tools/check_alerts.py          # vérifie tout
    cd ~/domokami/inmoov && .venv-voice/bin/python tools/check_alerts.py --test   # + notification de test

Maillons vérifiés :
  1. Kamil : version à jour, mode garde, alertes 🚨 dans son journal, envois aux téléphones ;
  2. MQTT : l'entité « Dernière alerte » est annoncée à Home Assistant et porte la dernière alerte ;
  3. Home Assistant : l'entité existe, les services notify des téléphones existent ;
  4. (--test) une notification de test part vers chaque téléphone, avec la réponse de Home Assistant.
Aucun secret n'est affiché (seulement « présent » / « absent »).
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "app"))
from launcher import read_env_file  # noqa: E402

OK, KO, INFO = "✅", "❌", "ℹ️ "


def say(mark, text):
    print("%s %s" % (mark, text))


def tail(path, needles, n=6):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 400000))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    return [ln for ln in lines if any(k in ln for k in needles)][-n:]


def check_kamil(cfg):
    print("\n— 1. Kamil —")
    log_path = os.path.join(ROOT, "app", "data", "logs", "voice.log")
    started = tail(log_path, ["À l'écoute"], 1)
    if started is None:
        say(KO, "pas de journal %s : la voix n'a pas été lancée depuis l'Atelier" % log_path)
        return
    say(OK if started else KO, "voix lancée" + (" : " + started[0][:19] if started else " ? (aucun « À l'écoute »)"))
    fresh = tail(log_path, ["Whisper prêt"], 1)
    say(OK if fresh else KO, "version à jour" if fresh else
        "ancienne version de la voix : git pull puis redémarrer « Kamil : voix et IA »")
    watch = (cfg.get("brain") or {}).get("watch") or {}
    services = watch.get("notify_service") or []
    services = [services] if isinstance(services, str) else services
    say(INFO, "téléphones prévenus directement par Kamil : %s" % (", ".join(services) or "aucun (notify_service vide)"))
    garde = tail(log_path, ["Mode garde activé", "Mode garde désactivé", "Mode garde toujours actif"], 1)
    say(INFO, "dernier changement du mode garde : %s" % (garde[0][:19] + " " + garde[0].split("INFO", 1)[-1].strip()
                                                         if garde else "aucun dans ce journal"))
    alerts = tail(log_path, ["🚨"], 3)
    say(OK if alerts else KO, "alertes 🚨 du mode garde : %d récente(s)" % len(alerts) if alerts else
        "aucune alerte 🚨 : mode garde activé ? caméras lancées ? attendre 30 s devant Kamil")
    for line in alerts or []:
        print("     " + line[:19] + " " + line.split("🚨", 1)[1].strip())
    for line in tail(log_path, ["Alerte envoyée", "Alerte non envoyée"], 6) or []:
        print("     " + line[:19] + " " + line.split("voice", 1)[-1].strip())


def check_mqtt(cfg, env):
    print("\n— 2. MQTT (Kamil → Home Assistant) —")
    m = cfg.get("mqtt") or {}
    if not m.get("enabled"):
        say(KO, "mqtt.enabled est false : Home Assistant ne reçoit rien de Kamil")
        return
    try:
        sys.path.insert(0, os.path.join(ROOT, "voice"))
        from ha_mqtt import make_client
    except Exception as e:
        say(KO, "paho-mqtt introuvable (%s) : lancer avec .venv-voice/bin/python" % e)
        return
    base = (m.get("base_topic") or "kamil").strip("/")
    prefix = m.get("discovery_prefix") or "homeassistant"
    want = {"%s/sensor/kamil/alerte/config" % prefix: "annonce de l'entité « Dernière alerte »",
            "%s/alerte" % base: "dernière alerte publiée", "%s/disponible" % base: "Kamil en ligne",
            "%s/garde" % base: "mode garde"}
    got = {}
    client = make_client("kamil-diagnostic-%d" % os.getpid())
    user = env.get(m.get("username_env") or "MQTT_USERNAME") or os.environ.get("MQTT_USERNAME", "")
    if user:
        client.username_pw_set(user, env.get(m.get("password_env") or "MQTT_PASSWORD")
                               or os.environ.get("MQTT_PASSWORD", ""))
    client.on_message = lambda c, u, msg: got.__setitem__(msg.topic, msg.payload.decode("utf-8", "replace"))
    try:
        client.connect(m.get("host") or "homeassistant.local", int(m.get("port") or 1883), 10)
    except Exception as e:
        say(KO, "connexion à %s:%s impossible : %s" % (m.get("host"), m.get("port"), e))
        return
    for topic in want:
        client.subscribe(topic)
    client.loop_start()
    time.sleep(3)
    client.loop_stop()
    client.disconnect()
    for topic, label in want.items():
        value = got.get(topic)
        if topic.endswith("/config"):
            say(OK if value else KO, label + (" : présente" if value else
                " : absente → Kamil n'est pas à jour, ou pas reconnecté depuis la mise à jour"))
        else:
            say(OK if value else INFO, "%s : %s" % (label, value[:80] if value else "rien (jamais publié)"))


def ha_get(url, token, path):
    req = urllib.request.Request(url + path, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check_ha(cfg, env, test):
    print("\n— 3. Home Assistant —")
    ha = (cfg.get("brain") or {}).get("home_assistant") or {}
    token = env.get("HOME_ASSISTANT_TOKEN") or os.environ.get("HOME_ASSISTANT_TOKEN", "")
    url = (ha.get("url") or "").rstrip("/")
    say(OK if ha.get("enabled") else KO, "brain.home_assistant.enabled : %s" % bool(ha.get("enabled")))
    say(OK if token else KO, "jeton HOME_ASSISTANT_TOKEN dans anthropic.env : %s" % ("présent" if token else "absent"))
    if not (url and token):
        say(KO, "impossible de vérifier Home Assistant sans adresse ni jeton : vérifie l'entité à la main "
                "(Outils de développement → États → kamil_derniere_alerte)")
        return
    try:
        states = ha_get(url, token, "/api/states")
    except urllib.error.HTTPError as e:
        say(KO, "Home Assistant a répondu %d (%s)" % (e.code, "jeton refusé" if e.code == 401 else url))
        return
    except (urllib.error.URLError, OSError, ValueError) as e:
        say(KO, "Home Assistant injoignable à %s : %s" % (url, getattr(e, "reason", e)))
        return
    say(OK, "Home Assistant joignable : %s" % url)
    kamil = {s["entity_id"]: s.get("state") for s in states if "kamil" in s["entity_id"]}
    alert = [e for e in kamil if e.startswith("sensor.") and "alerte" in e]
    cams = [e for e in kamil if e.startswith("camera.")]
    say(OK if alert else KO, "entité de l'alerte : %s" % (", ".join("%s = %s" % (e, kamil[e]) for e in alert)
                                                         if alert else "introuvable → l'automatisation ne se déclenche jamais"))
    if alert and alert[0] != "sensor.kamil_derniere_alerte":
        say(KO, "nom différent de celui de l'automatisation : remplace sensor.kamil_derniere_alerte par %s" % alert[0])
    say(INFO, "caméras : %s" % (", ".join(cams) or "aucune"))
    watch = (cfg.get("brain") or {}).get("watch") or {}
    phones = watch.get("notify_service") or []
    phones = [phones] if isinstance(phones, str) else phones
    try:
        services = ha_get(url, token, "/api/services")
        notify = {"notify." + n for d in services if d.get("domain") == "notify" for n in d.get("services", {})}
    except Exception:
        notify = set()
    phones = phones or sorted(s for s in notify if s.startswith("notify.mobile_app_"))
    for p in phones:
        say(OK if p in notify else KO, "service %s %s" % (p, "existe" if p in notify else "INTROUVABLE"))
    if not test:
        say(INFO, "relance avec --test pour envoyer une notification de test à chaque téléphone")
        return
    print("\n— 4. Notification de test —")
    for p in phones:
        domain, name = p.split(".", 1)
        body = json.dumps({"title": "🧪 Kamil – test", "message": "Test des alertes du mode garde",
                           "data": {"priority": "high", "ttl": 0, "channel": "Alarme Kamil"}}).encode("utf-8")
        req = urllib.request.Request("%s/api/services/%s/%s" % (url, domain, name), data=body, method="POST",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=8):
                say(OK, "%s : envoyée (si rien n'arrive : notifications de l'appli Home Assistant sur ce téléphone)" % p)
        except urllib.error.HTTPError as e:
            say(KO, "%s : Home Assistant a répondu %d %s" % (p, e.code, e.read().decode("utf-8", "replace")[:120]))
        except (urllib.error.URLError, OSError) as e:
            say(KO, "%s : %s" % (p, getattr(e, "reason", e)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--test", action="store_true", help="envoie une notification de test à chaque téléphone")
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)
    env = read_env_file(os.path.join(ROOT, "anthropic.env"))
    check_kamil(cfg)
    check_mqtt(cfg, env)
    check_ha(cfg, env, args.test)
    print()


if __name__ == "__main__":
    main()
