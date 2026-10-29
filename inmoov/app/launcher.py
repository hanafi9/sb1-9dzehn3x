"""Lancer les programmes du robot depuis l'Atelier, sans ligne de commande ni systemd.

Chaque programme tourne avec le Python de son environnement (.venv-vision, .venv-voice…),
les clés de anthropic.env, et écrit son journal dans app/data/logs/<nom>.log (le précédent
est gardé en <nom>.log.1). Un programme lancé à la main ou par systemd est reconnu aussi :
l'Atelier ne le lance pas une deuxième fois (deux programmes se disputeraient micro et caméra).
"""

import os
import signal
import subprocess
import time

PROGRAMS = {
    # ordre = ordre de « Tout démarrer » : MyRobotLab, puis la vision, que la voix lit ensuite
    "mrl": {"label": "MyRobotLab (servos, InMoov2)", "kind": "mrl"},
    "vision": {"label": "Caméras et suivi (Coral)", "dir": "vision", "venv": ".venv-vision",
               "script": "face_tracker.py"},
    "voice": {"label": "Kamil : voix et IA", "dir": "voice", "venv": ".venv-voice",
              "script": "speech_listener.py", "env_file": "anthropic.env"},
    "sensors": {"label": "Capteurs (courant, batterie, toucher)", "dir": "sensors", "venv": ".venv-sensors",
                "script": "sensor_hub.py"},
}


def read_env_file(path):
    """KEY=valeur par ligne (comme anthropic.env) ; guillemets autour de la valeur retirés."""
    env = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key.startswith("export "):
                    key = key[7:].strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                env[key] = value
    except OSError:
        pass
    return env


class Launcher:
    def __init__(self, root, log_dir, config_path, mrl_dir=lambda: "", mrl_args=lambda: "", proc_dir="/proc",
                 popen=subprocess.Popen, kill=os.kill, clock=time.monotonic, sleep=time.sleep):
        """config_path, mrl_dir : fonctions (les réglages de l'Atelier peuvent changer)."""
        self.root = root
        self.log_dir = log_dir
        self.config_path = config_path
        self.mrl_dir = mrl_dir
        self.mrl_args = mrl_args
        self.proc_dir = proc_dir
        self.popen = popen
        self.kill = kill
        self.clock = clock
        self.sleep = sleep
        self.started = {}   # nom -> instant du lancement par l'Atelier
        self.children = []  # programmes lancés ici, à « ramasser » quand ils s'arrêtent

    # ------------------------------------------------------------ commandes
    def command(self, name):
        """(liste des arguments, dossier de travail) ou ValueError si le programme n'est pas installé."""
        prog = PROGRAMS[name]
        if prog.get("kind") == "mrl":
            folder = self.mrl_dir()
            args = (self.mrl_args() or "").split()
            script = os.path.join(folder, "myrobotlab.sh")
            if os.path.isfile(script):
                return ["/bin/bash", script] + args, folder
            if os.path.isfile(os.path.join(folder, "myrobotlab.jar")):   # installation sans le script
                return ["java", "-jar", "myrobotlab.jar"] + args, folder
            raise ValueError("ni myrobotlab.sh ni myrobotlab.jar dans %s (onglet Réglages : dossier de MyRobotLab)"
                             % (folder or "?"))
        python = os.path.join(self.root, prog["venv"], "bin", "python")
        if not os.path.isfile(python):
            raise ValueError("environnement %s absent : programme pas encore installé (voir README)" % prog["venv"])
        folder = os.path.join(self.root, prog["dir"])
        return [python, prog["script"], "--config", self.config_path()], folder

    def _matches(self, name, argv):
        prog = PROGRAMS[name]
        if prog.get("kind") == "mrl":
            return any("myrobotlab" in a.lower() for a in argv) and any(
                os.path.basename(a) in ("java", "myrobotlab.sh") for a in argv[:2])
        return any(os.path.basename(a) == prog["script"] for a in argv[1:3]) and "python" in os.path.basename(argv[0])

    def pids(self, name):
        self.children = [c for c in self.children if c.poll() is None]   # pas de processus zombie
        found = []
        try:
            entries = os.listdir(self.proc_dir)
        except OSError:
            return found
        for entry in entries:
            if not entry.isdigit() or int(entry) == os.getpid():
                continue
            try:
                with open(os.path.join(self.proc_dir, entry, "cmdline"), "rb") as f:
                    argv = [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
            except OSError:
                continue
            if argv and self._matches(name, argv):
                found.append(int(entry))
        return sorted(found)

    # ------------------------------------------------------------ actions
    def status(self):
        out = {}
        for name, prog in PROGRAMS.items():
            try:
                self.command(name)
                installed, problem = True, None
            except ValueError as e:
                installed, problem = False, str(e)
            pids = self.pids(name)
            out[name] = {"label": prog["label"], "running": bool(pids), "pids": pids,
                         "installed": installed, "problem": problem,
                         "since_s": round(self.clock() - self.started[name]) if pids and name in self.started else None}
        return out

    def start(self, name):
        if name not in PROGRAMS:
            raise ValueError("programme inconnu")
        if self.pids(name):
            return "déjà en marche"
        argv, folder = self.command(name)
        env = dict(os.environ)
        env.update(read_env_file(os.path.join(self.root, PROGRAMS[name].get("env_file", "anthropic.env"))))
        env["PYTHONUNBUFFERED"] = "1"     # journal écrit au fil de l'eau
        os.makedirs(self.log_dir, exist_ok=True)
        log_path = os.path.join(self.log_dir, name + ".log")
        if os.path.exists(log_path):
            os.replace(log_path, log_path + ".1")
        with open(log_path, "wb") as log:
            # nouvelle session : le programme continue si l'Atelier est relancé
            self.children.append(self.popen(argv, cwd=folder, env=env, stdout=log, stderr=subprocess.STDOUT,
                                            stdin=subprocess.DEVNULL, start_new_session=True))
        self.started[name] = self.clock()
        return "démarré"

    def stop(self, name, timeout=8.0):
        if name not in PROGRAMS:
            raise ValueError("programme inconnu")
        pids = self.pids(name)
        if not pids:
            return "déjà arrêté"
        for sig in (signal.SIGTERM, signal.SIGKILL):
            for pid in pids:
                try:
                    self.kill(pid, sig)
                except ProcessLookupError:
                    pass
                except PermissionError:
                    raise RuntimeError("programme lancé par un autre utilisateur (systemd ?) : "
                                       "arrêtez-le depuis la carte Services")
            end = self.clock() + timeout
            while self.clock() < end and self.pids(name):
                self.sleep(0.2)
            pids = self.pids(name)
            if not pids:
                break
        self.started.pop(name, None)
        return "arrêté" if not pids else "toujours en marche"

    def restart(self, name):
        self.stop(name)
        return self.start(name)

    def logs(self, name, lines=120):
        if name not in PROGRAMS:
            raise ValueError("programme inconnu")
        path = os.path.join(self.log_dir, name + ".log")
        try:
            with open(path, "rb") as f:
                f.seek(0, os.SEEK_END)
                f.seek(max(0, f.tell() - 200000))
                text = f.read().decode("utf-8", "replace")
        except OSError:
            return "Pas encore de journal : ce programme n'a pas été lancé depuis l'Atelier."
        return "\n".join(text.splitlines()[-lines:])
