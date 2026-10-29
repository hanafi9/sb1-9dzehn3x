"""Surveillance : Kamil garde un journal de tout ce qui se passe devant ses deux caméras.

Toutes les secondes, il lit ce que voit le Coral (vision/face_tracker.py) et note dans
data/journal.jsonl :
- les arrivées et départs de personnes (visage ou silhouette) ;
- les mouvements quand personne n'est en vue (caméra 1 ou 2, à gauche / au centre / à droite) ;
- les objets qui apparaissent ou disparaissent.
Pour les arrivées et les mouvements, une photo est gardée dans data/surveillance/.

On peut ensuite lui demander « qu'est-ce qui s'est passé pendant mon absence ? » ou « montre-moi
qui est passé » (outil surveillance de Claude). En mode garde, une arrivée ou un mouvement
déclenche une alerte : Kamil interpelle la personne et Home Assistant peut prévenir un téléphone.

Tout reste sur le Pi ; aucune image n'est envoyée sur Internet, sauf quand on demande à Claude de
regarder une photo.
"""

import json
import logging
import os
import shutil
import threading
import time

from perception import read_vision

log = logging.getLogger("watch")

DEFAULTS = {
    "enabled": True,
    "poll_s": 1.0,
    "journal_path": "data/journal.jsonl",
    "snapshots_dir": "data/surveillance",
    "frame_paths": ["/dev/shm/inmoov_frame.jpg", "/dev/shm/inmoov_frame2.jpg"],
    "max_snapshots": 300,
    "gone_after_s": 10,          # plus personne depuis ce temps = départ
    "motion_threshold": 0.03,    # part de l'image qui bouge pour compter un mouvement
    "motion_every_s": 60,        # au plus un mouvement noté par minute et par caméra
    "object_confirm": 5,         # vu 5 fois de suite avant de le noter
    "object_gone_s": 120,        # absent 2 min avant de le dire disparu (le Coral « clignote » sur les meubles)
    "ignored_objects": ["personne", "chaise", "table", "lit", "canapé", "plante en pot", "télévision"],
    "notify_service": None,      # ex. "notify.mobile_app_mon_telephone" (Home Assistant)
    "exit_delay_s": 30,          # mode garde : le temps de partir avant que la surveillance commence
    "realert_s": 300,            # quelqu'un reste en vue : nouvelle alerte au plus toutes les 5 min
    "guard_path": None,          # le mode garde reste actif si Kamil redémarre (défaut : à côté du journal)
}


def side_of_box(box):
    cx = (box[0] + box[2]) / 2.0
    return "à gauche" if cx < 0.33 else "à droite" if cx > 0.66 else "au centre"


def clock_text(t):
    lt = time.localtime(t)
    return "%d h %02d" % (lt.tm_hour, lt.tm_min)


class Watcher:
    def __init__(self, cfg, vision_state_path, base_dir=".", clock=time.time):
        self.cfg = dict(DEFAULTS)
        self.cfg.update(cfg or {})
        self.path = vision_state_path
        self.clock = clock

        def resolve(p):
            return p if os.path.isabs(p) else os.path.join(base_dir, p)

        self.journal_path = resolve(self.cfg["journal_path"])
        self.snap_dir = resolve(self.cfg["snapshots_dir"])
        self.lock = threading.Lock()
        self.guard_path = (resolve(self.cfg["guard_path"]) if self.cfg["guard_path"]
                           else os.path.join(os.path.dirname(self.journal_path), "guard.json"))
        self.guard = False
        self.armed_at = None       # mode garde : surveillance effective à partir de cet instant
        self.last_alert = None
        self.blind = False
        self.last_poll = 0.0
        self.present = False
        self.seen_people = 0       # polls de suite avec quelqu'un
        self.last_person = None
        self.motion_streak = [0, 0]
        self.last_motion = [-1e9, -1e9]
        self.objects = {}          # (caméra, nom) -> {"streak", "last", "logged", "decor"}
        self.started = None
        self.on_record = None      # appelée avec chaque événement noté (ex. envoi à Home Assistant)
        try:
            with open(self.guard_path, encoding="utf-8") as f:
                if json.load(f).get("on"):
                    # redémarrage pendant une garde : elle continue, sans nouveau délai de sortie
                    self.guard, self.armed_at = True, self.clock()
                    log.info("Mode garde toujours actif (redémarrage)")
        except (OSError, ValueError, AttributeError):
            pass

    # ------------------------------------------------------------ boucle
    def poll(self):
        """À appeler souvent ; renvoie un texte d'alerte (mode garde) ou None."""
        now = self.clock()
        if now - self.last_poll < self.cfg["poll_s"]:
            return None
        self.last_poll = now
        vision = read_vision(self.path, max_age_s=5, now=now)
        if vision is None:
            # caméras arrêtées : en mode garde, Kamil le signale une fois (sinon il « garde » sans rien voir)
            if self.guard and self.armed_at is not None and now >= self.armed_at and not self.blind:
                self.blind = True
                text = "Mode garde : mes caméras ne répondent pas, je ne peux pas surveiller"
                self.record("alerte", text)
                return text
            return None
        self.blind = False
        alerts = []
        people = max(int(vision.get("faces") or 0), int(vision.get("people") or 0))
        # personnes
        if people:
            self.seen_people += 1
            self.last_person = now
            if not self.present and self.seen_people >= 2:
                self.present = True
                text = "Arrivée : %s devant moi" % ("une personne" if people == 1 else "%d personnes" % people)
                self.record("arrivee", text, cams=(0, 1))
                alerts.append(text)
        else:
            self.seen_people = 0
            if self.present and now - (self.last_person or now) > self.cfg["gone_after_s"]:
                self.present = False
                self.record("depart", "Départ : plus personne en vue")
        # mouvements sans personne visible, sur chaque caméra
        cams = [vision.get("motion") or {}, (vision.get("camera2") or {}).get("motion") or {}]
        for i, motion in enumerate(cams):
            moving = (motion.get("level") or 0) >= self.cfg["motion_threshold"]
            self.motion_streak[i] = self.motion_streak[i] + 1 if moving else 0
            if (self.motion_streak[i] >= 2 and not people and not self.present
                    and now - self.last_motion[i] >= self.cfg["motion_every_s"]):
                self.last_motion[i] = now
                boxes = motion.get("boxes") or []
                where = (", " + side_of_box(boxes[0])) if boxes else ""
                text = "Mouvement sans personne visible (caméra %d%s)" % (i + 1, where)
                self.record("mouvement", text, cams=(i,))
                alerts.append(text)
        # objets
        lists = [vision.get("objects") or [], (vision.get("camera2") or {}).get("objects") or []]
        visible = set()
        for i, objs in enumerate(lists):
            for o in objs:
                if o.get("label") and o["label"] not in self.cfg["ignored_objects"]:
                    visible.add((i, o["label"]))
        if self.started is None:
            self.started = now
        for key in visible:
            # les objets déjà là au démarrage font partie du décor : pas notés comme « nouveaux »
            st = self.objects.setdefault(key, {"streak": 0, "last": now, "logged": False,
                                               "decor": now - self.started < 10})
            st["streak"] += 1
            st["last"] = now
            if not st["logged"] and st["streak"] >= self.cfg["object_confirm"]:
                st["logged"] = True
                if not st["decor"]:
                    self.record("objet", "Nouvel objet : %s (caméra %d)" % (key[1], key[0] + 1))
        for key, st in list(self.objects.items()):
            if key not in visible:
                st["streak"] = 0
                if st["logged"] and now - st["last"] > self.cfg["object_gone_s"]:
                    self.record("objet", "Objet disparu : %s (caméra %d)" % (key[1], key[0] + 1))
                    del self.objects[key]
        return self._guard_alert(now, people, alerts)

    def _guard_alert(self, now, people, alerts):
        """Mode garde armé (délai de sortie passé) : alerte pour une arrivée ou un mouvement ;
        quelqu'un déjà là quand la garde s'arme, ou qui reste en vue, est aussi signalé."""
        if not self.guard or self.armed_at is None or now < self.armed_at:
            return None
        if self.last_alert is None:                       # la garde vient de s'armer
            self.last_alert = float("-inf")
            if people and not alerts:
                alerts = ["Quelqu'un est devant moi alors que le mode garde est armé"]
                self.record("alerte", alerts[0], cams=(0, 1))
        elif self.present and not alerts and now - self.last_alert >= self.cfg["realert_s"]:
            alerts = ["Quelqu'un est toujours devant moi (mode garde)"]
        if not alerts:
            return None
        self.last_alert = now
        return " ; ".join(alerts)

    # ------------------------------------------------------------ journal
    def record(self, kind, text, cams=()):
        now = self.clock()
        images = [p for p in (self._snapshot(i, now) for i in cams) if p]
        entry = {"t": round(now, 1), "type": kind, "text": text, "images": images}
        with self.lock:
            os.makedirs(os.path.dirname(os.path.abspath(self.journal_path)), exist_ok=True)
            with open(self.journal_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        log.info("Journal : %s%s", text, " (%d photo)" % len(images) if images else "")
        if self.on_record is not None:
            try:
                self.on_record(entry)
            except Exception:
                log.exception("Journal : envoi impossible")

    def _snapshot(self, cam, now):
        paths = self.cfg["frame_paths"]
        if cam >= len(paths) or not os.path.isfile(paths[cam]):
            return None
        os.makedirs(self.snap_dir, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + "-cam%d.jpg" % (cam + 1)
        dest = os.path.join(self.snap_dir, name)
        try:
            shutil.copyfile(paths[cam], dest)
        except OSError:
            return None
        files = sorted(f for f in os.listdir(self.snap_dir) if f.endswith(".jpg"))
        for old in files[:-self.cfg["max_snapshots"]]:
            try:
                os.remove(os.path.join(self.snap_dir, old))
            except OSError:
                pass
        return dest

    def entries(self, hours=24.0):
        since = self.clock() - hours * 3600
        out = []
        try:
            with open(self.journal_path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if e.get("t", 0) >= since and not self._ignored(e):
                        out.append(e)
        except OSError:
            pass
        return out

    def _ignored(self, entry):
        """Objet noté avant d'être ajouté à ignored_objects (ex. canapé qui « clignote ») : on le tait."""
        if entry.get("type") != "objet":
            return False
        label = entry.get("text", "").split(" : ", 1)[-1].rsplit(" (caméra", 1)[0]
        return label in self.cfg["ignored_objects"]

    def journal_text(self, hours=24.0, limit=40):
        events = self.entries(hours)
        if not events:
            return "Rien de noté dans le journal ces %g dernières heures." % hours
        lines = ["%s : %s%s" % (clock_text(e["t"]), e["text"], " [photo]" if e.get("images") else "")
                 for e in events[-limit:]]
        more = "" if len(events) <= limit else "(%d événements plus anciens non affichés)\n" % (len(events) - limit)
        return more + "\n".join(lines)

    def photo(self, index=1):
        """(légende, chemin) de la n-ième photo la plus récente du journal, ou (None, None)."""
        with_images = [e for e in self.entries(24 * 7) if e.get("images")]
        if not 1 <= index <= len(with_images):
            return None, None
        e = with_images[-index]
        path = next((p for p in e["images"] if os.path.isfile(p)), None)
        return ("%s : %s" % (clock_text(e["t"]), e["text"]), path) if path else (None, None)

    def set_guard(self, on):
        self.guard = bool(on)
        self.armed_at = self.clock() + float(self.cfg["exit_delay_s"]) if on else None
        self.last_alert = None
        try:
            os.makedirs(os.path.dirname(self.guard_path) or ".", exist_ok=True)
            with open(self.guard_path, "w", encoding="utf-8") as f:
                json.dump({"on": self.guard}, f)
        except OSError as e:
            log.warning("Mode garde non enregistré : %s", e)
        self.record("garde", "Mode garde %s" % (
            "activé (surveillance dans %d s)" % self.cfg["exit_delay_s"] if on and self.cfg["exit_delay_s"]
            else "activé" if on else "désactivé"))
