#!/usr/bin/env python3
"""Mode imitation : InMoov reproduit les bras et les doigts de la personne filmée.

Inspiré de la téléopération utilisée en robotique (LeRobot, « hand shadowing ») :
la caméra suit vos bras (MediaPipe Pose) et vos doigts (MediaPipe Hands), et le
robot les imite en miroir. Avec --record, le mouvement est enregistré pour être
rejoué plus tard (onglet Gestes de l'Atelier, ou « InMoov, fais le geste ... »).

    python mirror.py --config ../config.json                 # imitation en direct
    python mirror.py --config ../config.json --record salut  # imite ET enregistre
    python mirror.py --config ../config.json --dry-run -v    # sans bouger le robot

La caméra ne peut servir qu'à un programme : arrêtez le suivi de visage avant.
Python 3.11 ou 3.12 (MediaPipe n'a pas de version pour le Python 3.9 du Coral).
Au premier lancement, MediaPipe télécharge son petit modèle de pose (Internet requis).

SÉCURITÉ : commencez en --dry-run, puis avec une vitesse faible (max_speed),
personne à portée des bras du robot. Ctrl+C arrête tout.
"""

import argparse
import logging
import os
import sys
import time

import cv2
import mediapipe as mp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..")]

import gesture_player  # noqa: E402
from mrl_client import AsyncMrlClient, load_config  # noqa: E402
from pose_mapping import Smoother, arm_angles, arm_targets, finger_curls, robot_side  # noqa: E402

log = logging.getLogger("mirror")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", default=os.path.join(HERE, "..", "config.json"))
    p.add_argument("--record", metavar="NOM", help="enregistre le mouvement comme geste")
    p.add_argument("--duration", type=float, default=15.0, help="durée max d'enregistrement (s)")
    p.add_argument("--dry-run", action="store_true", help="n'envoie rien à MyRobotLab")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = load_config(a.config)
    mcfg = cfg.get("mirror", {})
    vcfg = cfg["vision"]
    base = os.path.dirname(os.path.abspath(a.config))
    gestures_dir = os.path.join(base, mcfg.get("gestures_dir", "data/gestures"))
    if a.record:
        gesture_player.check_name(a.record)

    joints = mcfg.get("joints", {"fingers": True, "bicep": True, "shoulder": True, "omoplate": False})
    mirror = mcfg.get("mirror", True)
    smoother = Smoother(alpha=mcfg.get("alpha", 0.35), deadband=mcfg.get("deadband", 2.0),
                        max_speed=mcfg.get("max_speed", 60.0))
    mrl = AsyncMrlClient(cfg["mrl"]["url"], cfg["mrl"]["timeout_s"], max_pending=64)

    cam = cv2.VideoCapture(vcfg["camera_index"])
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, vcfg["frame_width"])
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, vcfg["frame_height"])
    if not cam.isOpened():
        log.error("Caméra %s introuvable (le suivi de visage l'utilise-t-il ?)", vcfg["camera_index"])
        return 1

    hands = mp.solutions.hands.Hands(max_num_hands=2, model_complexity=0,
                                     min_detection_confidence=0.6, min_tracking_confidence=0.5)
    pose = mp.solutions.pose.Pose(model_complexity=0, min_detection_confidence=0.6,
                                  min_tracking_confidence=0.5)
    recorded = []
    t0 = last = time.monotonic()
    log.info("Imitation %s%s. Ctrl+C pour arrêter.", "en miroir" if mirror else "côté identique",
             (" + enregistrement « %s »" % a.record) if a.record else "")

    def send(service, value):
        if value is None:
            return
        if a.record:
            recorded.append({"t": round(time.monotonic() - t0, 3), "service": service, "pos": value})
        if a.dry_run:
            log.debug("%s -> %.0f", service, value)
        else:
            mrl.send(service, "moveTo", value)

    try:
        while True:
            ok, frame = cam.read()
            if not ok:
                time.sleep(0.05)
                continue
            now = time.monotonic()
            dt, last = now - last, now
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # bras : image non retournée -> gauche/droite = côtés réels de la personne
            if joints.get("bicep") or joints.get("shoulder") or joints.get("omoplate"):
                res = pose.process(rgb)
                if res.pose_world_landmarks:
                    world = [(l.x, l.y, l.z) for l in res.pose_world_landmarks.landmark]
                    vis = [l.visibility for l in res.pose_landmarks.landmark]
                    for side in ("left", "right"):
                        idx = (11, 13, 15) if side == "left" else (12, 14, 16)
                        if min(vis[i] for i in idx) < mcfg.get("min_visibility", 0.6):
                            continue
                        try:
                            targets = arm_targets(arm_angles(world, side), mcfg)
                        except ValueError:
                            continue
                        arm = "i01.%sArm" % robot_side(side, mirror)
                        for joint, value in targets.items():
                            if joints.get(joint):
                                send("%s.%s" % (arm, joint), smoother.update((arm, joint), value, dt))

            # doigts : MediaPipe Hands attend une image « selfie » (retournée)
            if joints.get("fingers"):
                res = hands.process(cv2.flip(rgb, 1))
                for lm, handed in zip(res.multi_hand_landmarks or [], res.multi_handedness or []):
                    person_side = handed.classification[0].label.lower()  # "left" / "right"
                    hand = "i01.%sHand" % robot_side(person_side, mirror)
                    for finger, value in finger_curls([(p.x, p.y, p.z) for p in lm.landmark]).items():
                        send("%s.%s" % (hand, finger), smoother.update((hand, finger), value, dt))

            if a.record and now - t0 > a.duration:
                log.info("Durée d'enregistrement atteinte")
                break
    except KeyboardInterrupt:
        pass
    finally:
        cam.release()
        hands.close()
        pose.close()
    if a.record:
        if recorded:
            path = gesture_player.save(gestures_dir, a.record, recorded, note="enregistré par imitation")
            log.info("Geste « %s » enregistré (%d consignes) : %s", a.record, len(recorded), path)
        else:
            log.warning("Rien n'a été enregistré (personne détectée ?)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
