#!/usr/bin/env python3
"""Pilotage des jambes InMoov depuis le Raspberry Pi 5 (via l'Arduino Mega).

Les poses sont écrites en DEGRÉS par rapport à la position « debout » calibrée,
puis converties en positions servo (0..4095) d'après legs_config.json.

    python legs_controller.py --config legs_config.json status
    python legs_controller.py --config legs_config.json reset
    python legs_controller.py --config legs_config.json pose debout --time 3000
    python legs_controller.py --config legs_config.json sequence flexions
    python legs_controller.py --config legs_config.json torque off

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


def parse_status(lines):
    """Analyse la réponse à STATUS."""
    status = {"state": None, "reason": "", "servos": {}, "imu": None}
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
    return status


class LegsLink:
    """Liaison série avec le firmware inmoov_legs.ino (battement de cœur automatique)."""

    def __init__(self, port, baud=115200, heartbeat_s=0.3):
        import serial  # pyserial

        self.ser = serial.Serial(port, baud, timeout=0.1)
        time.sleep(2.0)  # l'Arduino Mega redémarre à l'ouverture du port
        self.lines = queue.Queue()
        self.lock = threading.Lock()
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


def print_status(cfg, st):
    names = {j["id"]: n for n, j in cfg["joints"].items()}
    print("État : %s %s" % (st["state"], st["reason"]))
    for sid, s in sorted(st["servos"].items()):
        name = names.get(sid, "?")
        deg = raw_to_deg(cfg["joints"][name], s["pos"]) if name in cfg["joints"] and s["pos"] >= 0 else float("nan")
        print("  %-24s id %2d  %6.1f°  charge %5d  %3d°C  %4.1f V" % (name, sid, deg, s["load"], s["temp_c"], s["volt"]))
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
    sub.add_parser("check", help="vérifie les poses sans matériel")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config(args.config)

    if args.cmd == "check":
        for name, pose in cfg["poses"].items():
            pose_targets(cfg, pose)
            print("pose %-20s ok" % name)
        for name, steps in cfg["sequences"].items():
            for pose_name, _ in steps:
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
        elif args.cmd == "sequence":
            for pose_name, ms in cfg["sequences"][args.name]:
                log.info("pose %s en %d ms", pose_name, ms)
                link.move(pose_targets(cfg, cfg["poses"][pose_name]), ms)
                time.sleep(ms / 1000.0 + 0.3)
                st = link.status()
                if st["state"] != "READY":
                    print_status(cfg, st)
                    return 2
    except KeyboardInterrupt:
        link.hold()
    finally:
        link.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
