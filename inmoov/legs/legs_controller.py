#!/usr/bin/env python3
"""Pilotage des jambes InMoov depuis le Raspberry Pi 5 (via l'Arduino Mega).

Les poses sont écrites en DEGRÉS par rapport à la position « debout » calibrée,
puis converties en positions servo (0..4095) d'après legs_config.json.

    python legs_controller.py --config legs_config.json status
    python legs_controller.py --config legs_config.json reset
    python legs_controller.py --config legs_config.json pose debout --time 3000
    python legs_controller.py --config legs_config.json sequence flexions
    python legs_controller.py --config legs_config.json torque off
    python legs_controller.py --config legs_config.json feet           # pieds et équilibre
    python legs_controller.py --config legs_config.json feet tare      # pieds en l'air
    python legs_controller.py --config legs_config.json feet cal 0 2000
    python legs_controller.py --config legs_config.json balance monitor
    python legs_controller.py --config legs_config.json sequence pas_sur_place

SÉCURITÉ : robot accroché à un portique, arrêt d'urgence matériel à portée de main.
L'IA conversationnelle n'a volontairement aucun accès à ce programme.
"""

import argparse
import json
import logging
import queue
import sys
import threading
import time

log = logging.getLogger("legs")

STEPS_PER_TURN = 4096


class PoseError(ValueError):
    pass


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def deg_to_raw(joint, deg):
    return int(round(joint["center"] + joint["direction"] * deg * STEPS_PER_TURN / 360.0))


def raw_to_deg(joint, raw):
    return (raw - joint["center"]) * 360.0 / STEPS_PER_TURN * joint["direction"]


def pose_targets(cfg, pose):
    """Convertit une pose {articulation: degrés} en {id: position}.

    Une articulation absente de la pose reste à 0° (position debout).
    Une valeur hors limites est REFUSÉE (pas de rabotage silencieux).
    """
    joints = cfg["joints"]
    unknown = set(pose) - set(joints)
    if unknown:
        raise PoseError("articulation(s) inconnue(s) : %s" % ", ".join(sorted(unknown)))
    targets = {}
    for name, joint in joints.items():
        deg = float(pose.get(name, 0.0))
        if not joint["min_deg"] <= deg <= joint["max_deg"]:
            raise PoseError("%s = %.1f° hors limites [%s, %s]" % (name, deg, joint["min_deg"], joint["max_deg"]))
        targets[joint["id"]] = deg_to_raw(joint, deg)
    return targets


def move_command(targets, duration_ms):
    parts = ["%d:%d" % (i, p) for i, p in sorted(targets.items())]
    return "MOVE %d %s" % (int(duration_ms), " ".join(parts))


FEET_KEYS = ("ok", "g_kg", "g_cop_x", "g_cop_y", "d_kg", "d_cop_x", "d_cop_y",
             "balance", "corr_tangage", "corr_roulis", "roll", "pitch")
BALANCE_MODES = {"off": 0, "on": 1, "monitor": 2}
ANKLES = ("gauche_cheville_tangage", "gauche_cheville_roulis", "droite_cheville_tangage", "droite_cheville_roulis")


def parse_feet(line):
    """Ligne « F ... » du firmware -> dict (charges en kg, centres de pression de -1 à 1)."""
    parts = line.split()
    if len(parts) != len(FEET_KEYS) + 1 or parts[0] != "F":
        raise ValueError("ligne pieds invalide : %r" % line)
    values = [float(x) for x in parts[1:]]
    feet = dict(zip(FEET_KEYS, values))
    feet["ok"] = feet["ok"] == 1
    feet["balance"] = int(feet["balance"])
    return feet


def support_ratio(feet, side):
    """Part du poids portée par le pied « gauche » ou « droite » (0 à 1), None sans mesure."""
    if not feet or not feet["ok"]:
        return None
    total = feet["g_kg"] + feet["d_kg"]
    if total < 0.5:
        return None
    return (feet["g_kg"] if side == "gauche" else feet["d_kg"]) / total


def balance_command(cfg):
    """Commande BALCFG d'après la section « balance » et le sens des chevilles."""
    b = cfg.get("balance", {})
    vals = [b.get("kp", 0.3), b.get("kd", 0.02), b.get("kc", 3.0), b.get("max_deg", 5.0),
            b.get("contact_kg", 1.0), b.get("imu_pitch_sign", 1), b.get("imu_roll_sign", 1)]
    if not 0 <= vals[3] <= 10:
        raise PoseError("balance.max_deg doit être entre 0 et 10 degrés")
    if min(vals[:5]) < 0:
        raise PoseError("balance : kp, kd, kc et contact_kg doivent être positifs")
    signs = {"imu_pitch_sign": vals[5], "imu_roll_sign": vals[6]}
    signs.update({n: cfg["joints"][n]["direction"] for n in ANKLES})
    for name, v in signs.items():
        if v not in (1, -1):
            raise PoseError("%s doit valoir 1 ou -1" % name)
    vals += [cfg["joints"][n]["direction"] for n in ANKLES]
    return "BALCFG " + " ".join("%g" % v for v in vals)


def parse_step(step):
    """Étape de séquence : [pose, ms] ou [pose, ms, {"appui": "gauche", "min": 0.85, "timeout_ms": 4000}]."""
    pose, ms = step[0], step[1]
    gate = step[2] if len(step) > 2 else None
    if gate is not None:
        if gate.get("appui") not in ("gauche", "droite"):
            raise PoseError("appui doit être « gauche » ou « droite »")
        if not 0.5 <= float(gate.get("min", 0.85)) <= 1.0:
            raise PoseError("min (part du poids) doit être entre 0.5 et 1")
    return pose, ms, gate


def parse_status(lines):
    """Analyse la réponse à STATUS."""
    status = {"state": None, "reason": "", "servos": {}, "imu": None, "cells": {}, "feet": None}
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "STATE":
            status["state"] = parts[1] if len(parts) > 1 else None
            status["reason"] = " ".join(parts[2:])
        elif parts[0] == "S" and len(parts) == 6:
            sid, pos, load, temp, volt = (int(x) for x in parts[1:])
            status["servos"][sid] = {"pos": pos, "load": load, "temp_c": temp, "volt": volt / 10.0}
        elif parts[0] == "IMU" and len(parts) == 4:
            status["imu"] = {"ok": parts[1] == "1", "roll": float(parts[2]), "pitch": float(parts[3])}
        elif parts[0] == "CELL" and len(parts) == 4:
            status["cells"][int(parts[1])] = {"raw": int(parts[2]), "kg": float(parts[3])}
        elif parts[0] == "F":
            status["feet"] = parse_feet(line)
    return status


class LegsLink:
    """Liaison série avec le firmware inmoov_legs.ino (battement de cœur automatique)."""

    def __init__(self, port, baud=115200, heartbeat_s=0.3):
        import serial  # pyserial

        self.ser = serial.Serial(port, baud, timeout=0.1)
        time.sleep(2.0)  # l'Arduino Mega redémarre à l'ouverture du port
        self.lines = queue.Queue()
        self.lock = threading.Lock()
        self.cmd_lock = threading.Lock()  # une commande à la fois (séquence + appli)
        self.running = True
        threading.Thread(target=self._reader, daemon=True).start()
        threading.Thread(target=self._heartbeat, args=(heartbeat_s,), daemon=True).start()

    def close(self):
        self.running = False
        self.ser.close()

    def _write(self, text):
        with self.lock:
            self.ser.write((text + "\n").encode("ascii"))

    def _reader(self):
        buf = b""
        while self.running:
            try:
                buf += self.ser.read(256)
            except Exception:  # port fermé
                return
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("ascii", "replace").strip()
                if not line or line == "OK HB":
                    continue
                if line.startswith("FAULT"):
                    log.error("ARDUINO %s", line)
                self.lines.put(line)

    def _heartbeat(self, period):
        while self.running:
            self._write("HB")
            time.sleep(period)

    def command(self, text, done_prefixes, timeout=3.0):
        """Envoie une commande et renvoie les lignes jusqu'à la réponse finale."""
        with self.cmd_lock:
            return self._command(text, done_prefixes, timeout)

    def _command(self, text, done_prefixes, timeout):
        while not self.lines.empty():
            self.lines.get_nowait()
        self._write(text)
        out = []
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                line = self.lines.get(timeout=0.1)
            except queue.Empty:
                continue
            out.append(line)
            if line.startswith("ERR"):
                raise RuntimeError(line)
            if any(line.startswith(p) for p in done_prefixes):
                return out
        raise TimeoutError("pas de réponse à %r" % text)

    def status(self):
        return parse_status(self.command("STATUS", ["OK STATUS"]))

    def reset(self):
        out = self.command("RESET", ["OK RESET", "FAULT"])
        if out[-1].startswith("FAULT"):
            raise RuntimeError(out[-1])

    def move(self, targets, duration_ms):
        self.command(move_command(targets, duration_ms), ["OK MOVE"])

    def hold(self):
        self.command("HOLD", ["OK HOLD"])

    def torque(self, on):
        self.command("TORQUE %d" % (1 if on else 0), ["OK TORQUE"])

    def feet(self):
        out = self.command("FEET", ["F "])
        return parse_feet(out[-1])

    def tare(self):
        self.command("TARE", ["OK TARE"])

    def calibrate_cell(self, cell, grams):
        return self.command("CAL %d %d" % (int(cell), int(grams)), ["OK CAL"])[-1]

    def balance(self, mode, cfg=None):
        if cfg is not None:
            self.command(balance_command(cfg), ["OK BALCFG"])
        self.command("BAL %d" % BALANCE_MODES[mode], ["OK BAL"])

    def wait_support(self, side, minimum=0.85, timeout_ms=4000):
        """Attend que le pied « side » porte au moins « minimum » du poids. Renvoie la dernière part mesurée."""
        end = time.monotonic() + timeout_ms / 1000.0
        ratio = None
        while time.monotonic() < end:
            ratio = support_ratio(self.feet(), side)
            if ratio is not None and ratio >= minimum:
                return ratio
            time.sleep(0.05)
        raise RuntimeError("appui %s insuffisant (%s) : pied pas encore prêt à porter le robot"
                           % (side, "pas de mesure" if ratio is None else "%.0f %%" % (ratio * 100)))


def run_sequence(link, cfg, name, log_fn=None, stop_event=None):
    """Joue une séquence. Une étape avec « appui » attend que le pied porte le robot
    avant de continuer ; sinon FIGE et s'arrête (le robot ne lève jamais un pied chargé).
    stop_event (threading.Event) : arrête la séquence entre deux étapes."""
    stop_event = stop_event or threading.Event()
    for step in cfg["sequences"][name]:
        if stop_event.is_set():
            raise RuntimeError("séquence arrêtée")
        pose_name, ms, gate = parse_step(step)
        if log_fn:
            log_fn("pose %s en %d ms" % (pose_name, ms))
        link.move(pose_targets(cfg, cfg["poses"][pose_name]), ms)
        if stop_event.wait(ms / 1000.0 + 0.3):
            raise RuntimeError("séquence arrêtée")
        if gate:
            try:
                link.wait_support(gate["appui"], float(gate.get("min", 0.85)), int(gate.get("timeout_ms", 4000)))
            except RuntimeError:
                link.hold()
                raise
        st = link.status()
        if st["state"] != "READY":
            raise RuntimeError("défaut : %s" % st["reason"])


def print_feet(f):
    if not f["ok"]:
        print("Pieds : cellules absentes ou non étalonnées (voir « feet tare » et « feet cal »)")
    for side, key in (("gauche", "g"), ("droit ", "d")):
        print("Pied %s : %5.1f kg  centre de pression avant/arrière %+.2f  ext./int. %+.2f"
              % (side, f[key + "_kg"], f[key + "_cop_x"], f[key + "_cop_y"]))
    mode = {v: k for k, v in BALANCE_MODES.items()}.get(f["balance"], "?")
    print("Équilibre : %s, correction cheville tangage %+.1f°, roulis %+.1f° (bassin roulis %.1f°, tangage %.1f°)"
          % (mode, f["corr_tangage"], f["corr_roulis"], f["roll"], f["pitch"]))


def print_status(cfg, st):
    names = {j["id"]: n for n, j in cfg["joints"].items()}
    print("État : %s %s" % (st["state"], st["reason"]))
    for sid, s in sorted(st["servos"].items()):
        name = names.get(sid, "?")
        deg = raw_to_deg(cfg["joints"][name], s["pos"]) if name in cfg["joints"] and s["pos"] >= 0 else float("nan")
        print("  %-24s id %2d  %6.1f°  charge %5d  %3d°C  %4.1f V" % (name, sid, deg, s["load"], s["temp_c"], s["volt"]))
    if st.get("feet"):
        print_feet(st["feet"])
    if st["imu"]:
        print("Bassin : roulis %.1f°, tangage %.1f° (IMU %s)"
              % (st["imu"]["roll"], st["imu"]["pitch"], "ok" if st["imu"]["ok"] else "ABSENTE"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default="legs_config.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("reset")
    sub.add_parser("hold")
    p = sub.add_parser("pose")
    p.add_argument("name")
    p.add_argument("--time", type=int, default=3000, help="durée du mouvement en ms")
    p = sub.add_parser("sequence")
    p.add_argument("name")
    p = sub.add_parser("torque")
    p.add_argument("state", choices=["on", "off"])
    p = sub.add_parser("feet", help="pieds : état, tare, étalonnage")
    p.add_argument("action", nargs="?", choices=["show", "tare", "cal"], default="show")
    p.add_argument("cell", nargs="?", type=int, help="cellule 0..7 (cal)")
    p.add_argument("grams", nargs="?", type=int, help="masse posée en grammes (cal)")
    p = sub.add_parser("balance", help="équilibre : on, off ou monitor (calcule sans bouger)")
    p.add_argument("mode", choices=list(BALANCE_MODES))
    sub.add_parser("check", help="vérifie les poses sans matériel")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config(args.config)

    if args.cmd == "check":
        for name, pose in cfg["poses"].items():
            pose_targets(cfg, pose)
            print("pose %-20s ok" % name)
        if "balance" in cfg:
            balance_command(cfg)
            print("équilibre         ok")
        for name, steps in cfg["sequences"].items():
            for step in steps:
                pose_name = parse_step(step)[0]
                if pose_name not in cfg["poses"]:
                    raise PoseError("séquence %s : pose inconnue %s" % (name, pose_name))
            print("séquence %-16s ok" % name)
        return 0

    link = LegsLink(cfg["serial_port"], cfg.get("baud", 115200))
    try:
        if args.cmd == "status":
            print_status(cfg, link.status())
        elif args.cmd == "reset":
            link.reset()
            print("Prêt.")
        elif args.cmd == "hold":
            link.hold()
        elif args.cmd == "torque":
            if args.state == "off":
                print("ATTENTION : sans couple, le robot ne tient plus debout (portique !)")
            link.torque(args.state == "on")
        elif args.cmd == "pose":
            link.move(pose_targets(cfg, cfg["poses"][args.name]), args.time)
            time.sleep(args.time / 1000.0 + 0.3)
            print_status(cfg, link.status())
        elif args.cmd == "feet":
            if args.action == "tare":
                print("Pieds EN L'AIR (robot sur le portique) : mise à zéro des 8 cellules.")
                link.tare()
            elif args.action == "cal":
                if args.cell is None or args.grams is None:
                    print("Usage : feet cal <cellule 0..7> <grammes>")
                    return 1
                print(link.calibrate_cell(args.cell, args.grams))
            print_feet(link.feet())
        elif args.cmd == "balance":
            link.balance(args.mode, cfg)
            print_feet(link.feet())
        elif args.cmd == "sequence":
            try:
                run_sequence(link, cfg, args.name, log.info)
            except RuntimeError as exc:
                print("ARRÊT : %s" % exc)
                print_status(cfg, link.status())
                return 2
    except KeyboardInterrupt:
        link.hold()
    finally:
        link.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
