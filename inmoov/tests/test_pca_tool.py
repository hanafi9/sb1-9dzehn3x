"""Le programme d'essai du PCA9685 écrit les bons registres (PCA9685 simulé)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import test_pca9685 as T  # noqa: E402


class FakeBus:
    def __init__(self, present=(0x40,)):
        self.present, self.regs, self.log = set(present), {}, []

    def _check(self, addr):
        if addr not in self.present:
            raise OSError(121, "Remote I/O error")

    def read_byte(self, addr):
        self._check(addr)
        return 0

    def read_byte_data(self, addr, reg):
        self._check(addr)
        return self.regs.get(reg, 0x11)          # MODE1 au démarrage : SLEEP | ALLCALL

    def write_byte_data(self, addr, reg, val):
        self._check(addr)
        self.regs[reg] = val
        self.log.append((reg, val))

    def write_i2c_block_data(self, addr, reg, data):
        self._check(addr)
        for i, v in enumerate(data):
            self.regs[reg + i] = v
        self.log.append((reg, list(data)))


class PCA9685ToolTest(unittest.TestCase):
    def test_prescale_and_ticks(self):
        self.assertEqual(T.prescale_for(50), 121)          # 25 MHz / (4096 x 50) = 122,07 -> 121
        self.assertEqual(T.ticks_for(1500, 50), 307)        # 1,5 ms sur une période de 20 ms
        self.assertEqual(T.angle_to_us(90, 1000, 2000), 1500)
        self.assertEqual(T.angle_to_us(500, 1000, 2000), 2000)

    def test_init_sequence(self):
        bus = FakeBus()
        T.PCA9685(bus)
        regs = [r for r, _ in bus.log]
        self.assertLess(regs.index(T.MODE1), regs.index(T.PRE_SCALE))   # sommeil avant PRE_SCALE
        self.assertEqual(bus.log[0], (T.MODE1, 0x11))
        self.assertEqual(bus.regs[T.PRE_SCALE], 121)
        self.assertEqual(bus.regs[T.MODE2], T.OUTDRV)
        self.assertEqual(bus.regs[T.MODE1], T.AI | T.ALLCALL | T.RESTART)
        self.assertFalse(bus.regs[T.MODE1] & T.SLEEP)

    def test_angle_command(self):
        bus = FakeBus()
        self.assertEqual(T.main(["--canal", "3", "--angle", "90"], bus=bus), 0)
        base = T.LED0_ON_L + 4 * 3
        self.assertEqual([bus.regs[base + i] for i in range(4)], [0, 0, 307 & 0xFF, 307 >> 8])

    def test_off_and_scan(self):
        bus = FakeBus(present=(0x40, 0x70))
        T.main(["--off"], bus=bus)
        self.assertEqual(bus.regs[T.ALL_LED_ON_L + 3], T.FULL_OFF)
        self.assertEqual(T.scan(bus), [0x40, 0x70])

    def test_absent_module(self):
        with self.assertRaises(SystemExit):
            T.main(["--canal", "0", "--angle", "90"], bus=FakeBus(present=()))


if __name__ == "__main__":
    unittest.main()
