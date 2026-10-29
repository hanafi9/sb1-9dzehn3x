#!/usr/bin/env python3
"""Centrale des capteurs d'InMoov (Raspberry Pi 5, bus I2C n°1).

- Courant et tension de chaque carte PCA9685 (INA226) : si un servo force trop
  longtemps, tous les servos de cette carte sont désactivés dans MyRobotLab
  (la carte reste « en défaut » jusqu'à une remise à zéro depuis l'Atelier).
- Batterie (INA226) : tension, pourcentage approximatif, alerte batterie faible.
- Bout des doigts (capteurs de force FSR sur ADS1115) : « prise douce », la main se
  ferme doigt par doigt jusqu'à sentir l'objet.
- Présence (VL53L1X) : distance de la personne la plus proche, salut facultatif.

État en JSON sur http://127.0.0.1:8095/status (lu par l'onglet Capteurs de l'Atelier).

    python sensor_hub.py --config ../config.json
    python sensor_hub.py --config ../config.json --simulate   # sans matériel
"""

import argparse
import json
import logging
import os
import random
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), os.path.join(HERE, "..", "app")]

from devices import ADS1115, INA226, DistanceSensor, battery_percent  # noqa: E402
from mrl_client import MrlClient, load_config  # noqa: E402
import wiring  # noqa: E402

log = logging.getLogger("sensors")

FINGERS = ["thumb", "index", "majeure", "ringFinger", "pinky"]
CLOSED = {"thumb": 130, "index": 180, "majeure": 180, "ringFinger": 180, "pinky": 180}  # InMoov2Hand.close()


def addr(value):
    return int(value, 16) if isinstance(value, str) else int(value)


class SimulatedBus:
    """Bus factice pour essayer l'Atelier sans capteurs branchés."""

    def __init__(self):
        self.t0 = time.time()

    def read_i2c_block_data(self, address, reg, n):
        if reg == 0xFE:
            return [0x54, 0x49]
        if reg == 0x02:   # tension de bus : 6 V cartes, 13,2 V batterie
            raw = int((13.2 if address == 0x40 else 6.0 + random.uniform(-0.05, 0.05)) / 1.25e-3)
        elif reg == 0x01:  # shunt : 0,5 à 2 A sur 2 mΩ
            raw = int((0.002 * random.uniform(0.5, 2.0)) / 2.5e-6)
        elif reg == 0x00 and address in (0x48, 0x49, 0x4A):
            raw = int(random.uniform(0.0, 0.4) / (4.096 / 32768))
        else:
            raw = 0
        return [(raw >> 8) & 0xFF, raw & 0xFF]

    def write_i2c_block_data(self, address, reg, data):
        pass


class SensorHub:
    def __init__(self, cfg, mrl, bus, distance=None, clock=time.monotonic):
        self.cfg = cfg
        self.mrl = mrl
        self.clock = clock
        self.lock = threading.Lock()
        self.distance = distance
        self.boards = {}
        for b in cfg.get("boards", []):
            ina = INA226(bus, addr(b["ina226"]), b["shunt_ohm"])
            self.boards[b["name"]] = {"cfg": b, "ina": ina, "over_since": None, "fault": None,
                                      "volts": None, "amps": None, "error": None}
        bat = cfg.get("battery")
        self.battery = None
        if bat:
            self.battery = {"cfg": bat, "ina": INA226(bus, addr(bat["ina226"]), bat["shunt_ohm"]),
                            "volts": None, "amps": None, "percent": None, "low": False, "error": None}
        self.adcs = {}
        self.fingertips = {}
        for side, fingers in cfg.get("fingertips", {}).items():
            for finger, (a, channel) in fingers.items():
                a = addr(a)
                self.adcs.setdefault(a, ADS1115(bus, a, cfg.get("adc_delay_s", 0.009)))
                self.fingertips[(side, finger)] = (a, int(channel))
        self.touch = {}
        self.presence = {"distance_mm": None, "present": False, "last_greet": 0.0}
        self.grip_jobs = {}
        for item in list(self.boards.values()) + ([self.battery] if self.battery else []):
            try:
                item["ina"].setup()
            except OSError as e:
                item["error"] = str(e)
                log.warning("%s", e)

    # ------------------------------------------------------------ lectures
    def poll(self):
        now = self.clock()
        for name, b in self.boards.items():
            try:
                b["volts"], b["amps"] = b["ina"].read()
                b["error"] = None
            except OSError as e:
                b["error"] = str(e)
                continue
            self._check_board(name, b, now)
        if self.battery:
            bat = self.battery
            try:
                bat["volts"], bat["amps"] = bat["ina"].read()
                bat["error"] = None
                c = bat["cfg"]
                bat["percent"] = battery_percent(bat["volts"], c["cells"], c.get("chemistry", "lifepo4"))
                bat["low"] = bat["percent"] <= c.get("low_percent", 20)
            except OSError as e:
                bat["error"] = str(e)
        for key, (a, channel) in self.fingertips.items():
            try:
                self.touch[key] = round(self.adcs[a].read_volts(channel) / self.cfg.get("fsr_vref", 3.3), 3)
            except OSError:
                self.touch[key] = None
        if self.distance is not None:
            self._check_presence(now)

    def _check_board(self, name, b, now):
        c = b["cfg"]
        if b["fault"]:
            return
        if b["amps"] > c["max_current_a"]:
            if b["over_since"] is None:
                b["over_since"] = now
            elif now - b["over_since"] >= c.get("max_overcurrent_s", 1.5):
                self.trip(name, "surintensité %.1f A > %.1f A pendant %.1f s"
                          % (b["amps"], c["max_current_a"], now - b["over_since"]))
        else:
            b["over_since"] = None

    def trip(self, name, reason):
        """Coupe tous les servos d'une carte dans MyRobotLab."""
        b = self.boards[name]
        b["fault"] = reason
        log.error("Carte %s : %s -> servos désactivés", name, reason)
        for service, (board, _ch, _m) in wiring.SERVO_PLAN.items():
            if board == name:
                self.mrl.call(service, "disable")
        leds = self.cfg.get("leds_service")
        if leds:
            self.mrl.call(leds, "fill", 255, 0, 0)

    def reset(self, name=None):
        for n, b in self.boards.items():
            if name in (None, n):
                b["fault"] = None
                b["over_since"] = None

    def _check_presence(self, now):
        try:
            d = self.distance.read_mm()
        except OSError:
            d = None
        was = self.presence["present"]
        present = d is not None and d < self.cfg.get("presence_mm", 1200)
        self.presence.update(distance_mm=d, present=present)
        greet = self.cfg.get("greet_text")
        if present and not was and greet and now - self.presence["last_greet"] > self.cfg.get("greet_cooldown_s", 120):
            self.presence["last_greet"] = now
            self.mrl.call(self.cfg.get("mouth_service", "i01.mouth"), "speak", greet)

    # ------------------------------------------------------------ prise douce
    def grip(self, side, threshold=None, step=5, period_s=0.08, max_s=8.0):
        """Ferme les doigts un à un jusqu'à ce que chacun sente l'objet (ou soit fermé)."""
        threshold = float(threshold if threshold is not None else self.cfg.get("grip_threshold", 0.35))
        hand = "i01.%sHand" % side
        pos = {}
        for f in FINGERS:
            ok, value = self.mrl.call_checked("%s.%s" % (hand, f), "getCurrentInputPos")
            if not ok:
                raise RuntimeError("MyRobotLab injoignable")
            pos[f] = float(value or 0)
        done = {f: False for f in FINGERS}
        end = self.clock() + max_s
        while not all(done.values()) and self.clock() < end:
            with self.lock:
                self.poll()
            for f in FINGERS:
                if done[f]:
                    continue
                force = self.touch.get((side, f))
                if (force is not None and force >= threshold) or pos[f] >= CLOSED[f]:
                    done[f] = True
                    continue
                pos[f] = min(CLOSED[f], pos[f] + step)
                self.mrl.call("%s.%s" % (hand, f), "moveTo", pos[f])
            time.sleep(period_s)
        return {"positions": pos, "touching": [f for f in FINGERS if (self.touch.get((side, f)) or 0) >= threshold]}

    # ------------------------------------------------------------ état
    def status(self):
        with self.lock:
            return {
                "time": time.time(),
                "boards": {n: {k: b[k] for k in ("volts", "amps", "fault", "error")}
                           | {"max_current_a": b["cfg"]["max_current_a"]} for n, b in self.boards.items()},
                "battery": None if not self.battery else
                {k: self.battery[k] for k in ("volts", "amps", "percent", "low", "error")},
                "touch": {"%s.%s" % k: v for k, v in self.touch.items()},
                "presence": {k: self.presence[k] for k in ("distance_mm", "present")},
            }


def make_handler(hub):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, data):
            body = json.dumps(data).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/status":
                self._send(200, hub.status())
            else:
                self._send(404, {"error": "inconnu"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
                if self.path == "/reset":
                    hub.reset(data.get("board"))
                    self._send(200, {"ok": True})
                elif self.path == "/grip":
                    if data.get("side") not in ("left", "right"):
                        raise ValueError("side = left ou right")
                    self._send(200, {"ok": True, **hub.grip(data["side"], data.get("threshold"))})
                else:
                    self._send(404, {"error": "inconnu"})
            except (ValueError, KeyError) as e:
                self._send(400, {"ok": False, "error": str(e)})
            except RuntimeError as e:
                self._send(502, {"ok": False, "error": str(e)})

        def log_message(self, *a):
            pass

    return Handler


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", default=os.path.join(HERE, "..", "config.json"))
    p.add_argument("--simulate", action="store_true", help="valeurs factices, sans capteurs")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config(a.config)
    scfg = cfg["sensors"]
    mrl = MrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"])
    distance = None
    if a.simulate:
        bus = SimulatedBus()
    else:
        from smbus2 import SMBus

        bus = SMBus(scfg.get("i2c_bus", 1))
        if scfg.get("vl53l1x"):
            try:
                distance = DistanceSensor(addr(scfg["vl53l1x"]), scfg.get("i2c_bus", 1))
            except Exception as e:  # capteur absent : on continue sans
                log.warning("VL53L1X indisponible : %s", e)
    hub = SensorHub(scfg, mrl, bus, distance)
    server = ThreadingHTTPServer(("127.0.0.1", scfg.get("port", 8095)), make_handler(hub))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("Capteurs : http://127.0.0.1:%d/status", scfg.get("port", 8095))
    period = 1.0 / scfg.get("rate_hz", 10)
    try:
        while True:
            with hub.lock:
                hub.poll()
            time.sleep(period)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
