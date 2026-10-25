#!/usr/bin/env python3
"""Suivi de visage InMoov : caméra USB -> Coral USB (Edge TPU) -> MyRobotLab.

Le Coral détecte les visages, et le programme tourne la tête (rothead)
et le cou (neck) pour garder le visage le plus proche au centre de l'image.
Avec le même Coral, il détecte aussi les objets de la pièce (section vision.objects)
et écrit ce qu'il voit dans un petit fichier JSON lu par l'IA (voir scene.py).

Nécessite Python 3.12 au plus (PyCoral n'existe pas pour 3.13) : bash vision/install_coral.sh

    python face_tracker.py --config ../config.json
"""

import argparse
import logging
import os
import sys
import time

import cv2
from pycoral.adapters import common, detect
from pycoral.utils.dataset import read_label_file
from pycoral.utils.edgetpu import list_edge_tpus, make_interpreter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from mrl_client import AsyncMrlClient, load_config  # noqa: E402
from motion import MotionDetector  # noqa: E402
from tracking import AxisController, normalized_error, person_head_target, pick_target  # noqa: E402
from scene import summarize_objects, tracking_paused, write_state  # noqa: E402

log = logging.getLogger("vision")


def detect_faces(interpreter, frame_bgr, threshold):
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    _, scale = common.set_resized_input(
        interpreter, (w, h), lambda size: cv2.resize(rgb, size)
    )
    interpreter.invoke()
    objs = detect.get_objects(interpreter, threshold, scale)
    return [(o.bbox.xmin, o.bbox.ymin, o.bbox.xmax, o.bbox.ymax, o.score) for o in objs]


def detect_objects(interpreter, frame_bgr, threshold):
    """Objets COCO : [(id, score, xmin, ymin, xmax, ymax)] en pixels de l'image d'origine."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    _, scale = common.set_resized_input(
        interpreter, (w, h), lambda size: cv2.resize(rgb, size)
    )
    interpreter.invoke()
    objs = detect.get_objects(interpreter, threshold, scale)
    return [(o.id, o.score, o.bbox.xmin, o.bbox.ymin, o.bbox.xmax, o.bbox.ymax) for o in objs]


def open_camera(source):
    """source : numéro (0, 3…) ou chemin fixe lié au port USB
    (/dev/v4l/by-path/platform-xhci-hcd.1-usb-0:1:1.0-video-index0), qui ne change pas au redémarrage."""
    if isinstance(source, str) and not source.isdigit():
        return cv2.VideoCapture(source, cv2.CAP_V4L2)
    return cv2.VideoCapture(int(source))


def share_frame(frame, path, quality=80):
    """Écrit l'image courante pour l'IA (outil « look »), de façon atomique."""
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(jpg.tobytes())
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=os.path.join(os.path.dirname(__file__), "..", "config.json"))
    parser.add_argument("--dry-run", action="store_true", help="n'envoie rien à MyRobotLab")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    cfg = load_config(args.config)
    vcfg = cfg["vision"]
    base_dir = os.path.dirname(os.path.abspath(args.config))
    model_path = os.path.join(base_dir, vcfg["model"])

    if not list_edge_tpus():
        log.error("Aucun Coral détecté. Vérifiez le câble USB 3 et `lsusb` (18d1:9302 ou 1a6e:089a).")
        return 1

    interpreter = make_interpreter(model_path)
    interpreter.allocate_tensors()
    log.info("Modèle chargé sur le Coral : %s", model_path)

    # deuxième modèle sur le même Coral : objets de la pièce, quelques fois par seconde au plus
    ocfg = vcfg.get("objects") or {}
    obj_interpreter, obj_labels = None, {}
    if ocfg.get("enabled"):
        obj_model = os.path.join(base_dir, ocfg["model"])
        try:
            obj_interpreter = make_interpreter(obj_model)
            obj_interpreter.allocate_tensors()
            obj_labels = read_label_file(os.path.join(base_dir, ocfg["labels"]))
            log.info("Détection d'objets chargée sur le Coral : %s", obj_model)
        except (ValueError, OSError) as e:
            log.warning("Détection d'objets désactivée (%s) : bash vision/install_coral.sh", e)
            obj_interpreter = None

    cam = open_camera(vcfg["camera_index"])
    if vcfg.get("camera_fourcc"):
        # MJPG : image compressée par la caméra, ~10 fois moins de débit USB qu'en YUYV ;
        # indispensable pour faire tourner 2 caméras sur le même port USB 2
        cam.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*vcfg["camera_fourcc"]))
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, vcfg["frame_width"])
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, vcfg["frame_height"])
    if not cam.isOpened():
        log.error("Caméra %s introuvable.", vcfg["camera_index"])
        return 1

    # 2e caméra (l'autre œil) : seulement montrée dans l'Atelier (onglet Banc d'essai)
    cam2, share2_path = None, vcfg.get("share_frame2_path")
    if vcfg.get("second_camera_index") is not None and share2_path:
        cam2 = open_camera(vcfg["second_camera_index"])
        cam2.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*(vcfg.get("camera_fourcc") or "MJPG")))
        cam2.set(cv2.CAP_PROP_FRAME_WIDTH, vcfg["frame_width"])
        cam2.set(cv2.CAP_PROP_FRAME_HEIGHT, vcfg["frame_height"])
        cam2.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cam2.isOpened():
            log.info("2e caméra %s ouverte (image : %s)", vcfg["second_camera_index"], share2_path)
        else:
            log.warning("2e caméra %s impossible à ouvrir : déjà utilisée par un autre programme "
                        "(fuser -v /dev/video*), numéro changé (v4l2-ctl --list-devices) ou débit USB "
                        "insuffisant (camera_fourcc \"MJPG\", ou l'autre caméra sur un port USB bleu)",
                        vcfg["second_camera_index"])
            cam2 = None

    mrl = AsyncMrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"])
    pan = AxisController(vcfg["pan"])
    tilt = AxisController(vcfg["tilt"])
    period = 1.0 / vcfg["max_command_rate_hz"]
    last_cmd = 0.0
    last_seen = 0.0
    sent = {"pan": None, "tilt": None}
    share_path = vcfg.get("share_frame_path")
    share_period = vcfg.get("share_frame_period_s", 1.0)
    last_share = 0.0
    state_path = vcfg.get("state_path")
    pause_path = vcfg.get("pause_path")
    objects, last_objects = [], 0.0
    # sans visage visible (profil, de dos, tête baissée) : on suit la silhouette détectée par le Coral
    person_ids = {i for i, name in (obj_labels or {}).items() if name == "person"} if obj_interpreter else set()
    track_person = bool(person_ids) and vcfg.get("track_person", True)
    person_target, person_time, last_person = None, 0.0, 0.0
    motion0, motion2 = MotionDetector(), MotionDetector()
    objects2, moving0, moving2 = [], {"level": 0.0, "boxes": []}, {"level": 0.0, "boxes": []}
    fps_t, fps_n = time.monotonic(), 0

    def send(axis_name, axis):
        value = round(axis.position, 1)
        if sent[axis_name] is not None and abs(value - sent[axis_name]) < 0.5:
            return
        sent[axis_name] = value
        if args.dry_run:
            log.debug("%s -> %.1f", axis_name, value)
        else:
            mrl.send(vcfg[axis_name]["service"], "moveTo", value)

    try:
        while True:
            ok, frame = cam.read()
            if not ok:
                log.warning("Image caméra perdue, nouvel essai...")
                time.sleep(0.2)
                continue

            h, w = frame.shape[:2]
            faces = detect_faces(interpreter, frame, vcfg["score_threshold"])
            if cam2 is not None:
                cam2.grab()   # garde l'image de la 2e caméra fraîche (décodée seulement au partage)
            target = pick_target(faces)
            now = time.monotonic()
            tracked = "visage" if target is not None else None
            if target is None and track_person:
                if now - last_person >= vcfg.get("person_period_s", 0.2):
                    last_person = now
                    found = person_head_target(detect_objects(obj_interpreter, frame, 0.4), person_ids,
                                               vcfg.get("person_min_score", 0.5))
                    if found is not None:
                        person_target, person_time = found, now
                if person_target is not None and now - person_time < 0.6:
                    target, tracked = person_target, "silhouette"

            paused = bool(pause_path) and tracking_paused(pause_path, time.time())
            if now - last_cmd >= period and not paused:
                if target is not None:
                    last_seen = now
                    ex, ey = normalized_error(target, w, h)
                    pan.update(ex)
                    tilt.update(ey)
                    send("pan", pan)
                    send("tilt", tilt)
                    last_cmd = now
                elif now - last_seen > vcfg["lost_face_timeout_s"]:
                    pan.toward_rest()
                    tilt.toward_rest()
                    send("pan", pan)
                    send("tilt", tilt)
                    last_cmd = now

            if vcfg.get("show_window"):
                for (x0, y0, x1, y1, s) in faces:
                    color = (0, 255, 0) if target and (x0, y0) == target[:2] else (0, 0, 255)
                    cv2.rectangle(frame, (int(x0), int(y0)), (int(x1), int(y1)), color, 2)
                    cv2.putText(frame, "%.2f" % s, (int(x0), int(y0) - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                cv2.imshow("InMoov - suivi de visage", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if obj_interpreter is not None and now - last_objects >= ocfg.get("period_s", 2.0):
                raw = detect_objects(obj_interpreter, frame, ocfg.get("score_threshold", 0.5))
                objects = summarize_objects(raw, obj_labels, w, h, ocfg.get("score_threshold", 0.5))
                last_objects = now

            if share_path and now - last_share >= share_period:
                try:
                    share_frame(frame, share_path)
                    moving0 = motion0.update(frame)
                    if cam2 is not None:
                        ok2, frame2 = cam2.retrieve()
                        if ok2:
                            share_frame(frame2, share2_path)
                            moving2 = motion2.update(frame2)
                            if obj_interpreter is not None:   # la 2e caméra voit aussi les objets
                                h2, w2 = frame2.shape[:2]
                                thr = ocfg.get("score_threshold", 0.5)
                                objects2 = summarize_objects(detect_objects(obj_interpreter, frame2, thr),
                                                             obj_labels, w2, h2, thr)
                    if state_path:
                        biggest = max(((f[3] - f[1]) / float(h) for f in faces), default=0.0)
                        write_state(state_path, {
                            "time": time.time(), "faces": len(faces), "face_height": round(biggest, 3),
                            "objects": objects, "objects_age_s": round(now - last_objects, 1) if last_objects else None,
                            "head": {"rothead": round(pan.position, 1), "neck": round(tilt.position, 1)},
                            "tracking_paused": paused,
                            # cadres des visages en fraction de l'image (dessinés dans l'Atelier)
                            "face_boxes": [[round(f[0] / w, 3), round(f[1] / h, 3), round(f[2] / w, 3),
                                            round(f[3] / h, 3), round(float(f[4]), 2)] for f in faces],
                            # personnes vues (visage ou silhouette), et ce que suit la tête
                            "people": max(len(faces), sum(1 for o in objects if o["label"] == "personne"),
                                          1 if tracked else 0),
                            "tracking": tracked,
                            # ce que la tête suit, et la zone centrale où elle ne bouge plus (Atelier)
                            "target_box": [round(target[0] / w, 3), round(target[1] / h, 3),
                                           round(target[2] / w, 3), round(target[3] / h, 3)]
                                          if target is not None else None,
                            "deadband": [vcfg["pan"].get("deadband", 0.0), vcfg["tilt"].get("deadband", 0.0)],
                            "motion": moving0,
                            "camera2": {"objects": objects2, "motion": moving2} if cam2 is not None else None,
                        })
                except OSError as e:
                    log.warning("Image non partagée : %s", e)
                last_share = now

            fps_n += 1
            if now - fps_t >= 5.0:
                log.info("%.1f images/s, %d visage(s), suivi : %s, rothead=%.0f neck=%.0f",
                         fps_n / (now - fps_t), len(faces), tracked or "personne", pan.position, tilt.position)
                fps_t, fps_n = now, 0
    except KeyboardInterrupt:
        pass
    finally:
        cam.release()
        if cam2 is not None:
            cam2.release()
        if vcfg.get("show_window"):
            cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
