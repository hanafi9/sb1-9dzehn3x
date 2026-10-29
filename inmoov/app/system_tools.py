"""État du système : Coral USB, ports série, services systemd."""

import glob
import subprocess

SERVICES = {
    "inmoov-vision": "Suivi de visage (Coral)",
    "inmoov-voice": "Voix + IA",
    "inmoov-sensors": "Capteurs (courant, batterie, toucher)",
}

CORAL_USB_IDS = ("1a6e:089a", "18d1:9302")  # avant / après initialisation


def coral_present(run=subprocess.run):
    try:
        out = run(["lsusb"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None  # inconnu
    return any(i in out for i in CORAL_USB_IDS)


def serial_ports():
    return sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))


def service_state(name, run=subprocess.run):
    try:
        res = run(["systemctl", "is-active", name], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return "inconnu"
    return res.stdout.strip() or "inconnu"


def service_action(name, action, run=subprocess.run):
    """Démarre / arrête / redémarre un service (sudo sans mot de passe nécessaire, voir README)."""
    if name not in SERVICES or action not in ("start", "stop", "restart"):
        raise ValueError("action non autorisée")
    res = run(["sudo", "-n", "systemctl", action, name], capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or "échec de systemctl %s %s" % (action, name))


def service_logs(name, lines=60, run=subprocess.run):
    if name not in SERVICES:
        raise ValueError("service inconnu")
    try:
        res = run(["journalctl", "-u", name, "-n", str(int(lines)), "--no-pager"],
                  capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as e:
        return "journal indisponible : %s" % e
    return res.stdout or res.stderr
