#!/usr/bin/env python3
"""Suivi de visage InMoov : caméra USB -> Coral USB (Edge TPU) -> MyRobotLab.

Le Coral détecte les visages, et le programme tourne la tête (rothead)
et le cou (neck) pour garder le visage le plus proche au centre de l'image.

Nécessite Python 3.9 (PyCoral ne supporte pas 3.11), voir inmoov/README.md.

    python face_tracker.py --config ../config.json
"""

import argparse
import logging
import os
import sys
import time

import cv2
from pycoral.adapters import common, detect
from pycoral.utils.edgetpu import list_edge_tpus, make_interpreter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from mrl_client import AsyncMrlClient, load_config  # noqa: E402
from tracking import AxisController, normalized_error, pick_target  # noqa: E402

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

    cam = cv2.VideoCapture(vcfg["camera_index"])
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, vcfg["frame_width"])
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, vcfg["frame_height"])
    if not cam.isOpened():
        log.error("Caméra %s introuvable.", vcfg["camera_index"])
        return 1

    mrl = AsyncMrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"])
    pan = AxisController(vcfg["pan"])
    tilt = AxisController(vcfg["tilt"])
    period = 1.0 / vcfg["max_command_rate_hz"]
    last_cmd = 0.0
    last_seen = 0.0
    sent = {"pan": None, "tilt": None}
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
            target = pick_target(faces)
            now = time.monotonic()

            if now - last_cmd >= period:
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

            fps_n += 1
            if now - fps_t >= 5.0:
                log.info("%.1f images/s, %d visage(s), rothead=%.0f neck=%.0f",
                         fps_n / (now - fps_t), len(faces), pan.position, tilt.position)
                fps_t, fps_n = now, 0
    except KeyboardInterrupt:
        pass
    finally:
        cam.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
