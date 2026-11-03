"""Bilan de santé de Kamil : tout vérifier d'un coup (onglet Programmes de l'Atelier, ou tools/check_all.py).

Chaque vérification renvoie {"group", "name", "status": "ok" | "warn" | "bad", "detail", "fix"} :
fix = ce qu'il faut faire, en clair. Rien de lourd ici (pas d'OpenCV, pas de Whisper) : le bilan prend
quelques secondes. Aucun secret n'est affiché (seulement « présente » / « absente »).
"""

import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request

CORAL_USB_IDS = ("1a6e:089a", "18d1:9302")


def item(group, name, status, detail, fix=""):
    return {"group": group, "name": name, "status": status, "detail": detail, "fix": fix}


def _age(path, now):
    try:
        return now - os.path.getmtime(path)
    except OSError:
        return None


def _resolve(base, p):
    return p if not p or os.path.isabs(p) else os.path.join(base, p)


def check_programs(status, autostart):
    out = []
    for name, p in status.items():
        if not p.get("installed"):
            out.append(item("Programmes", p["label"], "warn", "pas installé", p.get("problem") or ""))
            continue
        auto = name in autostart
        if p.get("running"):
            out.append(item("Programmes", p["label"], "ok" if auto else "warn",
                            "en marche" + ("" if auto else " (pas lancé au démarrage)"),
                            "" if auto else "cocher « au démarrage de l'Atelier » pour qu'il revienne seul après "
                                            "un redémarrage du Pi"))
        else:
            out.append(item("Programmes", p["label"], "bad", "arrêté",
                            "Démarrer, puis lire son Journal s'il s'arrête aussitôt"))
    return out


def check_vision(cfg, base, now, lsusb_out):
    v = cfg.get("vision") or {}
    out = []
    coral = any(i in lsusb_out for i in CORAL_USB_IDS) if lsusb_out is not None else None
    out.append(item("Vision", "Coral USB", "ok" if coral else ("warn" if coral is None else "bad"),
                    "branché" if coral else ("lsusb indisponible" if coral is None else "introuvable"),
                    "rebrancher le Coral sur un port USB 3 (bleu)" if coral is False else ""))
    for key, label in (("camera_index", "Caméra 1"), ("second_camera_index", "Caméra 2")):
        src = v.get(key)
        if src is None:
            continue
        if isinstance(src, str) and not src.isdigit() and not os.path.exists(src):
            out.append(item("Vision", label, "bad", "port introuvable : %s" % src,
                            "caméra débranchée ou changée de prise USB : nouveaux chemins avec "
                            "ls -l /dev/v4l/by-path/ (lignes …video-index0), à mettre dans vision.%s" % key))
            continue
        frame = _resolve(base, v.get("share_frame_path" if key == "camera_index" else "share_frame2_path")
                         or ("/dev/shm/inmoov_frame.jpg" if key == "camera_index" else "/dev/shm/inmoov_frame2.jpg"))
        age = _age(frame, now)
        if age is not None and age < 10:
            out.append(item("Vision", label, "ok", "image à jour (%.0f s)" % age))
        else:
            out.append(item("Vision", label, "bad", "pas d'image récente" if age is None else
                            "dernière image il y a %.0f s" % age,
                            "programme « Caméras et suivi » arrêté ? lire son Journal"))
    return out


def _alsa_default(home):
    """Carte son choisie par défaut (~/.asoundrc ou /etc/asound.conf), ou None."""
    for path in (os.path.join(home, ".asoundrc"), "/etc/asound.conf"):
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        m = re.search(r"hw:(?:CARD=)?([A-Za-z0-9_]+)", text) or re.search(r"card\s+([A-Za-z0-9_]+)", text)
        if m:
            return m.group(1), path
    return None, None


def check_sound(cfg, home, cards_text):
    out = []
    card, path = _alsa_default(home)
    cards = re.findall(r"\[(\S+)\s*\]", cards_text or "")
    if card is None:
        out.append(item("Son", "Haut-parleur", "bad", "pas de carte son choisie : le son part vers l'HDMI",
                        "régler ~/.asoundrc sur la carte son (ex. slave.pcm \"hw:AK4571\") puis redémarrer la voix"))
    elif card not in cards and not card.isdigit():
        out.append(item("Son", "Haut-parleur", "bad", "carte « %s » (%s) débranchée" % (card, path),
                        "rebrancher la carte son, ou régler ~/.asoundrc sur une carte de : %s" % ", ".join(cards)))
    else:
        out.append(item("Son", "Haut-parleur", "ok", "carte « %s »" % card))
    voice = cfg.get("voice") or {}
    mic = voice.get("input_device")
    if mic and not any(mic.lower() in c.lower() for c in cards) and mic not in ("default", "pulse"):
        out.append(item("Son", "Micro", "warn", "micro réglé sur « %s », absent de la liste des cartes" % mic,
                        "mettre voice.input_device à null (micro par défaut) ou au nom de la carte branchée"))
    else:
        out.append(item("Son", "Micro", "ok", mic or "micro par défaut"))
    return out


def check_kamil(bridge_state_path, now):
    try:
        with open(bridge_state_path, encoding="utf-8") as f:
            data = json.load(f)
        age = now - float(data.get("updated", 0))
    except (OSError, ValueError, TypeError):
        data, age = {}, None
    if age is None or age > 15:
        return [item("Kamil", "Voix et IA", "bad", "ne répond pas" if age is None else "muet depuis %.0f s" % age,
                     "programme « Kamil : voix et IA » arrêté ? lire son Journal")]
    return [item("Kamil", "Voix et IA", "ok", "à l'écoute (état : %s)" % data.get("etat", "?"))]


def check_keys(env, cfg):
    brain = cfg.get("brain") or {}
    out = [item("Comptes", "Clé Claude", "ok" if env.get("ANTHROPIC_API_KEY") else "bad",
                "présente" if env.get("ANTHROPIC_API_KEY") else "absente",
                "" if env.get("ANTHROPIC_API_KEY") else "ANTHROPIC_API_KEY dans anthropic.env")]
    stt = (cfg.get("voice") or {}).get("cloud_stt") or {}
    if stt.get("enabled"):
        key = stt.get("api_key_env") or "GROQ_API_KEY"
        out.append(item("Comptes", "Clé reconnaissance en ligne", "ok" if env.get(key) else "bad",
                        "présente" if env.get(key) else "absente", "" if env.get(key) else "%s dans anthropic.env" % key))
    if (brain.get("home_assistant") or {}).get("enabled"):
        ok = bool(env.get("HOME_ASSISTANT_TOKEN"))
        out.append(item("Comptes", "Jeton Home Assistant", "ok" if ok else "bad", "présent" if ok else "absent",
                        "" if ok else "HOME_ASSISTANT_TOKEN dans anthropic.env"))
    return out


def check_home_assistant(cfg, env, opener=urllib.request.urlopen):
    ha = (cfg.get("brain") or {}).get("home_assistant") or {}
    if not ha.get("enabled") or not ha.get("url"):
        return []
    ctx = ssl.create_default_context()
    if not ha.get("verify_ssl", True):
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    req = urllib.request.Request(ha["url"].rstrip("/") + "/api/",
                                 headers={"Authorization": "Bearer " + env.get("HOME_ASSISTANT_TOKEN", "")})
    try:
        with opener(req, timeout=4, context=ctx):
            return [item("Maison", "Home Assistant", "ok", "joignable")]
    except urllib.error.HTTPError as e:
        return [item("Maison", "Home Assistant", "bad", "répond %d" % e.code,
                     "jeton refusé : nouveau jeton longue durée dans anthropic.env" if e.code == 401 else "")]
    except (urllib.error.URLError, OSError) as e:
        return [item("Maison", "Home Assistant", "bad", "injoignable (%s)" % getattr(e, "reason", e),
                     "Home Assistant allumé ? adresse %s" % ha["url"])]


def check_mqtt(cfg, connect=socket.create_connection):
    m = cfg.get("mqtt") or {}
    if not m.get("enabled"):
        return []
    host, port = m.get("host") or "homeassistant.local", int(m.get("port") or 1883)
    try:
        connect((host, port), timeout=3).close()
        return [item("Maison", "MQTT", "ok", "%s:%d joignable" % (host, port))]
    except OSError as e:
        return [item("Maison", "MQTT", "bad", "%s:%d injoignable (%s)" % (host, port, e),
                     "module MQTT (Mosquitto) démarré dans Home Assistant ?")]


def check_system(root, run=subprocess.run):
    out = []
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            t = int(f.read().strip()) / 1000.0
        out.append(item("Système", "Température", "ok" if t < 70 else ("warn" if t < 80 else "bad"),
                        "%.0f °C" % t, "" if t < 70 else "ventilateur du Pi : branché, il tourne ?"))
    except (OSError, ValueError):
        pass
    free = shutil.disk_usage(root).free / 1e9
    out.append(item("Système", "Carte SD", "ok" if free > 2 else ("warn" if free > 0.5 else "bad"),
                    "%.1f Go libres" % free, "" if free > 2 else "faire de la place (vieux journaux, modèles inutiles)"))
    try:
        res = run(["vcgencmd", "get_throttled"], capture_output=True, text=True, timeout=5).stdout
        flags = int(res.strip().split("=")[1], 16)
        if flags & 0x1:
            out.append(item("Système", "Alimentation", "bad", "tension trop basse en ce moment",
                            "alimentation officielle 27 W (5 V 5 A) pour le Pi 5"))
        elif flags & 0x10000:
            out.append(item("Système", "Alimentation", "warn", "tension trop basse depuis le démarrage",
                            "alimentation ou câble USB-C trop faible"))
        else:
            out.append(item("Système", "Alimentation", "ok", "correcte"))
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired):
        pass
    try:
        commit = run(["git", "-C", root, "log", "-1", "--format=%h %cd", "--date=format:%d/%m %H:%M"],
                     capture_output=True, text=True, timeout=5).stdout.strip()
        if commit:
            out.append(item("Système", "Version de Kamil", "ok", commit))
    except (OSError, subprocess.TimeoutExpired):
        pass
    return out


def run_checks(cfg, base, root, status, autostart, env, bridge_state_path, home=None, run=subprocess.run,
               now=None):
    now = time.time() if now is None else now
    home = home or os.path.expanduser("~")
    try:
        lsusb = run(["lsusb"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        lsusb = None
    try:
        with open("/proc/asound/cards", encoding="utf-8") as f:
            cards = f.read()
    except OSError:
        cards = ""
    checks = check_programs(status, autostart)
    for fn in (lambda: check_vision(cfg, base, now, lsusb), lambda: check_sound(cfg, home, cards),
               lambda: check_kamil(bridge_state_path, now), lambda: check_keys(env, cfg),
               lambda: check_home_assistant(cfg, env), lambda: check_mqtt(cfg), lambda: check_system(root, run)):
        try:
            checks += fn()
        except Exception as e:     # une vérification en panne ne doit pas cacher les autres
            checks.append(item("Bilan", "vérification", "warn", "erreur : %s" % e))
    return checks
