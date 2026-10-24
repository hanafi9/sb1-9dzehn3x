"""Pilotes I2C minimalistes (bus I2C n°1 du Raspberry Pi 5, via smbus2).

- INA226 : tension et courant d'une ligne d'alimentation (une par carte PCA9685 + batterie).
  Registres (fiche technique TI) : 0x00 configuration, 0x01 tension de shunt
  (signée, 2,5 µV par pas), 0x02 tension de bus (1,25 mV par pas), 0xFE identifiant
  fabricant (0x5449 = « TI »).
  Le module INA226 courant a un shunt de 0,1 Ω (0,8 A max) : pour des servos il faut
  un shunt de 1 à 2 mΩ (indiquer sa valeur dans config.json).
- ADS1115 : convertisseur analogique 4 voies pour les capteurs de force (FSR) des doigts.
  Mesure « single-shot », gain ±4,096 V (125 µV par pas), 128 mesures/s.
- VL53L1X : distance laser (bibliothèque Pimoroni « vl53l1x »).

Le Pi 5 gère très bien l'I2C en Python : seul le service RasPi de MyRobotLab
(Pi4J 1.x) ne le gère pas, d'où les cartes PCA9685 sur l'Arduino.
"""

import time

INA226_REG_CONFIG = 0x00
INA226_REG_SHUNT = 0x01
INA226_REG_BUS = 0x02
INA226_REG_MANUFACTURER = 0xFE
INA226_MANUFACTURER_TI = 0x5449
# moyenne sur 16 mesures, 1,1 ms par conversion, mesure continue shunt + bus
INA226_CONFIG_AVG16 = 0x4527

ADS1115_REG_CONVERSION = 0x00
ADS1115_REG_CONFIG = 0x01
ADS1115_VOLTS_PER_BIT = 4.096 / 32768


def _signed16(value):
    return value - 0x10000 if value & 0x8000 else value


class INA226:
    def __init__(self, bus, address, shunt_ohm):
        self.bus = bus
        self.address = address
        self.shunt_ohm = float(shunt_ohm)
        if self.shunt_ohm <= 0:
            raise ValueError("valeur de shunt invalide")

    def _read(self, reg):
        hi, lo = self.bus.read_i2c_block_data(self.address, reg, 2)
        return (hi << 8) | lo

    def _write(self, reg, value):
        self.bus.write_i2c_block_data(self.address, reg, [(value >> 8) & 0xFF, value & 0xFF])

    def setup(self):
        if self._read(INA226_REG_MANUFACTURER) != INA226_MANUFACTURER_TI:
            raise OSError("pas d'INA226 à l'adresse 0x%02X" % self.address)
        self._write(INA226_REG_CONFIG, INA226_CONFIG_AVG16)

    def read(self):
        """Renvoie (tension en V, courant en A)."""
        volts = self._read(INA226_REG_BUS) * 1.25e-3
        shunt_v = _signed16(self._read(INA226_REG_SHUNT)) * 2.5e-6
        return volts, shunt_v / self.shunt_ohm


class ADS1115:
    def __init__(self, bus, address, conversion_delay_s=0.009):
        self.bus = bus
        self.address = address
        self.delay = conversion_delay_s

    def read_volts(self, channel):
        if not 0 <= channel <= 3:
            raise ValueError("voie 0 à 3")
        config = (0x8000                      # démarre une conversion
                  | ((4 + channel) << 12)     # entrée AINx par rapport à GND
                  | (0b001 << 9)              # gain ±4,096 V
                  | 0x0100                    # mode single-shot
                  | (0b100 << 5)              # 128 mesures/s
                  | 0x0003)                   # comparateur désactivé
        self.bus.write_i2c_block_data(self.address, ADS1115_REG_CONFIG, [config >> 8, config & 0xFF])
        time.sleep(self.delay)
        hi, lo = self.bus.read_i2c_block_data(self.address, ADS1115_REG_CONVERSION, 2)
        return max(0.0, _signed16((hi << 8) | lo) * ADS1115_VOLTS_PER_BIT)


class DistanceSensor:
    """VL53L1X ; renvoie la distance en mm, ou None si absent."""

    def __init__(self, address=0x29, bus_number=1):
        import VL53L1X  # bibliothèque Pimoroni « vl53l1x »

        self.tof = VL53L1X.VL53L1X(i2c_bus=bus_number, i2c_address=address)
        self.tof.open()
        self.tof.start_ranging(2)  # 2 = distance moyenne (jusqu'à environ 3 m)

    def read_mm(self):
        d = self.tof.get_distance()
        return d if d and d > 0 else None

    def close(self):
        try:
            self.tof.stop_ranging()
        finally:
            self.tof.close()


# Tension par élément (au repos) -> charge, approximative.
# Sous forte charge la tension baisse : l'estimation n'est fiable qu'au calme.
LIFEPO4_TABLE = [(3.00, 0), (3.20, 10), (3.25, 20), (3.28, 40), (3.30, 60),
                 (3.32, 80), (3.35, 95), (3.40, 100)]
LIION_TABLE = [(3.00, 0), (3.45, 10), (3.60, 30), (3.70, 50), (3.80, 65),
               (3.95, 80), (4.10, 95), (4.20, 100)]


def battery_percent(volts, cells, chemistry="lifepo4"):
    table = LIFEPO4_TABLE if chemistry == "lifepo4" else LIION_TABLE
    v = volts / float(cells)
    if v <= table[0][0]:
        return 0
    for (v0, p0), (v1, p1) in zip(table, table[1:]):
        if v <= v1:
            return round(p0 + (p1 - p0) * (v - v0) / (v1 - v0))
    return 100
