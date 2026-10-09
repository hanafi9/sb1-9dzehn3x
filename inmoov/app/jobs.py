"""Tâches longues (compilation, téléversement...) lancées en arrière-plan.

L'interface lance une tâche puis interroge /api/jobs/<id> pour afficher le journal.
"""

import itertools
import subprocess
import threading
import time

_ids = itertools.count(1)


class Job:
    def __init__(self, title, commands):
        self.id = next(_ids)
        self.title = title
        self.commands = commands  # liste de listes d'arguments, exécutées dans l'ordre
        self.log = []
        self.state = "en attente"
        self.started = time.time()
        self.returncode = None

    def to_dict(self):
        return {"id": self.id, "title": self.title, "state": self.state,
                "returncode": self.returncode, "log": "".join(self.log)}


class JobRunner:
    """Une seule tâche à la fois (on ne compile pas deux croquis en même temps)."""

    def __init__(self, timeout_s=900):
        self.timeout_s = timeout_s
        self.jobs = {}
        self.lock = threading.Lock()
        self.current = None

    def start(self, title, commands):
        with self.lock:
            if self.current is not None and self.current.state == "en cours":
                raise RuntimeError("une tâche est déjà en cours : %s" % self.current.title)
            job = Job(title, commands)
            job.state = "en cours"
            self.jobs[job.id] = job
            self.current = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def get(self, job_id):
        return self.jobs.get(job_id)

    def _run(self, job):
        rc = 0
        for cmd in job.commands:
            job.log.append("$ %s\n" % " ".join(cmd))
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1)
            except OSError as e:
                job.log.append("Impossible de lancer la commande : %s\n" % e)
                rc = 127
                break
            deadline = time.time() + self.timeout_s
            for line in proc.stdout:
                job.log.append(line)
                if time.time() > deadline:
                    proc.kill()
                    job.log.append("\nDélai dépassé, commande arrêtée.\n")
                    break
            proc.stdout.close()
            rc = proc.wait()
            if rc != 0:
                break
        job.returncode = rc
        job.state = "réussi" if rc == 0 else "échec"
