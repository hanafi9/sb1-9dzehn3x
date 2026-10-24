"""Ce que voit le robot, résumé pour l'IA (sans OpenCV ni PyCoral : testable partout).

face_tracker.py détecte les visages et, avec le même Coral USB, les objets de la pièce
(modèle SSDLite MobileDet entraîné sur COCO : 80 catégories courantes). Il écrit
régulièrement un petit fichier JSON (par défaut /dev/shm/inmoov_vision.json) que le
programme de la voix lit pour donner à l'IA la « conscience » de ce qui l'entoure,
sans envoyer d'image sur Internet.
"""

import json
import os

# Noms français des catégories COCO (étiquettes anglaises du fichier coco_labels.txt de Google Coral)
FRENCH_LABELS = {
    "person": "personne", "bicycle": "vélo", "car": "voiture", "motorcycle": "moto", "airplane": "avion",
    "bus": "bus", "train": "train", "truck": "camion", "boat": "bateau", "traffic light": "feu de circulation",
    "fire hydrant": "bouche d'incendie", "stop sign": "panneau stop", "parking meter": "parcmètre",
    "bench": "banc", "bird": "oiseau", "cat": "chat", "dog": "chien", "horse": "cheval", "sheep": "mouton",
    "cow": "vache", "elephant": "éléphant", "bear": "ours", "zebra": "zèbre", "giraffe": "girafe",
    "backpack": "sac à dos", "umbrella": "parapluie", "handbag": "sac à main", "tie": "cravate",
    "suitcase": "valise", "frisbee": "frisbee", "skis": "skis", "snowboard": "snowboard",
    "sports ball": "ballon", "kite": "cerf-volant", "baseball bat": "batte de baseball",
    "baseball glove": "gant de baseball", "skateboard": "skateboard", "surfboard": "planche de surf",
    "tennis racket": "raquette de tennis", "bottle": "bouteille", "wine glass": "verre à vin", "cup": "tasse",
    "fork": "fourchette", "knife": "couteau", "spoon": "cuillère", "bowl": "bol", "banana": "banane",
    "apple": "pomme", "sandwich": "sandwich", "orange": "orange", "broccoli": "brocoli", "carrot": "carotte",
    "hot dog": "hot-dog", "pizza": "pizza", "donut": "beignet", "cake": "gâteau", "chair": "chaise",
    "couch": "canapé", "potted plant": "plante en pot", "bed": "lit", "dining table": "table",
    "toilet": "toilettes", "tv": "télévision", "laptop": "ordinateur portable", "mouse": "souris",
    "remote": "télécommande", "keyboard": "clavier", "cell phone": "téléphone", "microwave": "micro-ondes",
    "oven": "four", "toaster": "grille-pain", "sink": "évier", "refrigerator": "réfrigérateur",
    "book": "livre", "clock": "horloge", "vase": "vase", "scissors": "ciseaux", "teddy bear": "ours en peluche",
    "hair drier": "sèche-cheveux", "toothbrush": "brosse à dents",
}


def french(label):
    return FRENCH_LABELS.get(label, label)


def side_of(x_center):
    """Position horizontale dans l'image (0 = bord gauche, 1 = bord droit), vue par le robot."""
    if x_center < 0.35:
        return "à gauche"
    if x_center > 0.65:
        return "à droite"
    return "au centre"


def summarize_objects(objects, labels, width, height, min_score=0.5):
    """objects : [(id, score, xmin, ymin, xmax, ymax)] en pixels -> liste de dicts triée par score."""
    out = []
    for class_id, score, x0, y0, x1, y1 in objects:
        if score < min_score:
            continue
        name = labels.get(int(class_id))
        if not name or name == "n/a":
            continue
        cx = (x0 + x1) / 2.0 / max(width, 1)
        size = max(0.0, (x1 - x0) * (y1 - y0)) / float(max(width * height, 1))
        W, H = float(max(width, 1)), float(max(height, 1))
        out.append({"label": french(name), "score": round(float(score), 2),
                    "side": side_of(cx), "size": round(size, 3),
                    # cadre en fraction de l'image (dessiné dans l'Atelier)
                    "box": [round(x0 / W, 3), round(y0 / H, 3), round(x1 / W, 3), round(y1 / H, 3)]})
    out.sort(key=lambda o: -o["score"])
    # le modèle dessine souvent plusieurs cadres pour la même chose : on garde le plus sûr
    kept = []
    for o in out:
        if not any(k["label"] == o["label"] and iou(k["box"], o["box"]) > 0.4 for k in kept):
            kept.append(o)
    return kept


def iou(a, b):
    """Recouvrement de deux cadres [x0, y0, x1, y1] : 0 = séparés, 1 = identiques."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def write_state(path, state):
    """Écriture atomique (le lecteur ne voit jamais un fichier à moitié écrit)."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)


def tracking_paused(path, now, max_age_s=30.0):
    """L'IA peut demander de suspendre le suivi de visage (outil look_around) en touchant ce fichier."""
    try:
        return now - os.path.getmtime(path) < max_age_s
    except OSError:
        return False
