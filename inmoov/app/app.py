#!/usr/bin/env python3
"""Atelier InMoov : application web pour monter, programmer et régler le robot.

À lancer sur le Raspberry Pi 5, puis à ouvrir depuis un téléphone ou un PC du
même réseau : http://<adresse-du-pi>:8090

    python app.py                       # écoute sur 0.0.0.0:8090
    INMOOV_APP_PASSWORD=secret python app.py   # protège l'accès par mot de passe

Onglets : tableau de bord, guide de montage, servos (tête, cou, bras, mains,
torse), Arduino (code, compilation, téléversement), jambes, services, réglages.
"""

import argparse
import functools
import hmac
import json
import os
import sys
import threading

from flask import Flask, Response, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
sys.path[:0] = [ROOT, os.path.join(ROOT, "legs")]

import arduino_tools  # noqa: E402
import servo_inventory  # noqa: E402
import system_tools  # noqa: E402
import wiring  # noqa: E402
from jobs import JobRunner  # noqa: E402
from mrl_client import MrlClient  # noqa: E402

DEFAULT_SETTINGS = {
    "mrl_url": "http://127.0.0.1:8888",
    "mrl_dir": "/home/pi/mrl",
    "arduino_cli": "arduino-cli",
    "robot_config": os.path.join(ROOT, "config.json"),
    "legs_config": os.path.join(ROOT, "legs", "legs_config.json"),
}
EDITABLE_CONFIGS = {"robot": "robot_config", "legs": "legs_config"}


# ----------------------------------------------------------------- stockage
class JsonStore:
    """Petit fichier JSON écrit de façon atomique (pas de fichier à moitié écrit)."""

    def __init__(self, path, default):
        self.path = path
        self.default = default
        self.lock = threading.Lock()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return json.loads(json.dumps(self.default))

    def save(self, data):
        with self.lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)


class LegsManager:
    """Connexion (facultative) à l'Arduino des jambes."""

    def __init__(self):
        self.link = None
        self.lock = threading.Lock()

    def connect(self, port):
        import legs_controller

        with self.lock:
            if self.link is None:
                self.link = legs_controller.LegsLink(port)
        return self.link

    def disconnect(self):
        with self.lock:
            if self.link is not None:
                try:
                    self.link.hold()
                finally:
                    self.link.close()
                    self.link = None


# ----------------------------------------------------------------- application
def create_app(data_dir=None, run=None, mrl=None):
    """data_dir : où ranger réglages, calibration et avancement du guide.
    run / mrl : remplaçables pour les tests."""
    import subprocess

    run = run or subprocess.run
    data_dir = data_dir or os.path.join(HERE, "data")
    settings_store = JsonStore(os.path.join(data_dir, "settings.json"), DEFAULT_SETTINGS)
    calib_store = JsonStore(os.path.join(data_dir, "servo_calibration.json"),
                            servo_inventory.default_calibration())
    progress_store = JsonStore(os.path.join(data_dir, "guide_progress.json"), {})
    parts_store = JsonStore(os.path.join(data_dir, "parts_progress.json"), {})
    jobs = JobRunner()
    legs = LegsManager()

    with open(os.path.join(HERE, "guide.json"), encoding="utf-8") as f:
        guide = json.load(f)
    guide_ids = {s["id"] for p in guide for s in p["steps"]}

    def settings():
        s = dict(DEFAULT_SETTINGS)
        s.update(settings_store.load())
        return s

    def mrl_client():
        return mrl or MrlClient(settings()["mrl_url"], timeout=3.0)

    app = Flask(__name__, static_folder=os.path.join(HERE, "static"), static_url_path="/static")
    password = os.environ.get("INMOOV_APP_PASSWORD")

    @app.before_request
    def check_password():
        if not password:
            return None
        auth = request.authorization
        if auth and auth.password and hmac.compare_digest(auth.password, password):
            return None
        return Response("Mot de passe requis", 401, {"WWW-Authenticate": 'Basic realm="Atelier InMoov"'})

    def api(fn):
        """Transforme les erreurs en réponses JSON lisibles par l'interface."""
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            try:
                return fn(*a, **kw)
            except (ValueError, KeyError, FileNotFoundError) as e:
                return jsonify({"ok": False, "error": str(e)}), 400
            except (RuntimeError, TimeoutError, OSError) as e:
                return jsonify({"ok": False, "error": str(e)}), 502
        return wrapper

    def body():
        return request.get_json(silent=True) or {}

    # ---------------------------------------------------------- pages
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    # ---------------------------------------------------------- tableau de bord
    @app.get("/api/status")
    @api
    def status():
        client = mrl_client()
        ok, version = client.call_checked("runtime", "getVersion")
        uptime = client.call("runtime", "getUptime") if ok else None
        return jsonify({
            "mrl": {"ok": ok, "version": version, "uptime": uptime, "url": settings()["mrl_url"]},
            "coral": system_tools.coral_present(run),
            "serial_ports": system_tools.serial_ports(),
            "services": {n: {"label": l, "state": system_tools.service_state(n, run)}
                         for n, l in system_tools.SERVICES.items()},
            "legs_connected": legs.link is not None,
        })

    # ---------------------------------------------------------- guide
    @app.get("/api/guide")
    def get_guide():
        return jsonify({"phases": guide, "done": progress_store.load()})

    @app.post("/api/guide/<step_id>")
    @api
    def set_step(step_id):
        if step_id not in guide_ids:
            raise ValueError("étape inconnue")
        done = progress_store.load()
        done[step_id] = bool(body().get("done"))
        progress_store.save(done)
        return jsonify({"ok": True, "done": done})

    # ---------------------------------------------------------- servos
    def check_service(service):
        if service not in servo_inventory.all_services():
            raise ValueError("servo inconnu : %s" % service)

    def mrl_call(service, method, *params):
        ok, value = mrl_client().call_checked(service, method, *params)
        if not ok:
            raise RuntimeError("MyRobotLab injoignable (%s)" % settings()["mrl_url"])
        return value

    @app.get("/api/servos")
    def get_servos():
        groups = servo_inventory.groups_with(calib_store.load())
        for g in groups:
            for s in g["servos"]:
                board, channel, model = wiring.SERVO_PLAN[s["service"]]
                s["pca"] = {"board": board, "address": wiring.board_by_name(board)["address"],
                            "channel": channel, "model": model}
        return jsonify({"groups": groups})

    @app.post("/api/servos/<service>/move")
    @api
    def move_servo(service):
        check_service(service)
        pos = float(body()["pos"])
        if not 0 <= pos <= 180:
            raise ValueError("position entre 0 et 180")
        mrl_call(service, "moveTo", pos)
        return jsonify({"ok": True})

    @app.post("/api/servos/<service>/action")
    @api
    def servo_action(service):
        check_service(service)
        action = body().get("action")
        if action not in ("rest", "enable", "disable"):
            raise ValueError("action inconnue")
        mrl_call(service, action)
        return jsonify({"ok": True})

    @app.get("/api/servos/<service>/position")
    @api
    def servo_position(service):
        check_service(service)
        return jsonify({"ok": True, "pos": mrl_call(service, "getCurrentInputPos")})

    def apply_calibration(service, cal):
        mrl_call(service, "setMinMaxOutput", cal["min_out"], cal["max_out"])
        mrl_call(service, "setInverted", cal["inverted"])
        mrl_call(service, "setRest", cal["rest"])
        if cal["speed"]:
            mrl_call(service, "setSpeed", cal["speed"])

    @app.put("/api/servos/<service>/calibration")
    @api
    def save_calibration(service):
        check_service(service)
        data = body()
        cal = servo_inventory.validate_calibration(data)
        all_cal = calib_store.load()
        all_cal[service] = cal
        calib_store.save(all_cal)
        if data.get("apply"):
            apply_calibration(service, cal)
        return jsonify({"ok": True, "calibration": cal, "applied": bool(data.get("apply"))})

    @app.post("/api/servos/apply_all")
    @api
    def apply_all():
        errors = []
        for service, cal in calib_store.load().items():
            try:
                apply_calibration(service, servo_inventory.validate_calibration(cal))
            except (RuntimeError, ValueError) as e:
                errors.append("%s : %s" % (service, e))
                if "injoignable" in str(e):
                    break
        return jsonify({"ok": not errors, "errors": errors})

    @app.post("/api/servos/reset_defaults")
    @api
    def reset_defaults():
        calib_store.save(servo_inventory.default_calibration())
        return jsonify({"ok": True})

    @app.post("/api/mrl/save_config")
    @api
    def save_mrl_config():
        name = str(body().get("name") or "").strip()
        if not name or any(c in name for c in "/\\.") or len(name) > 60:
            raise ValueError("nom de configuration invalide")
        saved = mrl_call("runtime", "saveConfig", name)
        return jsonify({"ok": saved is not False, "result": saved})

    # ---------------------------------------------------------- schémas
    part_keys = {p["key"] for p in wiring.PARTS}

    @app.get("/api/schema")
    def schema_overview():
        return jsonify({
            "parts": [{"key": p["key"], "label": p["label"]} for p in wiring.PARTS],
            "boards": wiring.BOARDS,
            "arduino": wiring.ARDUINO,
            "stl_viewer": wiring.STL_VIEWER,
        })

    @app.get("/api/schema/<part_key>")
    @api
    def schema_part(part_key):
        part = next((p for p in wiring.PARTS if p["key"] == part_key), None)
        if part is None:
            raise ValueError("partie inconnue")
        groups = servo_inventory.groups_with(calib_store.load())
        view = wiring.part_view(part, groups, legs_cfg() if part.get("legs") else None)
        done = parts_store.load()
        for g in view["printed"]:
            g["done"] = [bool(done.get("%s|%s|%s" % (part_key, g["group"], i))) for i in g["items"]]
        return jsonify(view)

    @app.post("/api/schema/<part_key>/printed")
    @api
    def mark_printed(part_key):
        if part_key not in part_keys:
            raise ValueError("partie inconnue")
        data = body()
        key = "%s|%s|%s" % (part_key, data["group"], data["item"])
        done = parts_store.load()
        done[key] = bool(data.get("done"))
        parts_store.save(done)
        return jsonify({"ok": True})

    @app.get("/api/schema/mrl_script")
    def schema_script():
        return Response(wiring.mrl_script(), mimetype="text/plain; charset=utf-8")

    @app.post("/api/schema/apply")
    @api
    def schema_apply():
        if not body().get("confirm"):
            raise ValueError("confirmation requise")
        done = 0
        for service, method, params in wiring.mrl_calls():
            mrl_call(service, method, *params)
            done += 1
        return jsonify({"ok": True, "calls": done})

    # ---------------------------------------------------------- arduino
    def sketch_or_404(sketch_id):
        s = arduino_tools.find_sketch(settings(), sketch_id)
        if s is None:
            raise ValueError("croquis inconnu")
        return s

    @app.get("/api/arduino/sketches")
    def get_sketches():
        return jsonify({"sketches": [arduino_tools.sketch_info(s) for s in arduino_tools.sketches(settings())],
                        "libraries": arduino_tools.LIBRARIES})

    @app.get("/api/arduino/sketches/<sketch_id>/source/<filename>")
    @api
    def get_source(sketch_id, filename):
        return jsonify({"ok": True, "source": arduino_tools.read_source(sketch_or_404(sketch_id), filename)})

    @app.get("/api/arduino/boards")
    def get_boards():
        res = arduino_tools.list_boards(settings()["arduino_cli"], run)
        by_id = []
        if os.path.isdir("/dev/serial/by-id"):
            by_id = [{"path": os.path.join("/dev/serial/by-id", n),
                      "target": os.path.realpath(os.path.join("/dev/serial/by-id", n))}
                     for n in sorted(os.listdir("/dev/serial/by-id"))]
        res["by_id"] = by_id
        return jsonify(res)

    @app.post("/api/arduino/setup")
    @api
    def arduino_setup():
        job = jobs.start("Installation du cœur AVR et des bibliothèques",
                         arduino_tools.setup_commands(settings()["arduino_cli"]))
        return jsonify({"ok": True, "job": job.id})

    @app.post("/api/arduino/<action>")
    @api
    def arduino_build(action):
        if action not in ("compile", "upload"):
            raise ValueError("action inconnue")
        data = body()
        sketch = sketch_or_404(data.get("sketch"))
        if not arduino_tools.sketch_info(sketch)["exists"]:
            raise FileNotFoundError("croquis introuvable : %s" % sketch["path"])
        port = None
        if action == "upload":
            port = data.get("port")
            if not port or not str(port).startswith("/dev/"):
                raise ValueError("choisissez le port de la carte")
        cmd = arduino_tools.compile_command(settings()["arduino_cli"], sketch, port)
        title = ("Téléversement de %s sur %s" % (sketch["title"], port)) if port else "Compilation de %s" % sketch["title"]
        job = jobs.start(title, [cmd])
        return jsonify({"ok": True, "job": job.id})

    @app.get("/api/jobs/<int:job_id>")
    def get_job(job_id):
        job = jobs.get(job_id)
        if job is None:
            return jsonify({"ok": False, "error": "tâche inconnue"}), 404
        return jsonify(job.to_dict())

    # ---------------------------------------------------------- jambes
    def legs_cfg():
        import legs_controller

        path = settings()["legs_config"]
        if not os.path.isfile(path):
            path = os.path.join(ROOT, "legs", "legs_config.example.json")
        return legs_controller.load_config(path)

    def legs_link():
        if legs.link is None:
            raise RuntimeError("jambes non connectées")
        return legs.link

    def require_gantry():
        if not body().get("gantry_ok"):
            raise ValueError("confirmez que le robot est accroché au portique")

    @app.get("/api/legs")
    @api
    def legs_info():
        cfg = legs_cfg()
        info = {"connected": legs.link is not None, "port": cfg["serial_port"],
                "poses": list(cfg["poses"]), "sequences": list(cfg["sequences"]),
                "joints": {n: j["id"] for n, j in cfg["joints"].items()}}
        if legs.link is not None:
            info["status"] = legs.link.status()
        return jsonify(info)

    @app.post("/api/legs/connect")
    @api
    def legs_connect():
        legs.connect(body().get("port") or legs_cfg()["serial_port"])
        return jsonify({"ok": True})

    @app.post("/api/legs/disconnect")
    @api
    def legs_disconnect():
        legs.disconnect()
        return jsonify({"ok": True})

    @app.post("/api/legs/<command>")
    @api
    def legs_command(command):
        import legs_controller

        link = legs_link()
        data = body()
        if command == "hold":
            link.hold()
        elif command == "reset":
            require_gantry()
            link.reset()
        elif command == "torque":
            require_gantry()
            link.torque(bool(data.get("on")))
        elif command == "pose":
            require_gantry()
            cfg = legs_cfg()
            pose = cfg["poses"][data["name"]]
            duration = max(300, int(data.get("time", 3000)))
            link.move(legs_controller.pose_targets(cfg, pose), duration)
        else:
            raise ValueError("commande inconnue")
        return jsonify({"ok": True})

    # ---------------------------------------------------------- services
    @app.post("/api/services/<name>/<action>")
    @api
    def service_action(name, action):
        system_tools.service_action(name, action, run)
        return jsonify({"ok": True})

    @app.get("/api/services/<name>/logs")
    @api
    def service_logs(name):
        return jsonify({"ok": True, "logs": system_tools.service_logs(name, run=run)})

    # ---------------------------------------------------------- réglages et configs
    @app.get("/api/settings")
    def get_settings():
        return jsonify(settings())

    @app.put("/api/settings")
    @api
    def put_settings():
        data = body()
        new = {k: str(data[k]).strip() for k in DEFAULT_SETTINGS if k in data}
        if "mrl_url" in new and not new["mrl_url"].startswith(("http://", "https://")):
            raise ValueError("l'adresse de MyRobotLab doit commencer par http://")
        current = settings()
        current.update(new)
        settings_store.save(current)
        return jsonify({"ok": True, "settings": current})

    @app.get("/api/config/<name>")
    @api
    def get_config(name):
        path = settings()[EDITABLE_CONFIGS[name]]
        example = {"robot": os.path.join(ROOT, "config.example.json"),
                   "legs": os.path.join(ROOT, "legs", "legs_config.example.json")}[name]
        exists = os.path.isfile(path)
        with open(path if exists else example, "r", encoding="utf-8") as f:
            text = f.read()
        return jsonify({"ok": True, "path": path, "exists": exists, "text": text})

    @app.put("/api/config/<name>")
    @api
    def put_config(name):
        path = settings()[EDITABLE_CONFIGS[name]]
        text = body().get("text", "")
        try:
            data = json.loads(text)
        except ValueError as e:
            raise ValueError("JSON invalide : %s" % e)
        if name == "legs":
            import legs_controller

            for pose in data.get("poses", {}).values():
                legs_controller.pose_targets(data, pose)  # refuse une pose hors limites
        if os.path.isfile(path):
            os.replace(path, path + ".bak")
        JsonStore(path, {}).save(data)
        return jsonify({"ok": True, "path": path})

    return app


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8090)
    a = p.parse_args()
    if port_in_use(a.port):
        # Sous Windows, un autre site déjà lancé sur ce port (127.0.0.1) prendrait le dessus
        # sans erreur : http://localhost:<port> afficherait cet autre site au lieu de l'Atelier.
        print("Le port %d est déjà utilisé par un autre programme (un autre site web ?).\n"
              "Lancez l'Atelier sur un autre port, par exemple :\n"
              "    python app.py --port %d\n"
              "puis ouvrez http://localhost:%d" % (a.port, a.port + 1, a.port + 1))
        return 1
    print("Atelier InMoov : ouvrez http://localhost:%d" % a.port)
    create_app().run(host=a.host, port=a.port, threaded=True)


def port_in_use(port):
    import socket

    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


if __name__ == "__main__":
    sys.exit(main())
