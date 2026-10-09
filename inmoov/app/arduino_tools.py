"""Croquis Arduino du projet et commandes arduino-cli pour les compiler / téléverser."""

import json
import os
import subprocess

FQBN_MEGA = "arduino:avr:mega"

# Bibliothèques nécessaires (noms du gestionnaire de bibliothèques Arduino)
LIBRARIES = ["Servo", "SCServo", "Adafruit BNO08x"]


def sketches(settings):
    """Les croquis que l'application sait compiler et téléverser."""
    here = os.path.dirname(os.path.abspath(__file__))
    legs = os.path.normpath(os.path.join(here, "..", "legs", "firmware", "inmoov_legs"))
    mrlcomm = os.path.join(settings["mrl_dir"], "resource", "Arduino", "MrlComm")
    return [
        {
            "id": "mrlcomm",
            "title": "MrlComm (haut du corps)",
            "path": mrlcomm,
            "fqbn": FQBN_MEGA,
            "description": (
                "Programme officiel de MyRobotLab, à téléverser sur l'Arduino Mega du haut du corps "
                "(i01.left). Avec les 3 cartes PCA9685 (onglet Schémas), une seule Mega suffit ; "
                "sans elles, il en faut deux (i01.left et i01.right). Il est fourni avec MyRobotLab : "
                "il doit correspondre à la version de MyRobotLab installée."
            ),
            "before": "Arrêtez MyRobotLab ou déconnectez la carte dans MyRobotLab avant de téléverser (port occupé).",
        },
        {
            "id": "legs",
            "title": "Jambes (inmoov_legs)",
            "path": legs,
            "fqbn": FQBN_MEGA,
            "description": (
                "Firmware des jambes : 12 servos bus Feetech, capteur BNO085, arrêt d'urgence. "
                "À téléverser sur la TROISIÈME Arduino Mega."
            ),
            "before": "Robot accroché au portique. Régler POS_MIN / POS_MAX après calibration.",
        },
    ]


def find_sketch(settings, sketch_id):
    for s in sketches(settings):
        if s["id"] == sketch_id:
            return s
    return None


def sketch_info(sketch):
    """Ajoute l'état (présent ou non) et la liste des fichiers source."""
    info = dict(sketch)
    info["exists"] = os.path.isfile(os.path.join(sketch["path"], os.path.basename(sketch["path"]) + ".ino"))
    files = []
    if os.path.isdir(sketch["path"]):
        for name in sorted(os.listdir(sketch["path"])):
            if name.endswith((".ino", ".h", ".cpp", ".c")):
                files.append(name)
    info["files"] = files
    return info


def read_source(sketch, filename):
    if filename not in sketch_info(sketch)["files"]:
        raise FileNotFoundError(filename)
    with open(os.path.join(sketch["path"], filename), "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def setup_commands(cli):
    return [
        [cli, "core", "update-index"],
        [cli, "core", "install", "arduino:avr"],
        [cli, "lib", "update-index"],
        [cli, "lib", "install"] + LIBRARIES,
    ]


def compile_command(cli, sketch, port=None):
    cmd = [cli, "compile", "--fqbn", sketch["fqbn"], sketch["path"]]
    if port:
        cmd[2:2] = ["--upload", "--port", port]
    return cmd


def list_boards(cli, run=subprocess.run):
    """Cartes branchées, d'après `arduino-cli board list --format json`."""
    try:
        res = run([cli, "board", "list", "--format", "json"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": "arduino-cli indisponible : %s" % e, "boards": []}
    if res.returncode != 0:
        return {"ok": False, "error": res.stderr.strip() or res.stdout.strip(), "boards": []}
    try:
        data = json.loads(res.stdout or "[]")
    except ValueError:
        return {"ok": False, "error": "réponse illisible d'arduino-cli", "boards": []}
    ports = data.get("detected_ports", []) if isinstance(data, dict) else data
    boards = []
    for entry in ports:
        port = entry.get("port", {})
        matching = entry.get("matching_boards") or entry.get("boards") or []
        if port.get("protocol") not in (None, "serial"):
            continue
        boards.append({
            "port": port.get("address"),
            "label": port.get("label") or port.get("address"),
            "name": matching[0].get("name") if matching else "carte inconnue",
            "fqbn": matching[0].get("fqbn") if matching else None,
        })
    return {"ok": True, "error": None, "boards": boards}
