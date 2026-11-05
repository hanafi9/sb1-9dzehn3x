"""Ouverture des caméras et du modèle de détection, communes à face_tracker.py et mirror.py."""

import logging
import os
import re

log = logging.getLogger("vision")


def resolve_camera(source):
    """Numéro de caméra pour OpenCV. source : numéro (0, « 3 ») ou chemin fixe lié au port USB
    (/dev/v4l/by-path/…-video-index0) : OpenCV ne sait pas toujours ouvrir un chemin en V4L2
    (« can't be used to capture by name »), on le traduit donc en /dev/videoN -> N."""
    if isinstance(source, int):
        return source
    source = str(source).strip()
    if source.isdigit():
        return int(source)
    m = re.search(r"/dev/video(\d+)$", os.path.realpath(source))
    return int(m.group(1)) if m else source


def open_camera(source, cv2=None):
    if cv2 is None:
        import cv2
    src = resolve_camera(source)
    return cv2.VideoCapture(src, cv2.CAP_V4L2) if isinstance(src, int) else cv2.VideoCapture(src)


def load_detector(model_path, make_interpreter):
    """(interpréteur, "coral" | "processeur") : le Coral si possible, sinon le même modèle compilé pour le
    processeur (même nom sans « _edgetpu »), pour que caméras et suivi continuent, plus lentement."""
    try:
        return make_interpreter(model_path), "coral"
    except (ValueError, RuntimeError, OSError) as err:
        cpu_path = str(model_path).replace("_edgetpu.tflite", ".tflite")
        if cpu_path == str(model_path) or not os.path.isfile(cpu_path):
            raise
        log.warning("Coral indisponible (%s) : %s sur le processeur", str(err).strip(), os.path.basename(cpu_path))
        try:
            from tflite_runtime.interpreter import Interpreter
        except ImportError:
            from ai_edge_litert.interpreter import Interpreter
        return Interpreter(model_path=cpu_path, num_threads=4), "processeur"
