"""Tests de la centrale des capteurs avec un bus I2C factice."""

import json
import os
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "sensors"), os.path.join(ROOT, "app")]

from devices import ADS1115, INA226, battery_percent  # noqa: E402
from sensor_hub import SensorHub, make_handler  # noqa: E402



class FakeBus:
    def __init__(self):
        self.regs = {}     # (adresse, registre) -> valeur 16 bits
        self.adc = {}      # (adresse, voie) -> valeur, pour les ADS1115
        self.mux = {}      # voie choisie par la dernière configuration ADS1115
        self.writes = []

    def set(self, address, reg, value):
        self.regs[(address, reg)] = value & 0xFFFF

    def set_adc(self, address, channel, volts):
        self.regs.setdefault((address, 0x00), 0)
        self.adc[(address, channel)] = int(volts / (4.096 / 32768))

    def read_i2c_block_data(self, address, reg, n):
        if reg == 0x00 and (address, self.mux.get(address)) in self.adc:
            v = self.adc[(address, self.mux[address])]
            return [v >> 8, v & 0xFF]
        if (address, reg) not in self.regs:
            raise OSError("pas de réponse 0x%02X" % address)
        v = self.regs[(address, reg)]
        return [v >> 8, v & 0xFF]

    def write_i2c_block_data(self, address, reg, data):
        self.writes.append((address, reg, data))
        if reg == 0x01 and address >= 0x48:
            self.mux[address] = (((data[0] << 8) | data[1]) >> 12 & 0x7) - 4


class FakeMrl:
    def __init__(self):
        self.calls = []
        self.pos = {}

    def call(self, *a):
        return self.call_checked(*a)[1]

    def call_checked(self, service, method, *params):
        self.calls.append((service, method) + params)
        if method == "getCurrentInputPos":
            return True, self.pos.get(service, 0.0)
        return True, None


def ina(bus, address, volts, amps, shunt=0.002):
    bus.set(address, 0xFE, 0x5449)
    bus.set(address, 0x02, int(round(volts / 1.25e-3)))
    bus.set(address, 0x01, int(round(amps * shunt / 2.5e-6)))


CFG = {
    "boards": [{"name": "pca_gauche", "ina226": "0x44", "shunt_ohm": 0.002, "max_current_a": 10,
                "max_overcurrent_s": 1.5}],
    "battery": {"ina226": "0x40", "shunt_ohm": 0.001, "cells": 4, "chemistry": "lifepo4", "low_percent": 20},
    "fingertips": {"left": {"thumb": ["0x48", 0], "index": ["0x48", 1], "majeure": ["0x48", 2],
                            "ringFinger": ["0x48", 3], "pinky": ["0x4A", 0]}},
    "fsr_vref": 3.3, "grip_threshold": 0.35, "leds_service": "i01.neoPixel",
    "adc_delay_s": 0,  # pas d'attente de conversion dans les tests
}


class DeviceTest(unittest.TestCase):
    def test_ina226_decoding(self):
        bus = FakeBus()
        ina(bus, 0x41, 6.0, 2.5)
        dev = INA226(bus, 0x41, 0.002)
        dev.setup()
        self.assertIn((0x41, 0x00, [0x45, 0x27]), bus.writes)
        v, a = dev.read()
        self.assertAlmostEqual(v, 6.0, places=2)
        self.assertAlmostEqual(a, 2.5, places=2)
        bus.set(0x41, 0x01, -400)  # courant négatif (signé)
        self.assertAlmostEqual(dev.read()[1], -0.5, places=3)

    def test_ina226_wrong_chip(self):
        bus = FakeBus()
        bus.set(0x41, 0xFE, 0x1234)
        with self.assertRaises(OSError):
            INA226(bus, 0x41, 0.002).setup()

    def test_ads1115(self):
        bus = FakeBus()
        bus.set(0x48, 0x00, int(1.65 / (4.096 / 32768)))
        v = ADS1115(bus, 0x48, conversion_delay_s=0).read_volts(2)
        self.assertAlmostEqual(v, 1.65, places=3)
        addr, reg, data = bus.writes[-1]
        config = (data[0] << 8) | data[1]
        self.assertEqual((addr, reg), (0x48, 0x01))
        self.assertEqual((config >> 12) & 0x7, 4 + 2)   # AIN2 / GND
        self.assertTrue(config & 0x8000)                # conversion lancée

    def test_battery_percent(self):
        self.assertEqual(battery_percent(13.6, 4), 100)
        self.assertEqual(battery_percent(11.9, 4), 0)
        self.assertEqual(battery_percent(13.2, 4, "lifepo4"), 60)
        self.assertEqual(battery_percent(14.8, 4, "liion"), 50)


class HubTest(unittest.TestCase):
    def setUp(self):
        self.bus = FakeBus()
        ina(self.bus, 0x44, 6.0, 1.0)
        ina(self.bus, 0x40, 13.2, 3.0, shunt=0.001)
        for a, ch in ((0x48, 0), (0x48, 1), (0x48, 2), (0x48, 3), (0x4A, 0)):
            self.bus.set_adc(a, ch, 0.0)
        self.now = [0.0]
        self.mrl = FakeMrl()
        self.hub = SensorHub(CFG, self.mrl, self.bus, clock=lambda: self.now[0])

    def test_status(self):
        self.hub.poll()
        st = self.hub.status()
        self.assertAlmostEqual(st["boards"]["pca_gauche"]["amps"], 1.0, places=2)
        self.assertEqual(st["battery"]["percent"], 60)
        self.assertFalse(st["battery"]["low"])
        self.assertEqual(st["touch"]["left.thumb"], 0.0)

    def test_overcurrent_trips_only_after_delay(self):
        ina(self.bus, 0x44, 5.8, 14.0)
        self.hub.poll()
        self.now[0] = 1.0
        self.hub.poll()
        self.assertIsNone(self.hub.status()["boards"]["pca_gauche"]["fault"])
        self.now[0] = 1.6
        self.hub.poll()
        fault = self.hub.status()["boards"]["pca_gauche"]["fault"]
        self.assertIn("surintensité", fault)
        disabled = {c[0] for c in self.mrl.calls if c[1] == "disable"}
        self.assertEqual(len(disabled), 10)  # bras + main gauche
        self.assertTrue(all(s.startswith("i01.left") for s in disabled))
        self.assertIn(("i01.neoPixel", "fill", 255, 0, 0), self.mrl.calls)
        self.hub.reset()
        self.assertIsNone(self.hub.status()["boards"]["pca_gauche"]["fault"])

    def test_short_peak_does_not_trip(self):
        ina(self.bus, 0x44, 5.8, 14.0)
        self.hub.poll()
        ina(self.bus, 0x44, 6.0, 2.0)
        self.now[0] = 2.0
        self.hub.poll()
        ina(self.bus, 0x44, 5.8, 14.0)
        self.now[0] = 2.5
        self.hub.poll()
        self.assertIsNone(self.hub.status()["boards"]["pca_gauche"]["fault"])

    def test_missing_sensor_is_reported_not_fatal(self):
        del self.bus.regs[(0x44, 0x02)]
        self.hub.poll()
        self.assertIn("pas de réponse", self.hub.status()["boards"]["pca_gauche"]["error"])

    def test_grip_stops_each_finger_on_contact(self):
        moves = []
        orig = self.mrl.call_checked

        def call_checked(service, method, *params):
            if method == "moveTo":
                moves.append((service, params[0]))
                # l'index touche l'objet dès 40°, les autres jamais
                if service.endswith(".index") and params[0] >= 40:
                    self.bus.set_adc(0x48, 1, 2.0)
            return orig(service, method, *params)

        self.mrl.call_checked = call_checked
        res = self.hub.grip("left", step=10, period_s=0)
        self.assertEqual(res["positions"]["index"], 40)
        self.assertEqual(res["positions"]["thumb"], 130)
        self.assertEqual(res["positions"]["pinky"], 180)
        self.assertIn("index", res["touching"])

    def test_http_endpoints(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.hub))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d" % srv.server_port
        try:
            self.hub.poll()
            st = json.loads(urllib.request.urlopen(base + "/status").read())
            self.assertIn("pca_gauche", st["boards"])
            req = urllib.request.Request(base + "/reset", data=b"{}", method="POST")
            self.assertTrue(json.loads(urllib.request.urlopen(req).read())["ok"])
            bad = urllib.request.Request(base + "/grip", data=b'{"side": "milieu"}', method="POST")
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(bad)
            self.assertEqual(e.exception.code, 400)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
