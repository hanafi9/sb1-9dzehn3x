"""Petit client pour l'API REST de MyRobotLab (WebGui, port 8888 par défaut).

Format utilisé par WebGui :
    POST http://<hote>:<port>/api/service/<service>/<methode>
    corps = tableau JSON des paramètres, ex. [90]

Uniquement la bibliothèque standard : ce fichier est partagé par le
programme vision (Python 3.9 + Coral) et le programme voix.
"""

import json
import logging
import queue
import threading
import urllib.error
import urllib.request

log = logging.getLogger("mrl")


class MrlClient:
    def __init__(self, base_url="http://127.0.0.1:8888", timeout=2.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def call(self, service, method, *params):
        """Appelle service.method(*params) et renvoie la réponse décodée (ou None)."""
        return self.call_checked(service, method, *params)[1]

    def call_checked(self, service, method, *params):
        """Comme call(), mais renvoie (succès, réponse) pour distinguer une méthode
        qui ne renvoie rien d'un MyRobotLab injoignable."""
        url = "%s/api/service/%s/%s" % (self.base_url, service, method)
        body = json.dumps(list(params)).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except (urllib.error.URLError, OSError) as e:
            log.warning("Appel MRL échoué %s.%s%s : %s", service, method, params, e)
            return False, None
        if not raw:
            return True, None
        try:
            return True, json.loads(raw)
        except ValueError:
            return True, raw


class AsyncMrlClient(MrlClient):
    """Envoie les commandes dans un thread séparé pour ne jamais bloquer la boucle
    caméra. Si MRL est lent, seules les commandes les plus récentes sont gardées."""

    def __init__(self, base_url="http://127.0.0.1:8888", timeout=2.0, max_pending=4):
        super().__init__(base_url, timeout)
        self._queue = queue.Queue(maxsize=max_pending)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def send(self, service, method, *params):
        item = (service, method, params)
        while True:
            try:
                self._queue.put_nowait(item)
                return
            except queue.Full:
                try:
                    self._queue.get_nowait()  # on jette la plus ancienne
                except queue.Empty:
                    pass

    def _run(self):
        while True:
            service, method, params = self._queue.get()
            self.call(service, method, *params)


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
