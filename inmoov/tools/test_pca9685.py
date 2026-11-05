#!/usr/bin/env python3
"""Essai d'un module PCA9685 (16 servos) branché DIRECTEMENT sur le Raspberry Pi 5, sans Arduino.

Câblage (côté Pi : connecteur 40 broches) :
    Pi broche 1 (3,3 V) -> VCC du module      Pi broche 3 (SDA) -> SDA
    Pi broche 6 (GND)   -> GND du module      Pi broche 5 (SCL) -> SCL
    OE : rien (le module le tire déjà à la masse)
    Bornier vert V+ / GND : alimentation SÉPARÉE des servos, 5 à 6 V (jamais le 5 V du Pi).

Exemples :
    python3 test_pca9685.py --scan                  # le module répond-il ? (0x40 attendu)
    python3 test_pca9685.py --canal 0 --angle 90    # met le servo de la voie 0 au milieu
    python3 test_pca9685.py --canal 0 --balayage    # va-et-vient lent 60° <-> 120°
    python3 test_pca9685.py --off                   # relâche les 16 voies

Registres d'après la fiche technique NXP PCA9685 : MODE1 0x00, MODE2 0x01, LED0_ON_L 0x06
(4 registres par voie), PRE_SCALE 0xFE, oscillateur interne 25 MHz,
PRE_SCALE = round(25 MHz / (4096 x fréquence)) - 1, modifiable seulement en sommeil (SLEEP).
"""

import argparse
import sys
import time

MODE1, MODE2, LED0_ON_L, ALL_LED_ON_L, PRE_SCALE = 0x00, 0x01, 0x06, 0xFA, 0xFE
RESTART, AI, SLEEP, ALLCALL = 0x80, 0x20, 0x10, 0x01
OUTDRV = 0x04
FULL_OFF = 0x10          # bit 4 de LEDn_OFF_H : sortie coupée
OSC_HZ = 25_000_000


def prescale_for(freq_hz):
    return int(round(OSC_HZ / (4096.0 * freq_hz))) - 1


def ticks_for(pulse_us, freq_hz):
    return int(round(pulse_us * 4096.0 * freq_hz / 1_000_000))


def angle_to_us(angle, min_us, max_us):
    angle = max(0.0, min(180.0, float(angle)))
    return min_us + (max_us - min_us) * angle / 180.0


class PCA9685:
    def __init__(self, bus, address=0x40, freq_hz=50):
        self.bus, self.address, self.freq = bus, address, freq_hz
        old = bus.read_byte_data(address, MODE1)
        bus.write_byte_data(address, MODE1, (old & ~RESTART) | SLEEP)     # sommeil pour régler la fréquence
        bus.write_byte_data(address, PRE_SCALE, prescale_for(freq_hz))
        bus.write_byte_data(address, MODE2, OUTDRV)                        # sorties « totem » (servos)
        bus.write_byte_data(address, MODE1, AI | ALLCALL)                  # réveil, auto-incrément
        time.sleep(0.001)                                                  # 500 µs mini (fiche technique)
        bus.write_byte_data(address, MODE1, AI | ALLCALL | RESTART)

    def pulse_us(self, channel, us):
        off = ticks_for(us, self.freq)
        self.bus.write_i2c_block_data(self.address, LED0_ON_L + 4 * channel, [0, 0, off & 0xFF, off >> 8])

    def release(self, channel=None):
        reg = ALL_LED_ON_L if channel is None else LED0_ON_L + 4 * channel
        self.bus.write_i2c_block_data(self.address, reg, [0, 0, 0, FULL_OFF])


def scan(bus):
    found = []
    for addr in range(0x03, 0x78):
        try:
            bus.read_byte(addr)
            found.append(addr)
        except OSError:
            pass
    return found


def main(argv=None, bus=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bus", type=int, default=1)
    ap.add_argument("--adresse", default="0x40")
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--canal", type=int, choices=range(16), metavar="0-15")
    ap.add_argument("--angle", type=float)
    ap.add_argument("--balayage", action="store_true")
    ap.add_argument("--off", action="store_true")
    ap.add_argument("--min-us", type=float, default=1000, help="impulsion à 0° (1000 µs = prudent)")
    ap.add_argument("--max-us", type=float, default=2000, help="impulsion à 180° (2000 µs = prudent)")
    a = ap.parse_args(argv)
    if bus is None:
        try:
            from smbus2 import SMBus
        except ImportError:
            sys.exit("Installer smbus2 : ~/domokami/inmoov/.venv-app/bin/pip install smbus2")
        try:
            bus = SMBus(a.bus)
        except (FileNotFoundError, PermissionError) as e:
            sys.exit("Bus I2C %d inaccessible (%s). Activer l'I2C : sudo raspi-config nonint do_i2c 0 "
                     "puis redémarrer." % (a.bus, e))
    addr = int(a.adresse, 0)
    if a.scan:
        found = scan(bus)
        print("Adresses I2C trouvées :", " ".join("0x%02X" % x for x in found) or "aucune")
        if addr in found:
            print("PCA9685 trouvé en 0x%02X." % addr)
        else:
            print("Pas de PCA9685 en 0x%02X : vérifier VCC, GND, SDA (broche 3), SCL (broche 5)." % addr)
        return 0
    try:
        pca = PCA9685(bus, addr)
    except OSError as e:
        sys.exit("Le PCA9685 ne répond pas en 0x%02X (%s). Lancer d'abord --scan." % (addr, e))
    if a.off:
        pca.release()
        print("16 voies relâchées.")
        return 0
    if a.canal is None:
        ap.error("préciser --canal (0 à 15), ou --scan / --off")
    if a.balayage:
        print("Va-et-vient 60° <-> 120° sur la voie %d. Ctrl+C pour arrêter." % a.canal)
        try:
            while True:
                for ang in list(range(60, 121, 2)) + list(range(120, 59, -2)):
                    pca.pulse_us(a.canal, angle_to_us(ang, a.min_us, a.max_us))
                    time.sleep(0.03)
        except KeyboardInterrupt:
            pass
        finally:
            pca.release(a.canal)
            print("\nVoie %d relâchée." % a.canal)
        return 0
    if a.angle is None:
        ap.error("préciser --angle (0 à 180) ou --balayage")
    us = angle_to_us(a.angle, a.min_us, a.max_us)
    pca.pulse_us(a.canal, us)
    print("Voie %d : %.0f° (impulsion %.0f µs). Le servo reste en position ; --off pour le relâcher."
          % (a.canal, a.angle, us))
    return 0


if __name__ == "__main__":
    sys.exit(main())
